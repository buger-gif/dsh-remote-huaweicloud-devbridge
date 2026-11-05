import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  TunnelManager, extractTunnelUrl, extractTunnelId, findIdByName,
} from "../lib/tunnel.js";
import { State } from "../lib/state.js";
import { Log } from "../lib/log.js";

const silent = new Log({ level: "silent", sink: null });
const TUNNEL_URL = "https://noh56s7x-3081.tunnel.example.com";

test("纯函数：URL / ID 解析与 list 反查", () => {
  assert.equal(extractTunnelUrl(`host started\nTunnel URL: ${TUNNEL_URL}\n`), TUNNEL_URL);
  assert.equal(extractTunnelUrl("noise https://example.com/x and Tunnel URL: " + TUNNEL_URL), TUNNEL_URL);
  assert.equal(extractTunnelUrl(""), "");
  assert.equal(extractTunnelId("noh56s7x\n"), "noh56s7x");
  assert.equal(extractTunnelId("Tunnel ID: dwskt2pg\n"), "dwskt2pg");
  assert.equal(extractTunnelId(""), "");
  assert.equal(
    findIdByName("Tunnel ID  Name\n  dwskt2pg   dev-tunnel-5941   开发隧道\n", "dev-tunnel-5941"),
    "dwskt2pg",
  );
});

function fixture({ version = "v0.2.2-release", auth = "Logged in as tester" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-tunnel-"));
  const state = new State({ file: path.join(tmp, "state.json"), logger: silent });
  state.load();
  const calls = [];
  const exec = async (_bin, args) => {
    calls.push(args);
    const has = (...flags) => flags.some((f) => args.includes(f));
    if (args[0] === "version") return { stdout: `devbridge version ${version}\n`, stderr: "" };
    if (args[0] === "auth") return auth ? { stdout: `${auth}\n`, stderr: "" } : Promise.reject(Object.assign(new Error("not logged in"), { stdout: "", stderr: "not logged in" }));
    if (has("--help")) {
      if (args[0] === "create") return { stdout: "Flags:\n  -d, --description string\n  -e, --expiration int\n", stderr: "" };
      if (args[0] === "port") return { stdout: "Flags:\n  --port-number int\n  --protocol string\n  --allow-anonymous\n  --deny-anonymous\n", stderr: "" };
      return { stdout: "", stderr: "" };
    }
    if (args[0] === "create") return { stdout: "noh56s7x\n", stderr: "" };
    if (args[0] === "list") return { stdout: "Tunnel ID  Name\n", stderr: "" };
    if (args[0] === "port" && args[1] === "list") return { stdout: "Tunnel ID  Port\n", stderr: "" };
    if (args[0] === "port" && args[1] === "create") return { stdout: "Port added\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  let child = null;
  const spawnCalls = [];
  const spawnFn = (_bin, args) => {
    spawnCalls.push(args);
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = undefined;
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit("exit", 0, null); return true; };
    setTimeout(() => child.stdout.write(`host started\nTunnel URL: ${TUNNEL_URL}\n`), 5);
    return child;
  };
  const config = {
    enabled: true, autoStart: false, gatePort: 3081, webHost: "127.0.0.1", webPort: 3080,
    tunnelName: "dsh-remote-unit", tunnelDescription: "dsh远控隧道", tunnelExpirationHours: 72,
    protocol: "auto", allowAnonymous: true, devbridgeBin: "/bin/echo", apiKeyEnv: "HW_API_KEY",
    reconnect: false, reconnectDelayMs: 10, reconnectMaxDelayMs: 10, connectTimeoutMs: 2000,
    logLevel: "silent",
  };
  const manager = new TunnelManager({
    config, state, logger: silent, exec, spawnFn, processGroup: false,
    // 默认禁用安装器，任何测试都不得真的去下载/执行官方安装脚本。
    installer: async () => ({ ok: false, reason: "测试环境禁用自动安装" }),
  });
  return { manager, calls, spawnCalls, state, tmp, getChild: () => child };
}

test("完整启动链：预检 → 建隧道 → 配端口 → 起 host → 拿到权威 URL", async () => {
  const { manager, calls, spawnCalls, state } = fixture();
  const st = await manager.start();
  assert.equal(st.phase, "hosting");
  assert.equal(st.tunnelId, "noh56s7x");
  assert.equal(st.tunnelUrl, TUNNEL_URL);
  assert.equal(st.authenticated, true);
  assert.equal(st.cliVersion, "0.2.2-release");
  assert.equal(state.get("tunnelUrl"), TUNNEL_URL, "URL 应持久化");

  const create = calls.find((a) => a[0] === "create" && !a.includes("--help"));
  assert.deepEqual(create, ["create", "dsh-remote-unit", "-d", "dsh远控隧道", "-e", "72"]);
  const port = calls.find((a) => a[0] === "port" && a[1] === "create" && !a.includes("--help"));
  assert.deepEqual(port, ["port", "create", "noh56s7x", "--port-number", "3081", "--protocol", "auto", "--allow-anonymous"]);
  assert.deepEqual(spawnCalls[0], ["host", "noh56s7x"]);

  const stopped = await manager.stop();
  assert.equal(stopped.phase, "stopped");
  assert.equal(stopped.pid, null);
});

test("v0.1.x 明确拦截并给出升级指引", async () => {
  const { manager } = fixture({ version: "v0.1.9-release" });
  const st = await manager.start();
  assert.equal(st.phase, "blocked");
  assert.equal(st.blocker, "cli-outdated");
  assert.match(st.lastError, /v0\.2\.x/);
});

test("未登录时明确拦截，不尝试创建隧道", async () => {
  const { manager, calls } = fixture({ auth: "" });
  const st = await manager.start();
  assert.equal(st.blocker, "auth-required");
  assert.equal(st.phase, "blocked");
  assert.equal(calls.some((a) => a[0] === "create"), false);
});

test("create 输出不含 ID 时，按隧道名从 list 反查", async () => {
  const { manager } = fixture();
  const original = manager.execFile;
  manager.execFile = async (...args) => {
    const r = await original(...args);
    const a = args[1];
    if (a[0] === "create" && !a.includes("--help")) return { stdout: "Tunnel created successfully\n", stderr: "" };
    if (a[0] === "list") return { stdout: `Tunnel ID  Name\n  dwskt2pg   ${manager.tunnelName}\n`, stderr: "" };
    return r;
  };
  await manager.start();
  assert.equal(manager.tunnelId, "dwskt2pg");
  assert.ok(manager.tunnelUrl);
  await manager.stop();
});

test("端口已存在时跳过 port create", async () => {
  const { manager, calls } = fixture();
  const original = manager.execFile;
  manager.execFile = async (...args) => {
    const r = await original(...args);
    if (args[1][0] === "port" && args[1][1] === "list") {
      return { stdout: "Tunnel ID  Port\n  noh56s7x   3081\n", stderr: "" };
    }
    return r;
  };
  await manager.start();
  assert.equal(calls.some((a) => a[0] === "port" && a[1] === "create"), false);
  await manager.stop();
});

test("host 输出无 URL 时不抛异常，状态里保留原因", async () => {
  const { manager } = fixture();
  manager.startHost = async () => {
    manager.phase = "hosting";
    manager.lastError = "host 已启动但未输出 Tunnel URL";
    return "";
  };
  const st = await manager.start();
  assert.equal(st.tunnelUrl, "");
  assert.match(st.lastError, /Tunnel URL/);
});

test("host 异常退出且关闭重连时不私自拉起新进程", async () => {
  const { manager, getChild, spawnCalls } = fixture();
  await manager.start();
  const hostsBefore = spawnCalls.length;
  getChild().emit("exit", 1, null);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(manager.phase, "hosting");
  assert.equal(spawnCalls.length, hostsBefore);
});

test("cli-missing 时运行时懒安装：补装成功后继续预检并起隧道", async () => {
  const { manager } = fixture();
  let installs = 0;
  manager.installer = async () => { installs += 1; return { ok: true, action: "installed", version: "0.2.2-release" }; };
  const realLocate = manager.locate.bind(manager);
  let first = true;
  manager.locate = async () => { if (first) { first = false; return ""; } return realLocate(); };

  const st = await manager.start();
  assert.equal(installs, 1, "应触发一次官方安装");
  assert.equal(st.phase, "hosting");
  assert.equal(st.tunnelUrl.length > 0, true);
  await manager.stop();
});

test("跳过自动安装时仍明确报 cli-missing，且安装失败会冷却", async () => {
  const { manager } = fixture();
  manager.autoInstall = false;
  manager.locate = async () => "";
  let st = await manager.start();
  assert.equal(st.blocker, "cli-missing");
  assert.match(st.lastError, /DEVBRIDGE_SKIP_INSTALL/);

  const { manager: m2 } = fixture();
  m2.locate = async () => "";
  let calls = 0;
  m2.installer = async () => { calls += 1; return { ok: false, reason: "网络不可达" }; };
  st = await m2.start();
  assert.equal(st.blocker, "cli-missing");
  assert.match(st.lastError, /网络不可达/);
  await m2.start();
  assert.equal(calls, 1, "失败冷却期内不应反复下载");
});

test("State：token 与隧道名稳定、文件权限 0600", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-state-"));
  const file = path.join(tmp, "nested", "state.json");
  const s = new State({ file, logger: silent });
  s.load();
  const t1 = s.ensureToken();
  s.load();
  assert.equal(s.ensureToken(), t1);
  assert.notEqual(s.rotateToken(), t1);
  assert.match(s.ensureTunnelName(), /^dsh-remote-/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
