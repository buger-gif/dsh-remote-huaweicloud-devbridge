import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureDevbridge, officialInstallUrl, defaultCliPath, parseVersion, needsInstall,
  OFFICIAL_SOURCES, OFFICIAL_PS1, SKIP_ENV,
} from "../lib/installer.js";

/** 可注入的 exec：记录每条命令，并模拟「安装后 version 才可用」。 */
function harness({ initialVersion = null, installedVersion = "0.2.2-release", failCurl = false, failBash = false, scriptBody = "#!/usr/bin/env bash\necho ok\n" } = {}) {
  const calls = [];
  let version = initialVersion;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-installer-"));
  const exec = async (cmd, args, _opts) => {
    calls.push({ cmd, args });
    if (cmd === "curl") {
      if (failCurl) throw new Error("curl: network down");
      const i = args.indexOf("-o");
      if (i >= 0) fs.writeFileSync(args[i + 1], scriptBody);
      return { stdout: "", stderr: "" };
    }
    if (cmd === "bash" || cmd === "powershell") {
      if (failBash) throw new Error("install script failed");
      version = installedVersion;
      return { stdout: "", stderr: "" };
    }
    if (args?.[0] === "version") {
      if (version === null) throw new Error("command not found");
      return { stdout: `${version}\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  return { calls, exec, home };
}

const base = (h, extra = {}) => ({
  logger: { info() {}, log() {} },
  env: {},
  platform: "linux",
  home: h.home,
  tmpDir: h.home,
  exec: h.exec,
  ...extra,
});

test("纯函数：版本解析、升级判定、官方 URL 白名单", () => {
  assert.equal(parseVersion("devbridge version v0.2.2-release\n"), "0.2.2-release");
  assert.equal(parseVersion("0.1.9-release"), "0.1.9-release");
  assert.equal(parseVersion(""), "");
  assert.equal(needsInstall(false, ""), true);
  assert.equal(needsInstall(true, "0.1.9-release"), true, "v0.1.x 必须升级");
  assert.equal(needsInstall(true, "0.2.2-release"), false);
  assert.equal(needsInstall(true, ""), true);

  assert.equal(officialInstallUrl("gitcode", "darwin"), OFFICIAL_SOURCES.gitcode);
  assert.equal(officialInstallUrl("github", "linux"), OFFICIAL_SOURCES.github);
  assert.equal(officialInstallUrl("obs", "linux"), OFFICIAL_SOURCES.obs);
  assert.equal(officialInstallUrl("https://evil.example/x.sh", "linux"), OFFICIAL_SOURCES.gitcode,
    "不允许用非官方 URL 覆盖安装源");
  assert.equal(officialInstallUrl("gitcode", "win32"), OFFICIAL_PS1);
  assert.ok(defaultCliPath("/home/u", "linux").endsWith(".huawei/bin/devbridge"));
  assert.ok(defaultCliPath("/home/u", "win32").endsWith("devbridge.exe"));
});

test("已装 v0.2.x：直接跳过，不下载不执行", async () => {
  const h = harness({ initialVersion: "0.2.2-release" });
  const r = await ensureDevbridge(base(h));
  assert.equal(r.action, "already-installed");
  assert.equal(r.ok, true);
  assert.equal(h.calls.some((c) => c.cmd === "curl"), false);
});

test("未安装：原样执行华为云官方命令（curl -fsSL 官方URL -o 文件 + bash 文件 -s）", async () => {
  const h = harness({ initialVersion: null });
  const r = await ensureDevbridge(base(h));
  assert.equal(r.ok, true);
  assert.equal(r.action, "installed");
  assert.equal(r.version, "0.2.2-release");

  const curl = h.calls.find((c) => c.cmd === "curl");
  assert.ok(curl, "应调用 curl");
  assert.ok(curl.args.includes("-fsSL"));
  assert.ok(curl.args.includes(OFFICIAL_SOURCES.gitcode), "必须是华为云官方渠道 URL");
  assert.ok(curl.args.includes("-o"));
  assert.ok(curl.args.some((a) => a.endsWith(".sh")), "官方要求先落到本地文件");

  const bash = h.calls.find((c) => c.cmd === "bash");
  assert.ok(bash, "应执行安装脚本");
  assert.equal(bash.args[1], "-s", "headless/自动化必须 -s");
  assert.ok(bash.args[0].endsWith(".sh"));
  assert.equal(fs.existsSync(bash.args[0]), false, "临时脚本必须清理");
});

test("v0.1.x：同一官方命令用于升级", async () => {
  const h = harness({ initialVersion: "0.1.9-release" });
  const r = await ensureDevbridge(base(h, { source: "github" }));
  assert.equal(r.action, "upgraded");
  assert.ok(h.calls.find((c) => c.cmd === "curl").args.includes(OFFICIAL_SOURCES.github));
});

test("Windows：用官方 PowerShell 命令 irm <官方URL> | iex", async () => {
  const h = harness({ initialVersion: null });
  const r = await ensureDevbridge(base(h, { platform: "win32" }));
  assert.equal(r.ok, true);
  const ps = h.calls.find((c) => c.cmd === "powershell");
  assert.ok(ps);
  assert.match(ps.args.at(-1), /irm .* | iex/);
  assert.ok(ps.args.at(-1).includes(OFFICIAL_PS1));
  assert.equal(h.calls.some((c) => c.cmd === "curl"), false);
});

test(`${SKIP_ENV}=1 完全跳过，且不会误判为安装成功`, async () => {
  const h = harness({ initialVersion: null });
  const r = await ensureDevbridge(base(h, { env: { [SKIP_ENV]: "1" } }));
  assert.equal(r.action, "skipped-by-env");
  assert.equal(h.calls.some((c) => c.cmd === "curl"), false);
});

test("下载失败 / 内容不是脚本 / 安装失败：都返回失败而不抛异常", async () => {
  for (const opts of [
    { failCurl: true },
    { failBash: true },
    { scriptBody: "not a shell script" },
  ]) {
    const h = harness({ initialVersion: null, ...opts });
    const r = await ensureDevbridge(base(h));
    assert.equal(r.ok, false, `应失败：${JSON.stringify(opts)}`);
    assert.ok(r.reason);
  }
});

test("包声明：postinstall / bin / publishConfig 指向的文件都在", () => {
  const root = path.dirname(new URL(import.meta.url).pathname);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "..", "package.json"), "utf8"));
  assert.match(pkg.scripts.postinstall, /scripts\/postinstall\.mjs/);
  assert.equal(pkg.publishConfig.access, "public");
  assert.ok(fs.existsSync(path.join(root, "..", pkg.bin["dsh-devbridge-install"])));
  assert.ok(pkg.files.includes("scripts"), "npm 包必须带 scripts/");
  assert.ok(pkg.files.includes("lib"), "运行时懒安装依赖 lib/installer.js");
  const postinstall = fs.readFileSync(path.join(root, "..", "scripts", "postinstall.mjs"), "utf8");
  assert.match(postinstall, /process\.exit\(0\)/, "安装失败不能让 npm install 失败");
});
