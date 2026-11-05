import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { Gate, verifySession, signSession, stripGateCookie, buildUpstreamHeaders, parseSetCookie, withSessionCookies, COOKIE_NAME } from "../lib/gate.js";
import { Log } from "../lib/log.js";

const TOKEN = "UnitTestAccessToken_0123456789";
const silent = new Log({ level: "silent", sink: null });

let upstream;
let upPort;
let gate;
let gatePort;
let lastUpgradeCookie = "";

function baseConfig(over = {}) {
  return {
    webHost: "127.0.0.1",
    gateHost: "127.0.0.1",
    gatePort: 0,
    failWindowMs: 60000,
    maxFails: 10,
    sessionTtlMinutes: 60,
    ...over,
  };
}

test.before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url.startsWith("/?token=")) {
      res.setHeader("set-cookie", [
        "dsh_session=from-dsh; Path=/",
        "dsh-auth-unit=fresh; Path=/; HttpOnly; SameSite=Strict",
      ]);
      res.writeHead(302, { location: "/" });
      return void res.end();
    }
    if (req.url === "/api/echo") {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({
        host: req.headers.host,
        origin: req.headers.origin || "",
        cookie: req.headers.cookie || "",
        url: req.url,
      }));
    }
    if (req.url === "/protected") {
      if (!/dsh-auth-unit=fresh/.test(String(req.headers.cookie || ""))) {
        res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
        return void res.end("dsh web authentication required; reopen the URL printed by dsh web.");
      }
      return void res.end("OK protected");
    }
    res.end(`OK ${req.url}`);
  });
  upstream.on("upgrade", (req, socket) => {
    lastUpgradeCookie = req.headers.cookie || "";
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write(`ECHO:${d.toString()}`));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  upPort = upstream.address().port;

  gate = new Gate({
    config: baseConfig(), accessToken: TOKEN, logger: silent, webPort: upPort,
    launchToken: () => "LAUNCH123",
  });
  await gate.start();
  gatePort = gate.server.address().port;
});

test.after(async () => {
  await gate?.stop();
  upstream.closeAllConnections?.();
  await new Promise((r) => upstream.close(r));
});

function url(path) { return `http://127.0.0.1:${gatePort}${path}`; }

test("纯函数：会话签名与校验", () => {
  const s = signSession(TOKEN, 60000, 1000);
  assert.equal(verifySession(s, TOKEN, 2000), true);
  assert.equal(verifySession(s, TOKEN, 99000), false, "过期必须拒绝");
  assert.equal(verifySession(s, "wrong", 2000), false);
  assert.equal(verifySession("garbage", TOKEN, 2000), false);
  assert.equal(stripGateCookie(`a=1; ${COOKIE_NAME}=xyz; b=2`), "a=1; b=2");
});

test("纯函数：转发头把外部 authority 全部改回 loopback", () => {
  const headers = buildUpstreamHeaders({
    headers: {
      host: "abcd-3081.tunnel.example.com",
      origin: "https://abcd-3081.tunnel.example.com",
      referer: "https://abcd-3081.tunnel.example.com/chat",
      "x-forwarded-for": "1.2.3.4",
      authorization: "Bearer leak",
      cookie: `dsh_session=keep; ${COOKIE_NAME}=drop`,
      "accept": "application/json",
    },
  }, "127.0.0.1:3080");
  assert.equal(headers.host, "127.0.0.1:3080");
  assert.equal(headers.origin, "http://127.0.0.1:3080");
  assert.equal(headers.referer, "http://127.0.0.1:3080/");
  assert.equal(headers["x-forwarded-for"], undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, "dsh_session=keep");
  assert.equal(headers.accept, "application/json");
});

test("纯函数：解析 set-cookie 并注入最新 DSH 会话", () => {
  assert.deepEqual(
    parseSetCookie("dsh_session=from-dsh; Path=/; HttpOnly"),
    { name: "dsh_session", value: "from-dsh" },
  );
  assert.equal(parseSetCookie("=bad"), null);
  assert.equal(parseSetCookie(""), null);
  assert.equal(withSessionCookies("a=1", []), "a=1");
  assert.equal(
    withSessionCookies("keep=1; dsh_session=stale; dsh-auth-old=old", [
      { name: "dsh_session", value: "from-dsh" },
      { name: "dsh-auth-unit", value: "fresh" },
    ]),
    "keep=1; dsh_session=from-dsh; dsh-auth-unit=fresh",
  );
});

test("未认证请求被挡在登录页", async () => {
  const r = await fetch(url("/api/echo"), { redirect: "manual" });
  assert.equal(r.status, 401);
  assert.match(await r.text(), /error|login/i);
});

test("扫码链接完成认证，并同时兑换 DSH 会话 Cookie", async () => {
  const r = await fetch(url(`/?t=${TOKEN}`), { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/");
  const cookies = r.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith(`${COOKIE_NAME}=`) && /HttpOnly/i.test(c)));
  assert.ok(cookies.some((c) => c.startsWith("dsh_session=from-dsh")), "应把上游会话一并交给浏览器");
  assert.equal(gate.stats.exchanges > 0, true);
});

async function sessionCookie() {
  const r = await fetch(url(`/?t=${TOKEN}`), { redirect: "manual" });
  return r.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(";")[0];
}

test("带会话 Cookie 可代理，且上游看到的是 loopback", async () => {
  const cookie = await sessionCookie();
  const r = await fetch(url("/api/echo"), {
    headers: {
      cookie,
      host: `fake-${gatePort}.tunnel.example.com`,
      origin: "https://fake.tunnel.example.com",
    },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.host, `127.0.0.1:${upPort}`);
  assert.equal(body.origin, `http://127.0.0.1:${upPort}`);
  assert.equal(body.cookie.includes(COOKIE_NAME), false, "网关 Cookie 不应泄漏给 DSH");
});

test("X-DevBridge-Auth 头可免 Cookie 访问", async () => {
  const r = await fetch(url("/api/echo"), { headers: { "x-devbridge-auth": TOKEN } });
  assert.equal(r.status, 200);
});

test("已鉴权请求会懒刷新并注入最新 DSH Cookie", async () => {
  const g = new Gate({
    config: baseConfig(), accessToken: TOKEN, logger: silent, webPort: upPort,
    launchToken: () => "LAUNCH123",
  });
  await g.start();
  const port = g.server.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/echo`, {
      headers: {
        "x-devbridge-auth": TOKEN,
        cookie: "keep=1; dsh_session=stale; dsh-auth-old=stale",
      },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.match(body.cookie, /dsh_session=from-dsh/);
    assert.match(body.cookie, /dsh-auth-unit=fresh/);
    assert.match(body.cookie, /keep=1/);
    assert.doesNotMatch(body.cookie, /stale|dsh-auth-old/);
    assert.equal(g.stats.exchanges, 1, "首次代理只兑换一次");

    const protectedRes = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: {
        "x-devbridge-auth": TOKEN,
        cookie: "dsh-auth-old=stale",
      },
    });
    assert.equal(protectedRes.status, 200, "旧 DSH Cookie 不应导致上游 401");
    assert.equal(await protectedRes.text(), "OK protected");
  } finally {
    await g.stop();
  }
});

test("错误令牌被拒绝，连续失败触发限流", async () => {
  const cfg = baseConfig({ maxFails: 3, failWindowMs: 60000 });
  const g = new Gate({ config: cfg, accessToken: TOKEN, logger: silent, webPort: upPort, launchToken: () => "" });
  await g.start();
  const port = g.server.address().port;
  try {
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`http://127.0.0.1:${port}/?t=WRONG`, { redirect: "manual" });
      assert.equal(r.status, 401);
    }
    const limited = await fetch(`http://127.0.0.1:${port}/?t=${TOKEN}`, { redirect: "manual" });
    assert.equal(limited.status, 429, "达到阈值后连正确令牌也应被暂时挡住");
  } finally {
    await g.stop();
  }
});

test("health 只对本机可用", async () => {
  const r = await fetch(url("/__devbridge__/health"));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.upstream, `127.0.0.1:${upPort}`);
});

test("WebSocket upgrade 透传到上游", async () => {
  const cookie = await sessionCookie();
  const socket = net.connect(gatePort, "127.0.0.1");
  try {
    await once(socket, "connect");
    socket.write(
      "GET /ws HTTP/1.1\r\n" +
      "Host: public.example.com\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      `Cookie: ${cookie}\r\n\r\n`,
    );
    const [first] = await once(socket, "data");
    assert.match(first.toString(), /101 Switching Protocols/);
    assert.match(lastUpgradeCookie, /dsh_session=from-dsh/, "WS 升级也应注入最新 DSH Cookie");
    socket.write("PING");
    const [second] = await once(socket, "data");
    assert.match(second.toString(), /ECHO:PING/);
  } finally {
    socket.destroy();
  }
});

test("未认证的 WebSocket upgrade 返回 401", async () => {
  const socket = net.connect(gatePort, "127.0.0.1");
  try {
    await once(socket, "connect");
    socket.write("GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    const [first] = await once(socket, "data");
    assert.match(first.toString(), /401 Unauthorized/);
  } finally {
    socket.destroy();
  }
});
