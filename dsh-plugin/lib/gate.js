/**
 * 鉴权反向代理网关。
 *
 * 为什么需要它：DSH Web 只监听 127.0.0.1，且对 /api 有 Host 信任围栏，
 * 直接把 3080 挂到公网域名上会得到 403。DevBridge 的 host 进程从本机出站，
 * 把流量送到本网关；网关把 Host/Origin/Referer 重写成 loopback authority，
 * 于是上游 DSH 看到的是一次「本地访问」，无需改 DSH 启动参数。
 *
 * 公网侧的安全由网关自己负责：
 *   1. 一次性扫码链接 /?t=<token> 或登录页提交 token；
 *   2. HMAC 签名的 HttpOnly 会话 Cookie（带过期时间）；
 *   3. 同 IP 连续失败限流；
 *   4. 透传前剥离外部身份头与网关自身 Cookie。
 *
 * 所有能力只用 Node 内置模块；HTTP 与 WebSocket 都透传。
 */
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

export const COOKIE_NAME = "dbr_session";
export const LOGIN_PATH = "/__devbridge__/login";
export const ENTER_PATH = "/__devbridge__/enter";
export const LOGOUT_PATH = "/__devbridge__/logout";
export const HEALTH_PATH = "/__devbridge__/health";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);
const STRIP_HEADERS = new Set([
  "host", "origin", "referer", "authorization", "proxy-authorization",
  "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-forwarded-port", "x-real-ip", "cookie",
]);

// ---- 纯函数（便于离线自测） ------------------------------------------------

export function signSession(secret, ttlMs, now = Date.now()) {
  const exp = now + ttlMs;
  const sig = crypto.createHmac("sha256", secret).update(String(exp)).digest("base64url").slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifySession(value, secret, now = Date.now()) {
  if (!value || typeof value !== "string") return false;
  const [expText, sig] = value.split(".");
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp <= now || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(String(exp)).digest("base64url").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

/** 从转发给 DSH 的 Cookie 里剔除网关自己的会话 Cookie。 */
export function stripGateCookie(cookieHeader) {
  const kept = String(cookieHeader || "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith(`${COOKIE_NAME}=`));
  return kept.join("; ");
}

/** 只取 `Set-Cookie` 的 name=value，属性（Path/Max-Age 等）不参与注入。 */
export function parseSetCookie(value) {
  const first = String(value || "").split(";")[0];
  const i = first.indexOf("=");
  if (i <= 0) return null;
  const name = first.slice(0, i).trim();
  const val = first.slice(i + 1).trim();
  if (!name || !val) return null;
  return { name, value: val };
}

/**
 * 把网关从 DSH 换到的最新 Cookie 注入上游请求。
 * 有缓存时清掉客户端同名项与所有旧的 `dsh-auth-*`，避免重启前的旧 Cookie 被继续转发。
 */
export function withSessionCookies(cookieHeader, sessionCookies = []) {
  const current = String(cookieHeader || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sessionCookies.length) return current.join("; ");
  const names = new Set(sessionCookies.map((c) => c.name));
  const kept = current.filter((part) => {
    const i = part.indexOf("=");
    const name = i < 0 ? part : part.slice(0, i).trim();
    if (names.has(name)) return false;
    if (/^dsh-auth-/i.test(name)) return false;
    return true;
  });
  return [...kept, ...sessionCookies.map((c) => `${c.name}=${c.value}`)].join("; ");
}

/** 生成发往上游的请求头：把外部 authority 全部改回 loopback。 */
export function buildUpstreamHeaders(req, authority, sessionCookies = []) {
  const out = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || STRIP_HEADERS.has(k) || value === undefined) continue;
    out[k] = value;
  }
  out.host = authority;
  if (req.headers?.origin) out.origin = `http://${authority}`;
  if (req.headers?.referer) out.referer = `http://${authority}/`;
  const cookie = withSessionCookies(stripGateCookie(req.headers?.cookie), sessionCookies);
  if (cookie) out.cookie = cookie;
  return out;
}

export function sessionCookie(value, maxAgeMs) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; SameSite=Lax`;
}

export function expiredCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body ?? {});
  res.writeHead(status, {
    "content-type": typeof data === "string" && !headers["content-type"]
      ? "text/html; charset=utf-8"
      : "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(data);
}

function loginPage(error = "") {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>DSH 远控 · 验证</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#f5f6f8;color:#1a1d21;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif}
.card{width:min(92vw,380px);background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;
box-shadow:0 8px 30px rgba(0,0,0,.06)}
h1{font-size:17px;margin:0 0 6px}p{color:#6b7280;margin:0 0 20px;font-size:12.5px}
input{width:100%;padding:11px 12px;border:1px solid #d1d5db;border-radius:9px;font:inherit;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;outline:none}
input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
button{width:100%;margin-top:12px;padding:11px;border:0;border-radius:9px;background:#2563eb;color:#fff;
font:inherit;font-weight:600;cursor:pointer}button:active{transform:translateY(1px)}
.err{margin-top:12px;color:#dc2626;font-size:12.5px}
</style></head><body><div class="card"><h1>连接本地 DSH</h1>
<p>请输入电脑端侧边栏「华为云远控」面板里显示的访问令牌，或直接用扫码链接打开。</p>
<form method="post" action="${LOGIN_PATH}"><input name="token" type="password" autocomplete="current-password"
placeholder="访问令牌" autofocus required><button type="submit">连接</button></form>
${error ? `<div class="err">${error}</div>` : ""}</div></body></html>`;
}

function isLoopback(addr) {
  const s = String(addr || "").replace(/^::ffff:/, "");
  return s === "::1" || s === "127.0.0.1" || s.startsWith("127.");
}

// ---- 网关 -----------------------------------------------------------------

export class Gate {
  /**
   * @param {object} o
   * @param {object} o.config resolveConfig()
   * @param {string} o.accessToken 门禁 token
   * @param {object} o.logger Log
   * @param {number} o.webPort 上游 DSH Web 端口
   * @param {function} [o.launchToken] () => string，读取 ~/.dsh/web-token
   * @param {function} [o.now] () => number，便于自测
   */
  constructor({ config, accessToken, logger, webPort = 3080, launchToken = () => "", now = () => Date.now() } = {}) {
    this.config = config;
    this.accessToken = accessToken;
    this.log = logger;
    this.webPort = webPort || config.webPort || 3080;
    this.launchToken = launchToken;
    this.now = now;
    this.server = null;
    this.running = false;
    this.sockets = new Set();
    this.fails = new Map();
    this.stats = { requests: 0, denied: 0, upgrades: 0, exchanges: 0 };
    this.launchExchange = { ok: false, at: 0, error: "not attempted" };
    // 内存里的 DSH 会话 Cookie；重启后由 launch token 重新兑换，绝不落盘或写日志。
    this.dshCookies = [];
    this.dshCookiesAt = 0;
    this.dshCookieMissAt = 0;
    this.dshCookieRefresh = null;
  }

  setWebPort(port) {
    if (port && Number.isFinite(Number(port))) this.webPort = Number(port);
  }

  get authority() {
    return `${this.config.webHost || "127.0.0.1"}:${this.webPort}`;
  }

  #clientIp(req) {
    return String(req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
  }

  #rateLimited(ip) {
    const row = this.fails.get(ip);
    if (!row) return false;
    if (this.now() - row.first > this.config.failWindowMs) {
      this.fails.delete(ip);
      return false;
    }
    return row.count >= this.config.maxFails;
  }

  #recordFail(ip) {
    const row = this.fails.get(ip);
    if (!row || this.now() - row.first > this.config.failWindowMs) {
      this.fails.set(ip, { count: 1, first: this.now() });
    } else {
      row.count += 1;
    }
  }

  #clearFails(ip) { this.fails.delete(ip); }

  #authorized(req) {
    const cookies = parseCookies(req.headers?.cookie);
    if (verifySession(cookies[COOKIE_NAME], this.accessToken, this.now())) return true;
    const header = req.headers?.["x-devbridge-auth"];
    return typeof header === "string" && safeEqual(header, this.accessToken);
  }

  /** 用 DSH 的启动 token 在服务端换 Cookie，避免把 launch token 暴露给浏览器地址栏。 */
  #exchangeLaunchToken() {
    return new Promise((resolve) => {
      const token = this.launchToken();
      if (!token) {
        this.launchExchange = { ok: false, at: this.now(), error: "no launch token" };
        return resolve([]);
      }
      const req = http.request({
        host: this.config.webHost || "127.0.0.1",
        port: this.webPort,
        method: "GET",
        path: `/?token=${encodeURIComponent(token)}`,
        headers: { host: this.authority, accept: "*/*" },
        timeout: 5000,
      }, (res) => {
        const cookies = res.headers["set-cookie"] || [];
        this.launchExchange = {
          ok: cookies.length > 0,
          at: this.now(),
          error: cookies.length ? "" : `上游返回 ${res.statusCode}（启动令牌可能已过期）`,
        };
        const parsed = cookies.map(parseSetCookie).filter(Boolean);
        if (parsed.length) {
          this.dshCookies = parsed;
          this.dshCookiesAt = this.now();
          this.dshCookieMissAt = 0;
        }
        res.resume();
        this.stats.exchanges += 1;
        resolve(cookies);
      });
      req.on("timeout", () => {
        this.launchExchange = { ok: false, at: this.now(), error: "兑换超时" };
        req.destroy();
        resolve([]);
      });
      req.on("error", (e) => {
        this.launchExchange = { ok: false, at: this.now(), error: e.message };
        this.log.warn("launch token 兑换失败:", e.message);
        resolve([]);
      });
      req.end();
    });
  }

  /**
   * 已通过网关鉴权的请求进入代理前，确保手里有一份当前 DSH 的会话 Cookie。
   * DSH 重启后浏览器仍可能带着旧 Cookie；网关在服务端换一份新的注入上游即可，
   * 用户不需要重新扫码。没有 launch token 时冷却 5 秒，避免每个请求都打 DSH。
   */
  async #ensureDshCookies() {
    if (this.dshCookies.length) return this.dshCookies;
    if (this.now() < this.dshCookieMissAt) return [];
    if (!this.dshCookieRefresh) {
      this.dshCookieRefresh = this.#exchangeLaunchToken()
        .then((cookies) => {
          if (!cookies.length) this.dshCookieMissAt = this.now() + 5000;
          return this.dshCookies;
        })
        .catch(() => [])
        .finally(() => { this.dshCookieRefresh = null; });
    }
    return this.dshCookieRefresh;
  }

  /** 认证成功后签发会话 Cookie，并尽力把 DSH 自己的会话一起交给浏览器。 */
  async #grant(req, res, redirect = "/") {
    const ip = this.#clientIp(req);
    this.#clearFails(ip);
    const ttl = this.config.sessionTtlMinutes * 60 * 1000;
    const headers = {
      location: redirect,
      "set-cookie": [sessionCookie(signSession(this.accessToken, ttl, this.now()), ttl)],
      "content-type": "text/plain; charset=utf-8",
    };
    const dshCookies = await this.#exchangeLaunchToken();
    if (dshCookies.length) headers["set-cookie"].push(...dshCookies);
    else this.log.warn("未从 DSH 换到会话 Cookie，远端可能仍需粘贴启动 token");
    send(res, 302, "Redirecting…", headers);
  }

  #deny(req, res, status, message) {
    this.stats.denied += 1;
    if (status === 401) this.#recordFail(this.#clientIp(req));
    const wantsJson = /json/i.test(String(req.headers?.accept || "")) ||
      String(req.url || "").startsWith("/api/");
    if (wantsJson) {
      send(res, status, { error: message }, { "content-type": "application/json; charset=utf-8" });
    } else if (status === 401) {
      send(res, 401, loginPage(""));
    } else {
      send(res, status, message);
    }
  }

  /** 处理网关自身的控制路径；返回 true 表示已响应，不再代理。 */
  async #handleControl(req, res, url) {
    const path = url.pathname;
    const method = (req.method || "GET").toUpperCase();

    if (path === HEALTH_PATH) {
      if (!isLoopback(this.#clientIp(req))) return void send(res, 403, { error: "loopback only" }, { "content-type": "application/json; charset=utf-8" });
      return void send(res, 200, {
        ok: this.running, upstream: this.authority, stats: this.stats,
      }, { "content-type": "application/json; charset=utf-8" });
    }

    if (path === LOGOUT_PATH) {
      return void send(res, 302, "Bye", {
        location: LOGIN_PATH,
        "set-cookie": [expiredCookie()],
        "content-type": "text/plain; charset=utf-8",
      });
    }

    if (path === LOGIN_PATH && method === "GET") {
      return void send(res, 200, loginPage());
    }

    if (path === LOGIN_PATH && method === "POST") {
      if (this.#rateLimited(this.#clientIp(req))) return void this.#deny(req, res, 429, "尝试过多，请稍后再试");
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 8192) { req.destroy(); return; }
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const token = new URLSearchParams(raw).get("token") || "";
      if (!safeEqual(token, this.accessToken)) {
        return void send(res, 401, loginPage("令牌不正确，请重新输入"), { "content-type": "text/html; charset=utf-8" });
      }
      await this.#grant(req, res);
      return;
    }

    // 扫码/复制链接的一次性入口：/?t=<token>
    if (path === "/" && url.searchParams.has("t")) {
      const ip = this.#clientIp(req);
      if (this.#rateLimited(ip)) return void this.#deny(req, res, 429, "尝试过多，请稍后再试");
      if (!safeEqual(url.searchParams.get("t") || "", this.accessToken)) {
        return void this.#deny(req, res, 401, "invalid token");
      }
      await this.#grant(req, res, "/");
      return;
    }

    if (path === ENTER_PATH) {
      if (!this.#authorized(req)) return void this.#deny(req, res, 401, "login required");
      await this.#grant(req, res, "/");
      return;
    }

    return false;
  }

  #proxy(req, res, dshCookies = []) {
    const upstream = http.request({
      host: this.config.webHost || "127.0.0.1",
      port: this.webPort,
      method: req.method,
      path: req.url,
      headers: buildUpstreamHeaders(req, this.authority, dshCookies),
      timeout: 0,
    }, (up) => {
      const headers = { ...up.headers };
      // 上游可能下发 host-only Path=/ Cookie；HTTPS 公网入口下补 SameSite，保持可用。
      if (headers["set-cookie"]) {
        headers["set-cookie"] = headers["set-cookie"].map((c) =>
          /samesite=/i.test(c) ? c : `${c}; SameSite=Lax`);
      }
      res.writeHead(up.statusCode || 502, headers);
      up.pipe(res);
    });
    upstream.on("error", (e) => {
      this.log.warn("上游代理失败:", e.message);
      if (!res.headersSent) send(res, 502, { error: `DSH Web 不可达: ${e.message}` }, { "content-type": "application/json; charset=utf-8" });
      else res.destroy();
    });
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    req.pipe(upstream);
    res.on("close", () => { if (!upstream.destroyed) upstream.destroy(); });
  }

  async #upgrade(req, client, head) {
    const cookies = parseCookies(req.headers?.cookie);
    const ok = verifySession(cookies[COOKIE_NAME], this.accessToken, this.now()) ||
      safeEqual(String(req.headers?.["x-devbridge-auth"] || ""), this.accessToken);
    if (!ok) {
      this.stats.denied += 1;
      client.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      client.destroy();
      return;
    }
    this.stats.upgrades += 1;
    const dshCookies = await this.#ensureDshCookies();
    if (client.destroyed) return;
    const upstream = net.connect({
      host: this.config.webHost || "127.0.0.1",
      port: this.webPort,
    });
    const headers = buildUpstreamHeaders(req, this.authority, dshCookies);
    headers.connection = "Upgrade";
    headers.upgrade = req.headers?.upgrade || "websocket";
    let raw = `${req.method || "GET"} ${req.url || "/"} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined) continue;
      raw += `${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`;
    }
    raw += "\r\n";
    upstream.on("connect", () => {
      upstream.write(raw);
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    this.sockets.add(upstream);
    const close = () => {
      this.sockets.delete(upstream);
      this.sockets.delete(client);
      try { upstream.destroy(); } catch { /* noop */ }
      try { client.destroy(); } catch { /* noop */ }
    };
    upstream.on("error", (e) => { this.log.debug("ws upstream:", e.message); close(); });
    upstream.on("close", close);
    client.on("error", close);
    client.on("close", close);
  }

  async start() {
    if (this.running) return { ok: true, port: this.config.gatePort };
    this.server = http.createServer((req, res) => {
      this.stats.requests += 1;
      const url = new URL(req.url || "/", "http://localhost");
      Promise.resolve(this.#handleControl(req, res, url))
        .then(async (handled) => {
          if (handled !== false || res.writableEnded) return;
          const ip = this.#clientIp(req);
          if (this.#rateLimited(ip)) return void this.#deny(req, res, 429, "尝试过多，请稍后再试");
          if (!this.#authorized(req)) return void this.#deny(req, res, 401, "login required");
          const dshCookies = await this.#ensureDshCookies();
          if (res.writableEnded) return;
          this.#proxy(req, res, dshCookies);
        })
        .catch((e) => {
          this.log.error("gate handler:", e);
          if (!res.headersSent) send(res, 500, { error: e.message }, { "content-type": "application/json; charset=utf-8" });
        });
    });
    this.server.on("upgrade", (req, socket, head) => {
      this.#upgrade(req, socket, head).catch((e) => {
        this.log.debug("ws upgrade:", e.message);
        try { socket.destroy(); } catch { /* noop */ }
      });
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    this.server.on("clientError", (_e, socket) => { try { socket.destroy(); } catch { /* noop */ } });

    await new Promise((resolve, reject) => {
      const onError = (e) => reject(e);
      this.server.once("error", onError);
      this.server.listen(this.config.gatePort, this.config.gateHost, () => {
        this.server.off("error", onError);
        resolve();
      });
    });
    this.running = true;
    const addr = this.server.address();
    this.log.info(`鉴权网关已监听 ${this.config.gateHost}:${addr?.port || this.config.gatePort} → ${this.authority}`);
    return { ok: true, port: addr?.port || this.config.gatePort };
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.running = false;
    // 先断开所有活跃连接（含 WebSocket 隧道），否则 server.close() 会一直等。
    for (const socket of this.sockets) {
      try { socket.destroy(); } catch { /* noop */ }
    }
    this.sockets.clear();
    await new Promise((resolve) => {
      try { server.close(() => resolve()); } catch { resolve(); }
      setTimeout(resolve, 2000);
    });
  }

  status() {
    return {
      running: this.running,
      host: this.config.gateHost,
      port: this.config.gatePort,
      upstream: this.authority,
      stats: { ...this.stats },
      launchExchange: { ...this.launchExchange },
    };
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  if (!x.length || !y.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
