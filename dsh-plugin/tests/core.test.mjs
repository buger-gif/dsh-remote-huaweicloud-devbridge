import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULTS, resolveConfig, configPath, statePath, launchTokenPath, writeConfigFile,
} from "../lib/config.js";
import { pairingUrlFor } from "../lib/control.js";
import { State } from "../lib/state.js";
import { Log } from "../lib/log.js";

function tmpEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-core-"));
  return { ...process.env, DSH_HOME: home, HOME: home };
}

test("配置：默认值与优先级", () => {
  const env = tmpEnv();
  const base = resolveConfig({}, env);
  assert.equal(base.gatePort, 3081);
  assert.equal(base.autoStart, false, "默认不自动联网");
  assert.equal(base.allowAnonymous, true, "默认由网关鉴权而非 DevBridge");

  writeConfigFile({ gatePort: 4099, autoStart: true }, env);
  const withFile = resolveConfig({}, env);
  assert.equal(withFile.gatePort, 4099);
  assert.equal(withFile.autoStart, true);

  const withCordis = resolveConfig({ gatePort: 5000, protocol: "https" }, env);
  assert.equal(withCordis.gatePort, 5000);
  assert.equal(withCordis.protocol, "https");

  const withEnv = resolveConfig({}, { ...env, DEVBRIDGE_REMOTE_GATE_PORT: "6000", DEVBRIDGE_REMOTE_AUTOSTART: "false" });
  assert.equal(withEnv.gatePort, 6000);
  assert.equal(withEnv.autoStart, false);
});

test("配置：非法值兜底、未知键被忽略、文件权限", () => {
  const env = tmpEnv();
  fs.mkdirSync(path.dirname(configPath(env)), { recursive: true });
  fs.writeFileSync(configPath(env), JSON.stringify({ gatePort: 99999, madeUpKey: "x", sessionTtlMinutes: -5 }));
  const c = resolveConfig({}, env);
  assert.equal(c.gatePort, DEFAULTS.gatePort);
  assert.equal(c.madeUpKey, undefined);
  assert.equal(c.sessionTtlMinutes, 1);
  writeConfigFile({ autoStart: false }, env);
  assert.equal(fs.statSync(configPath(env)).mode & 0o777, 0o600);
  assert.ok(statePath(env).endsWith("devbridge-remote/state.json"));
  assert.equal(launchTokenPath(env), path.join(env.DSH_HOME, "web-token"));
});

test("扫码链接：以 host 输出的 URL 为准，去掉原有路径并带令牌", () => {
  assert.equal(
    pairingUrlFor("https://noh56s7x-3081.tunnel.example.com", "TOK123"),
    "https://noh56s7x-3081.tunnel.example.com/?t=TOK123",
  );
  assert.equal(
    pairingUrlFor("https://a-b.hwtunnel.com/some/path?x=1", "TOK"),
    "https://a-b.hwtunnel.com/?t=TOK",
  );
  assert.equal(pairingUrlFor("", "TOK"), "");
  assert.equal(pairingUrlFor("https://a.b.c", ""), "");
  assert.equal(pairingUrlFor("not a url", "TOK"), "");
});

test("日志：环形缓冲与按时间增量读取", () => {
  const log = new Log({ level: "debug", limit: 3, sink: null });
  log.info("a");
  log.warn("b");
  log.error("c");
  log.debug("d");
  assert.deepEqual(log.entries.map((e) => e.text), ["b", "c", "d"]);
  assert.deepEqual(log.tail(0, 2).map((e) => e.text), ["c", "d"]);
});

test("State：轮换令牌后旧值失效", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dbr-state2-")), "s.json");
  const s = new State({ file, logger: new Log({ level: "silent", sink: null }) });
  s.load();
  const first = s.ensureToken();
  s.patch({ tunnelId: "abc12345" });
  const reloaded = new State({ file, logger: new Log({ level: "silent", sink: null }) });
  reloaded.load();
  assert.equal(reloaded.get("tunnelId"), "abc12345");
  assert.equal(reloaded.ensureToken(), first);
  assert.notEqual(reloaded.rotateToken(), first);
});
