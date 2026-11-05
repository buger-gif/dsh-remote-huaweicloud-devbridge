import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tokenFromUrl, discoverLaunchToken } from "../lib/launch-token.js";
import { Control } from "../lib/control.js";
import { State } from "../lib/state.js";
import { Log } from "../lib/log.js";

const silent = new Log({ level: "silent", sink: null });

function ctxWith(services) {
  return { get: (name) => services[name] || null };
}

test("tokenFromUrl：完整链接、裸 token、无效输入", () => {
  assert.equal(tokenFromUrl("http://127.0.0.1:3080/?token=AbCd_123-xyz"), "AbCd_123-xyz");
  assert.equal(tokenFromUrl("https://host/ui/?token=AbCd_123-xyz&a=1"), "AbCd_123-xyz");
  assert.equal(tokenFromUrl("AbCdEf0123456789AbCdEf0123456789"), "AbCdEf0123456789AbCdEf0123456789");
  assert.equal(tokenFromUrl(""), "");
  assert.equal(tokenFromUrl("not a url"), "");
  assert.equal(tokenFromUrl("https://host/"), "");
});

test("发现顺序：手动覆盖 > 进程内服务 > 文件 > none", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-launch-"));
  const env = { ...process.env, DSH_HOME: home, HOME: home };
  fs.writeFileSync(path.join(home, "web-token"), "FILE_TOKEN_0123456789abcdef\n");

  const services = {
    connection: {
      authenticatedUrl: (base) => `${base}?token=SERVICE_TOKEN_0123456789`,
    },
  };
  const ctx = ctxWith(services);

  const fromService = discoverLaunchToken({ ctx, webPort: 3080, env });
  assert.equal(fromService.token, "SERVICE_TOKEN_0123456789");
  assert.match(fromService.source, /service:connection/);

  const state = new State({ file: path.join(home, "state.json"), logger: silent });
  state.load();
  state.patch({ launchUrl: "http://127.0.0.1:3080/?token=MANUAL_TOKEN_0123456789" });
  const fromManual = discoverLaunchToken({ ctx, webPort: 3080, env, state });
  assert.equal(fromManual.token, "MANUAL_TOKEN_0123456789");
  assert.equal(fromManual.source, "manual");

  state.patch({ launchUrl: "" });
  const fromFile = discoverLaunchToken({ ctx: null, webPort: 3080, env, state });
  assert.equal(fromFile.token, "FILE_TOKEN_0123456789abcdef");
  assert.equal(fromFile.source, "file:web-token");

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-launch-empty-"));
  const none = discoverLaunchToken({ ctx: null, webPort: 3080, env: { ...env, DSH_HOME: empty } });
  assert.deepEqual(none, { token: "", source: "none" });
});

test("Control：粘贴启动链接写回 state，状态里带令牌来源与兑换结果", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-launch-ctrl-"));
  const state = new State({ file: path.join(home, "state.json"), logger: silent });
  state.load();
  let saved = "";
  const control = new Control({
    getConfig: () => ({ enabled: true, autoStart: false, gatePort: 3081, tunnelExpirationHours: 72, allowAnonymous: true }),
    state,
    getTunnel: () => ({ status: () => ({ phase: "hosting", tunnelUrl: "https://a-b.hwtunnel.com", tunnelId: "abc12345" }), stop: async () => ({}) }),
    getGate: () => ({ status: () => ({ running: true, port: 3081, host: "127.0.0.1", upstream: "127.0.0.1:3080", stats: {}, launchExchange: { ok: false, error: "上游返回 401" } }) }),
    log: silent,
    getLaunchInfo: () => ({ token: "", source: "none" }),
    setLaunchUrl: (url) => { saved = url; state.patch({ launchUrl: url }); return { token: "x", source: "manual" }; },
  });

  const bad = await control.handle("/api/launch-url", "POST", new URLSearchParams(), { url: "https://host/" });
  assert.equal(bad.status, 400);

  const ok = await control.handle("/api/launch-url", "POST", new URLSearchParams(), {
    url: "http://127.0.0.1:3080/?token=AbCdEf0123456789AbCdEf0123456789",
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.match(saved, /token=/);

  const status = control.handle("/api/status", "GET", new URLSearchParams(), {});
  const s = await status;
  assert.equal(s.body.launchTokenSource, "none");
  assert.equal(s.body.launchExchange.ok, false);
  assert.match(s.body.launchHelp, /启动链接/);
});
