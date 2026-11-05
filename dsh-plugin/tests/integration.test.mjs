import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 用 mock Cordis ctx 直接跑宿主插件，验证真实装配路径（无需启动 DSH 进程）。
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-integration-"));
process.env.DSH_HOME = tmpHome;
const { apply, name } = await import("../lib/index.js");

const PREFIX = "/plugins/devbridge-remote";

test("宿主装配：注册同源路由、注入客户端变量、独立控制页与 API 均可用", async () => {
  assert.equal(name, "dsh-remote-huaweicloud-devbridge");

  // 模拟 DSH Web 上游
  const upstream = http.createServer((req, res) => {
    if (req.url.startsWith("/?token=")) {
      res.setHeader("set-cookie", ["dsh_session=ok; Path=/"]);
      res.writeHead(302, { location: "/" });
      return void res.end();
    }
    res.end("DSH-OK");
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const upPort = upstream.address().port;

  const routes = [];
  const globals = [];
  const effects = [];
  const gatePort = 39000 + Math.floor(Math.random() * 2000);

  const webServer = {
    port: upPort,
    register(route) { routes.push(route); return () => {}; },
  };
  const webCtx = {
    webServer,
    on(event, cb) {
      if (event === "webserver/index-inject") {
        const table = [];
        cb(table);
        globals.push(...table);
      }
    },
    effect(fn) { const d = fn(); effects.push(d); return d; },
  };
  const ctx = {
    config: {},
    inject(deps, cb) { assert.deepEqual(deps, ["webServer"]); cb(webCtx); },
    effect(fn) { const d = fn(); effects.push(d); return d; },
  };

  apply(ctx, { enabled: true, autoStart: false, gatePort, logLevel: "silent", reconnect: false });

  assert.equal(routes.length, 1, "应注册一条前缀路由");
  assert.equal(routes[0].kind, "prefix");
  assert.equal(routes[0].path, PREFIX);
  const apiVar = globals.find((g) => g.name === "DEVBRIDGE_REMOTE_API");
  const tokenVar = globals.find((g) => g.name === "DEVBRIDGE_REMOTE_TOKEN");
  assert.equal(apiVar?.value, PREFIX);
  assert.ok(tokenVar?.value, "应注入同源 API token");

  // 把宿主 handler 挂到真实 HTTP server 上，按浏览器方式访问
  const front = http.createServer((req, res) => routes[0].handler(req, res));
  await new Promise((r) => front.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${front.address().port}`;

  // 等 boot 里的异步 gate.start() 落地，避免测试结束时留下监听句柄。
  const net = await import("node:net");
  for (let i = 0; i < 100; i += 1) {
    const open = await new Promise((resolve) => {
      const s = net.connect(gatePort, "127.0.0.1");
      s.setTimeout(200);
      s.on("connect", () => { s.destroy(); resolve(true); });
      s.on("error", () => resolve(false));
      s.on("timeout", () => { s.destroy(); resolve(false); });
    });
    if (open) break;
    await new Promise((r) => setTimeout(r, 20));
  }

  try {
    const page = await fetch(`${base}${PREFIX}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /DevBridge/);
    assert.match(html, /DevBridgePanel\.mount/);
    assert.match(html, /DEVBRIDGE_REMOTE_API/);

    const denied = await fetch(`${base}${PREFIX}/api/status`);
    assert.equal(denied.status, 401, "缺 token 的控制面请求必须拒绝");

    const ok = await fetch(`${base}${PREFIX}/api/status`, {
      headers: { "x-devbridge-api": tokenVar.value },
    });
    assert.equal(ok.status, 200);
    const status = await ok.json();
    assert.equal(status.ok, true);
    assert.ok(status.accessToken, "应生成访问令牌");
    assert.equal(status.gate.port, gatePort);
    assert.equal(status.tunnel.phase, "idle", "默认不自动联网");

    // 只读接口：绝不在这里调 /api/start —— 那会真的去华为云创建隧道。
    // 隧道启动链由 tunnel.test.mjs 用注入的 CLI mock 覆盖。
    const conf = await fetch(`${base}${PREFIX}/api/config`, {
      headers: { "x-devbridge-api": tokenVar.value },
    });
    assert.equal(conf.status, 200);
    const confBody = await conf.json();
    assert.equal(confBody.ok, true);
    assert.ok(confBody.editable.includes("autoStart"));

    const logs = await fetch(`${base}${PREFIX}/api/logs`, {
      headers: { "x-devbridge-api": tokenVar.value },
    });
    assert.equal(logs.status, 200);
    assert.equal((await logs.json()).ok, true);

    // 状态文件权限
    const stateFile = path.join(tmpHome, "devbridge-remote", "state.json");
    assert.equal(fs.existsSync(stateFile), true);
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  } finally {
    for (const d of effects) if (typeof d === "function") { try { await d(); } catch { /* noop */ } }
    await new Promise((r) => front.close(r));
    upstream.closeAllConnections?.();
    await new Promise((r) => upstream.close(r));
  }
});
