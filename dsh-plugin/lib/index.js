/**
 * dsh-remote-huaweicloud-devbridge — 宿主半（Node，单进程，零第三方依赖）。
 *
 *  远端浏览器 ──HTTPS──▶ 华为云 DevBridge 中继 ──出站隧道──▶ devbridge host
 *       └─▶ 127.0.0.1:gatePort（本插件的鉴权网关）
 *              └─▶ 127.0.0.1:3080（DSH Web，Host 已被重写为 loopback）
 *
 * 插件本身不监听公网端口；所有对外流量都走 DevBridge 的出站连接。
 * 控制面走 DSH 同源前缀 /plugins/devbridge-remote，另有独立控制页兜底。
 */
import crypto from "node:crypto";
import { resolveConfig, statePath as stateFilePath } from "./config.js";
import { discoverLaunchToken, tokenFromUrl } from "./launch-token.js";
import { State } from "./state.js";
import { Log } from "./log.js";
import { Gate } from "./gate.js";
import { TunnelManager } from "./tunnel.js";
import { Control } from "./control.js";
import { renderPage } from "./page.js";

const PREFIX = "/plugins/devbridge-remote";
const API_TOKEN = crypto.randomBytes(24).toString("hex");
const LOG = "[devbridge-remote]";
const MAX_BODY = 1 << 20;

export const name = "dsh-remote-huaweicloud-devbridge";

function isLoopback(addr) {
  const s = String(addr || "").replace(/^::ffff:/, "");
  return s === "::1" || s === "127.0.0.1" || s.startsWith("127.");
}

function hostName(hostHeader) {
  const h = String(hostHeader || "").toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.split(":")[0];
}

function hostIsLocal(hostHeader) {
  const n = hostName(hostHeader);
  return n === "localhost" || n === "::1" || /^127\./.test(n);
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return hostIsLocal(u.host) && u.host.toLowerCase() === String(req.headers.host || "").toLowerCase();
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const isHtml = typeof body === "string" && /^\s*<!doctype|^\s*<html/i.test(body);
  const data = isHtml || typeof body === "string" ? body : JSON.stringify(body ?? {});
  res.writeHead(status, {
    "content-type": isHtml ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(data);
}

/** DSH Web 端口可能在启动时自增，优先问 webServer，其次配置/环境变量。 */
function detectWebPort(webCtx, config) {
  const ws = webCtx?.webServer;
  const candidates = [
    ws?.port,
    ws?.options?.port,
    typeof ws?.address === "function" ? ws.address()?.port : undefined,
    ws?.server?.address?.()?.port,
    process.env.DSH_WEB_PORT,
    config.webPort,
    3080,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  }
  return 3080;
}

export function apply(ctx, cordisConfig = {}) {
  const config = resolveConfig(cordisConfig || ctx?.config || {});
  const log = new Log({ prefix: LOG, level: config.logLevel });
  const state = new State({ file: stateFilePath(), logger: log });
  state.load();
  const accessToken = config.accessToken || state.ensureToken();

  let gate = null;
  let tunnel = null;
  let control = null;
  let webPort = config.webPort || 3080;
  let started = false;
  let disposed = false;
  let bootCtx = null;
  let launchInfo = { token: "", source: "none" };

  const getConfig = () => config;
  const getGate = () => gate;
  const getTunnel = () => tunnel;
  // DSH 的启动令牌存在进程内服务上，服务可能晚于插件加载；每次用前重新发现。
  const refreshLaunch = () => {
    launchInfo = discoverLaunchToken({ ctx, webCtx: bootCtx, webPort, state });
    return launchInfo;
  };

  async function handler(req, res) {
    // 三层校验：回环来源 + 回环 Host + 页面注入的一次性 token。
    // DevBridge 网关已把外部 Host/Origin 重写成 loopback，所以远端访问同样能过。
    if (!isLoopback(req.socket?.remoteAddress)) return send(res, 403, { error: "loopback only" });
    if (!hostIsLocal(req.headers.host) || !originOk(req)) return send(res, 403, { error: "cross-origin denied" });

    const url = new URL(req.url || "/", "http://127.0.0.1");
    let path = url.pathname;
    if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || "/";

    // 独立控制页：内联 panel.js，不依赖客户端注入是否成功。
    if ((path === "/" || path === "/panel" || path === "/index.html") && (req.method || "GET").toUpperCase() === "GET") {
      return send(res, 200, renderPage({ api: PREFIX, token: API_TOKEN, version: "0.1.2" }));
    }
    if (!path.startsWith("/api/")) return send(res, 404, { error: "not found", path });
    if ((req.method || "GET").toUpperCase() === "OPTIONS") return send(res, 204, {});
    if (req.headers["x-devbridge-api"] !== API_TOKEN) {
      return send(res, 401, { error: "missing or stale token; refresh the page" });
    }

    let body = {};
    if (["POST", "PUT", "DELETE"].includes((req.method || "GET").toUpperCase())) {
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw);
      } catch (e) {
        return send(res, 400, { error: `bad body: ${e.message}` });
      }
    }
    const out = control
      ? await control.handle(path, req.method, url.searchParams, body)
      : { status: 503, body: { error: "plugin not ready" } };
    return send(res, out.status, out.body);
  }

  function boot(webCtx) {
    if (started || disposed) return;
    started = true;
    bootCtx = webCtx;
    webPort = detectWebPort(webCtx, config);
    config.webPort = webPort;
    refreshLaunch();

    gate = new Gate({
      config, accessToken, logger: log, webPort,
      launchToken: () => refreshLaunch().token,
    });
    tunnel = new TunnelManager({ config, state, logger: log });
    control = new Control({
      getConfig, state, getTunnel, getGate, log,
      getLaunchInfo: () => refreshLaunch(),
      setLaunchUrl: () => refreshLaunch(),
      version: "0.1.2",
    });

    // 注册同源 API + 独立控制页。
    try {
      webCtx.on("webserver/index-inject", (table) => {
        table.push({ kind: "global", name: "DEVBRIDGE_REMOTE_API", value: PREFIX });
        table.push({ kind: "global", name: "DEVBRIDGE_REMOTE_TOKEN", value: API_TOKEN });
      });
      webCtx.effect(() => webCtx.webServer.register({ kind: "prefix", path: PREFIX, handler }));
      log.info(`控制面已挂载 ${PREFIX}（独立页可直接访问）`);
    } catch (e) {
      log.error("挂载控制面失败:", e.message);
    }

    // 网关随插件生命周期常驻；隧道按配置或面板手动开启。
    void (async () => {
      try {
        await gate.start();
      } catch (e) {
        log.error(`鉴权网关启动失败（端口 ${config.gatePort}）:`, e.message);
        return;
      }
      if (!config.enabled) {
        log.info("插件在配置中已禁用");
        return;
      }
      if (config.autoStart) {
        setTimeout(() => {
          if (!disposed) void tunnel.start().catch((e) => log.error("自动启动失败:", e.message));
        }, 1500);
      } else {
        log.info(`就绪。打开 ${PREFIX}/ 或侧边栏「华为云远控」点「开启远控」`);
      }
    })();
  }

  try {
    ctx.inject(["webServer"], (webCtx) => boot(webCtx));
  } catch (e) {
    log.warn("webServer 服务不可用（headless profile？），插件保持待命:", e.message);
  }

  try {
    ctx.effect(() => () => {
      disposed = true;
      try { tunnel?.dispose(); } catch { /* noop */ }
      void gate?.stop();
      log.info("插件已卸载");
    });
  } catch (e) {
    log.warn("dispose hook 注册失败:", e.message);
  }
}
