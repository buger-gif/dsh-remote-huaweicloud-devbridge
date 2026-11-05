#!/usr/bin/env node
/**
 * 独立体检：不依赖 DSH 进程，任何终端都能跑。
 *   node scripts/doctor.mjs
 * 退出码 0 = 全部就绪；1 = 有警告；2 = 有阻塞项。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const cwd = process.cwd();

const rows = [];
function add(level, label, detail) {
  rows.push({ level, label, detail });
  const mark = level === "ok" ? "✓" : level === "warn" ? "!" : "✗";
  console.log(`${mark} ${label}${detail ? `\n    ${detail}` : ""}`);
}

function findCli() {
  const candidates = [
    process.env.DEVBRIDGE_BIN,
    path.join(os.homedir(), ".huawei", "bin", "devbridge"),
    "/usr/local/bin/devbridge",
    "/opt/homebrew/bin/devbridge",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) { fs.accessSync(c, fs.constants.X_OK); return c; }
    } catch { /* next */ }
  }
  try {
    return execFileSync("which", ["devbridge"], { encoding: "utf8" }).trim();
  } catch { return ""; }
}

function cliRun(bin, args) {
  try {
    return { ok: true, out: execFileSync(bin, args, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}${e.message || ""}` };
  }
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(600);
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    s.on("timeout", () => done(false));
  });
}

console.log("DevBridge 远控 · 环境体检\n" + "=".repeat(46));

// 1. 运行时
const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) add("ok", "Node.js", `${process.version}（要求 >= 22.5）`);
else add("bad", "Node.js", `${process.version} 过旧，DSH 0.2.x 需要 >= 22.5`);

// 2. 插件文件
const needed = ["package.json", "cordis.patch.yml", "lib/index.js", "lib/client.js", "lib/gate.js", "lib/tunnel.js", "web/panel.js"];
const missing = needed.filter((f) => !fs.existsSync(path.join(root, f)));
if (!missing.length) add("ok", "插件文件", `${needed.length} 个关键文件齐全（${root}）`);
else add("bad", "插件文件", `缺失：${missing.join(", ")}；先运行 node scripts/build-client.mjs`);

// 3. DevBridge CLI
const bin = findCli();
if (!bin) {
  add("bad", "devbridge CLI", "未找到。安装：sh scripts/install-cli.sh；需 v0.2.x（v0.1.x 旧域名已停用）");
} else {
  const v = cliRun(bin, ["version"]);
  const text = (v.out || "").trim();
  const ver = (text.match(/v?(\d+\.\d+\.\d+[^\s]*)/) || [])[1] || "";
  if (/^0\.1\./.test(ver)) add("bad", "devbridge CLI", `${bin} 是 v${ver}，必须升级到 v0.2.x 并重建隧道`);
  else if (ver) add("ok", "devbridge CLI", `${bin} · v${ver}`);
  else add("warn", "devbridge CLI", `${bin} 版本号解析失败：${text.slice(0, 120)}`);

  const auth = cliRun(bin, ["auth", "status"]);
  if (auth.ok && !/not\s+logged|unauthenticated|未登录/i.test(auth.out)) add("ok", "DevBridge 鉴权", "已登录");
  else add("bad", "DevBridge 鉴权", "未登录。执行 devbridge auth login，或用 API Key：devbridge auth login --api-key \"$HW_API_KEY\"");
}

// 4. API Key 环境变量（不打印值）
if (process.env.HW_API_KEY || process.env.DEVBRIDGE_API_KEY) add("ok", "API Key 环境变量", "已设置（值不显示）");
else add("warn", "API Key 环境变量", "未设置。交互式登录可用；无人值守/自动重连建议配置 HW_API_KEY");

// 5. profile 安装情况
for (const profile of ["web", "desktop"]) {
  const pkg = path.join(home, "profiles", profile, "package.json");
  try {
    const j = JSON.parse(fs.readFileSync(pkg, "utf8"));
    const deps = j.dependencies || {};
    const bundles = j.dsh?.profile?.bundles || [];
    const installed = Object.keys(deps).includes("dsh-remote-huaweicloud-devbridge") ||
      bundles.includes("dsh-remote-huaweicloud-devbridge");
    if (installed) add("ok", `profile/${profile}`, "插件已登记");
    else add("warn", `profile/${profile}`, `未安装。dsh plugin --profile ${profile} add ${root}`);
  } catch {
    add("warn", `profile/${profile}`, "package.json 不存在或不可读");
  }
}

// 6. 端口
const gatePort = Number(process.env.DEVBRIDGE_REMOTE_GATE_PORT || 3081);
const webPort = Number(process.env.DSH_WEB_PORT || 3080);
const [webUp, gateUp] = await Promise.all([portOpen(webPort), portOpen(gatePort)]);
if (webUp) add("ok", `DSH Web :${webPort}`, "正在监听");
else add("warn", `DSH Web :${webPort}`, "未监听（插件会在 DSH 启动后接管；远端访问需先启动 DSH）");
if (gateUp) add("ok", `鉴权网关 :${gatePort}`, "正在监听");
else add("warn", `鉴权网关 :${gatePort}`, "未监听（DSH 未启动或插件未加载）");

// 7. 状态文件权限
const stateFile = path.join(home, "devbridge-remote", "state.json");
if (fs.existsSync(stateFile)) {
  const mode = fs.statSync(stateFile).mode & 0o777;
  if (mode === 0o600) add("ok", "状态文件权限", `${stateFile} (0600)`);
  else add("warn", "状态文件权限", `${stateFile} 是 ${mode.toString(8)}，建议 chmod 600`);
} else add("warn", "状态文件", "尚未生成（插件首次启动后创建）");

const bad = rows.filter((r) => r.level === "bad").length;
const warn = rows.filter((r) => r.level === "warn").length;
console.log("=".repeat(46));
console.log(`结果：${rows.length - bad - warn} 项正常 / ${warn} 项提醒 / ${bad} 项阻塞`);
if (bad) {
  console.log("\n阻塞项处理顺序：安装 CLI → 登录 DevBridge → 安装插件 → 重启 DSH。");
  console.log("参考：" + path.join(root, "README.md"));
}
console.log(`\n（当前工作目录 ${cwd}；如需指定 DSH_HOME，可设置环境变量后重跑）`);
process.exit(bad ? 2 : warn ? 1 : 0);
