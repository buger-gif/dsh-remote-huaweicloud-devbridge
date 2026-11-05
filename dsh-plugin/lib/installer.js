/**
 * 用华为云官方命令安装 / 升级 DevBridge CLI。
 *
 * 命令原样取自华为云官方：
 *   - 开发者空间 https://devstation.connect.huaweicloud.com/space/devbridge
 *   - 官方技能包 references/cli-installation-guide.md
 *
 * Linux / macOS（三个官方渠道任选其一，这里默认 GitCode，可切换）：
 *   curl -fsSL <官方 URL> -o /tmp/devbridge_install.sh
 *   bash /tmp/devbridge_install.sh -s          # headless/自动化必须 -s
 * Windows（PowerShell）：
 *   irm https://github.com/huaweicloud/devspace-devbridge/releases/latest/download/install.ps1 | iex
 *
 * 官方脚本同时用于「安装」与「升级」：静默模式会比对 SHA256，已是最新就跳过。
 * 本模块只做三件事：检测 → 下载到本地临时文件并校验 → 执行官方命令 → 复核版本。
 * 不允许从环境变量覆盖官方 URL（避免被劫持）；只提供跳过开关 DEVBRIDGE_SKIP_INSTALL。
 *
 * postinstall 与运行时懒安装共用这里的实现，零第三方依赖。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const SKIP_ENV = "DEVBRIDGE_SKIP_INSTALL";
export const OFFICIAL_SOURCES = Object.freeze({
  gitcode: "https://gitcode.com/CloudDeveloperDepartment/devbrige/releases/download/latest/install.sh",
  github: "https://github.com/huaweicloud/devspace-devbridge/releases/latest/download/install.sh",
  obs: "https://tools-artifact.developer.huaweicloud.com/sharedata/devbridge/install.sh",
});
export const OFFICIAL_PS1 = "https://github.com/huaweicloud/devspace-devbridge/releases/latest/download/install.ps1";
export const DEFAULT_SOURCE = "gitcode";

const execFileAsync = promisify(execFile);
const defaultExec = (cmd, args, opts = {}) => execFileAsync(cmd, args, {
  timeout: 60000,
  maxBuffer: 8 * 1024 * 1024,
  ...opts,
});

export function officialInstallUrl(source = DEFAULT_SOURCE, platform = process.platform) {
  return platform === "win32" ? OFFICIAL_PS1 : (OFFICIAL_SOURCES[source] || OFFICIAL_SOURCES[DEFAULT_SOURCE]);
}

export function defaultCliPath(home = os.homedir(), platform = process.platform) {
  return path.join(home, ".huawei", "bin", platform === "win32" ? "devbridge.exe" : "devbridge");
}

export function parseVersion(text) {
  const m = String(text || "").match(/(\d+\.\d+\.\d+(?:[^\s]*))/);
  return m ? m[1] : "";
}

/** v0.1.x 在 2026-09-20 域名升级后已无法连接，必须升级。 */
export function needsInstall(found, version) {
  if (!found) return true;
  if (!version) return true;
  return /^0\.1\./.test(version);
}

async function probe(bin, exec) {
  try {
    const r = await exec(bin, ["version"], { timeout: 10000 });
    return { found: true, bin, version: parseVersion(`${r.stdout || ""} ${r.stderr || ""}`) };
  } catch {
    return { found: false, bin, version: "" };
  }
}

/** 返回 { ok, action, version, url, reason }。任何失败都不抛，由调用方决定如何降级。 */
export async function ensureDevbridge({
  logger = console,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  tmpDir = os.tmpdir(),
  source = DEFAULT_SOURCE,
  exec = defaultExec,
  explicitBin = "",
} = {}) {
  const log = (...a) => {
    try {
      if (typeof logger?.info === "function") logger.info(...a);
      else if (typeof logger?.log === "function") logger.log(...a);
    } catch { /* noop */ }
  };

  if (env[SKIP_ENV] && !["0", "false", "no", "off"].includes(String(env[SKIP_ENV]).toLowerCase())) {
    return { ok: true, action: "skipped-by-env", version: "", reason: `${SKIP_ENV} 已设置` };
  }

  const candidates = [explicitBin, defaultCliPath(home, platform), "devbridge"].filter(Boolean);
  let found = { found: false, bin: "", version: "" };
  for (const bin of candidates) {
    found = await probe(bin, exec);
    if (found.found) break;
  }
  if (!needsInstall(found.found, found.version)) {
    return { ok: true, action: "already-installed", version: found.version, bin: found.bin };
  }

  const url = officialInstallUrl(source, platform);
  log(`[devbridge] 未检测到 v0.2.x CLI（当前 ${found.version || "未安装"}），执行华为云官方安装命令：${url}`);

  let tmp = "";
  try {
    if (platform === "win32") {
      // 官方 Windows 命令原文：irm <url> | iex
      await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `irm ${url} | iex`], { timeout: 180000 });
    } else {
      tmp = path.join(tmpDir, `devbridge-install-${process.pid}-${crypto.randomBytes(6).toString("hex")}.sh`);
      // 官方命令：curl -fsSL <url> -o <file>，再 bash <file> -s（headless 静默）
      await exec("curl", ["-fsSL", "--max-time", "60", url, "-o", tmp], { timeout: 70000 });
      const body = fs.readFileSync(tmp, "utf8");
      if (!body.trim() || !body.startsWith("#!")) throw new Error("下载内容不是可执行的官方安装脚本");
      await exec("bash", [tmp, "-s"], { timeout: 180000 });
    }
  } catch (e) {
    return {
      ok: false,
      action: "install-failed",
      version: "",
      url,
      reason: `官方安装命令执行失败：${e?.message || String(e)}`,
    };
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ } }
  }

  const after = await probe(defaultCliPath(home, platform), exec);
  if (needsInstall(after.found, after.version)) {
    return { ok: false, action: "verify-failed", version: after.version, url, reason: "安装后仍无法执行 devbridge version" };
  }
  log(`[devbridge] 安装完成：${after.bin} v${after.version}`);
  return {
    ok: true,
    action: found.found ? "upgraded" : "installed",
    version: after.version,
    bin: after.bin,
    url,
  };
}
