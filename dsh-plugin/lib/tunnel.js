/**
 * DevBridge CLI 适配层（v0.2.x）。
 *
 * 设计要点，全部对应华为云官方 devbridge skill 的硬性约束：
 *  - 只支持 v0.2.x；v0.1.x 的 AK/SK 和旧域名已失效。
 *  - 不假定 flag 名字：每个子命令先读 `--help` 再拼参数；遇到 unknown flag
 *    会去掉该 flag 重试一次（cobra 常见报错恢复）。
 *  - Tunnel URL 一律以 `host` 实际输出为准，绝不按文档拼域名。
 *  - host 是常驻子进程，由插件生命周期持有；DSH 退出时一并回收。
 *
 * 本文件只依赖 node 内置模块，并允许注入 exec/spawn 以便离线自测。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ensureDevbridge } from "./installer.js";

const execFileAsync = promisify(execFile);

export const URL_RE = /https?:\/\/[^\s"'<>\]\)]+/gi;

/** 从一段 CLI 输出里挑出可信的隧道公网 URL。 */
export function extractTunnelUrl(text) {
  if (!text) return "";
  // host 输出里的 "Tunnel URL: <url>" 是权威来源，优先于任何打分启发式。
  const labeled = String(text).match(/Tunnel\s*URL\s*[:=]\s*(https?:\/\/[^\s"'<>\]\)]+)/i);
  if (labeled) return labeled[1].replace(/[.,;]+$/, "");
  const urls = String(text).match(URL_RE) || [];
  const scored = urls
    .map((u) => u.replace(/[.,;]+$/, ""))
    .filter((u) => /^https:\/\//i.test(u))
    .map((u) => ({
      u,
      score: /hwtunnel|devbridge|myhuaweicloud/i.test(u) ? 2 : /tunnel\s*url/i.test(String(text)) ? 1 : 0,
    }))
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].u : "";
}

/** 从 create 输出 / list 表格里取 tunnelId。 */
export function extractTunnelId(text) {
  if (!text) return "";
  const s = String(text);
  const labeled = s.match(/Tunnel\s*ID\s*[:=]\s*([a-z0-9]{6,16})\b/i);
  if (labeled) return labeled[1];
  const created = s.match(/(?:created|create(?:d)?\s+tunnel)[^\n]*?\b([a-z0-9]{8})\b/i);
  if (created) return created[1];
  // db_create 的契约：stdout 只有一行 ID。
  const bare = s.trim().match(/^([a-z0-9]{6,16})$/i);
  if (bare) return bare[1];
  // 兜底：形如 "Tunnel created: noh56s7x expires ..." 的输出，取第一个短 ID。
  if (/tunnel/i.test(s)) {
    const loose = s.match(/\b([a-z0-9]{8})\b/i);
    if (loose) return loose[1];
  }
  return "";
}

/** 按隧道名从 `devbridge list` 的表格里反查 ID（用于名称冲突时复用）。 */
export function findIdByName(listText, name) {
  if (!listText || !name) return "";
  const lines = String(listText).split(/\r?\n/);
  for (const line of lines) {
    const cols = line.trim().split(/\s{2,}|\t+/);
    if (cols.length >= 2 && cols[1] === name && /^[a-z0-9]{6,16}$/i.test(cols[0])) {
      return cols[0];
    }
  }
  // 表格列宽/分隔符随版本变化：退而求其次，在含该名字的行里取第一个短 ID。
  for (const line of lines) {
    if (!line.includes(name)) continue;
    const m = line.trim().match(/\b([a-z0-9]{6,16})\b/i);
    if (m && m[1] !== name) return m[1];
  }
  return "";
}

/** 从 --help 文本里挑第一个真实存在的 flag。 */
export function pickFlag(help, candidates) {
  for (const flag of candidates) {
    if (help.includes(flag)) return flag;
  }
  return "";
}

function cliCandidates(explicit) {
  const out = [];
  if (explicit) out.push(explicit);
  out.push(path.join(os.homedir(), ".huawei", "bin", "devbridge"));
  out.push("/usr/local/bin/devbridge");
  out.push("/opt/homebrew/bin/devbridge");
  return out;
}

export class TunnelManager {
  /**
   * @param {object} opts
   * @param {object} opts.config resolveConfig() 的结果
   * @param {object} opts.state State 实例
   * @param {object} opts.logger Log 实例
   * @param {function} [opts.exec] 可注入的 execFileAsync(path, args, opts) => {stdout, stderr}
   * @param {function} [opts.spawnFn] 可注入的 spawn
   */
  constructor({ config, state, logger, exec = null, spawnFn = null, processGroup = true, installer = null } = {}) {
    this.config = config;
    this.state = state;
    this.log = logger;
    this.execFile = exec || ((bin, args, opts = {}) => execFileAsync(bin, args, {
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
      ...opts,
    }));
    this.spawnFn = spawnFn || spawn;
    this.processGroup = processGroup;
    // 安装器可注入（自测用）；默认复用 this.execFile，避免在测试里真的去下载。
    this.installer = installer || ((opts) => ensureDevbridge({ ...opts, exec: this.execFile }));
    this.autoInstall = !process.env.DEVBRIDGE_SKIP_INSTALL;
    this.installCooldownUntil = 0;
    this.lastInstall = null;

    this.phase = "idle"; // idle | checking | ready | hosting | reconnecting | blocked | stopped
    this.blocker = "";
    this.cliPath = "";
    this.cliVersion = "";
    this.authenticated = false;
    this.tunnelId = state.get("tunnelId", "") || "";
    this.tunnelName = config.tunnelName || state.ensureTunnelName();
    this.tunnelUrl = state.get("tunnelUrl", "") || "";
    this.pid = null;
    this.lastError = "";
    this.hostChild = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.startedAt = 0;
    this.disposed = false;
    this.outputTail = [];
  }

  status() {
    return {
      phase: this.phase,
      blocker: this.blocker,
      cliPath: this.cliPath,
      cliVersion: this.cliVersion,
      authenticated: this.authenticated,
      tunnelId: this.tunnelId,
      tunnelName: this.tunnelName,
      tunnelUrl: this.tunnelUrl,
      gatePort: this.config.gatePort,
      pid: this.pid,
      startedAt: this.startedAt,
      lastError: this.lastError,
      retryCount: this.retryCount,
      outputTail: this.outputTail.slice(-12),
    };
  }

  #block(code, message) {
    this.phase = "blocked";
    this.blocker = code;
    this.lastError = message;
    this.log.error(`${code}: ${message}`);
    return false;
  }

  /**
   * 运行时懒安装兜底：pnpm 10+/11 默认不跑第三方依赖的 postinstall，
   * 所以 `dsh plugin add` 之后 CLI 仍可能缺失。首次「开启远控」时用华为云官方命令补装。
   * 失败后冷却 10 分钟，避免每次状态轮询都去下载。
   */
  async #autoInstall(reason) {
    if (!this.autoInstall) {
      this.lastInstall = { ok: false, reason: "自动安装已由 DEVBRIDGE_SKIP_INSTALL 关闭" };
      return this.lastInstall;
    }
    if (Date.now() < this.installCooldownUntil) {
      return { ok: false, reason: this.lastInstall?.reason || "上一次安装失败，冷却中" };
    }
    this.log.info(`${reason}，执行华为云官方安装命令安装 DevBridge CLI…`);
    let result;
    try {
      result = await this.installer({ logger: this.log, explicitBin: this.config.devbridgeBin });
    } catch (e) {
      result = { ok: false, reason: e?.message || String(e) };
    }
    this.lastInstall = result;
    if (!result?.ok || result.action === "skipped-by-env") {
      this.installCooldownUntil = Date.now() + 10 * 60 * 1000;
      return { ok: false, reason: result?.reason || result?.action || "安装失败" };
    }
    this.cliPath = "";
    this.installCooldownUntil = 0;
    return { ok: true, version: result.version, action: result.action };
  }

  /** 定位 CLI；不做任何安装动作，安装交给 scripts/install-cli.sh。 */
  async locate() {
    for (const candidate of cliCandidates(this.config.devbridgeBin)) {
      const absolute = candidate.includes(path.sep) || candidate.startsWith(".");
      if (absolute) {
        try {
          if (!fs.statSync(candidate).isFile()) continue;
          fs.accessSync(candidate, fs.constants.X_OK);
          this.cliPath = candidate;
          return candidate;
        } catch { /* 继续找 */ }
      } else {
        this.cliPath = candidate; // 交给 PATH 解析
        return candidate;
      }
    }
    // 最后试 PATH 上的裸命令
    try {
      const { stdout } = await this.execFile("which", ["devbridge"], { timeout: 5000 });
      if (stdout?.trim()) {
        this.cliPath = stdout.trim();
        return this.cliPath;
      }
    } catch { /* noop */ }
    return "";
  }

  async #run(args, { timeout = 30000, allowFailure = false } = {}) {
    if (!this.cliPath) throw new Error("devbridge CLI 未定位");
    try {
      const { stdout, stderr } = await this.execFile(this.cliPath, args, { timeout });
      return { ok: true, stdout: String(stdout || ""), stderr: String(stderr || ""), code: 0 };
    } catch (e) {
      if (allowFailure) {
        return {
          ok: false,
          stdout: String(e.stdout || ""),
          stderr: String(e.stderr || e.message || ""),
          code: Number(e.code) || 1,
        };
      }
      throw e;
    }
  }

  /** 读子命令 help；CLI 版本差异都靠这一步消化。 */
  async #help(command) {
    const r = await this.#run(command ? [...command, "--help"] : ["--help"], { allowFailure: true });
    return `${r.stdout}\n${r.stderr}`;
  }

  /** 预检：CLI 存在 → 版本 ≥ v0.2 → 已登录。任何一步不满足都给出明确 blocker。 */
  async preflight() {
    this.phase = "checking";
    this.blocker = "";
    this.lastError = "";

    let bin = await this.locate();
    if (!bin) {
      const installed = await this.#autoInstall("未找到 devbridge CLI");
      if (installed.ok) {
        bin = await this.locate();
        if (bin) this.log.info(`官方命令已装好 CLI：v${installed.version || "?"}（${installed.action}）`);
      }
    }
    if (!bin) {
      const detail = this.lastInstall?.ok
        ? "安装完成但仍未定位到可执行文件，检查 ~/.huawei/bin 或设置 DEVBRIDGE_BIN"
        : (this.lastInstall?.reason || "运行 node scripts/doctor.mjs 查看安装指引");
      return this.#block(
        "cli-missing",
        `找不到 devbridge CLI（期望 ~/.huawei/bin/devbridge，v0.2.x）。${detail}`,
      );
    }

    const v = await this.#run(["version"], { allowFailure: true, timeout: 10000 });
    const text = `${v.stdout} ${v.stderr}`;
    this.cliVersion = (text.match(/v?(\d+\.\d+\.\d+[^\s]*)/) || [])[1] || text.trim().slice(0, 60);
    if (!v.ok && !this.cliVersion) {
      return this.#block("cli-broken", `devbridge version 执行失败：${text.trim().slice(0, 200)}`);
    }
    if (/^0\.1\./.test(this.cliVersion)) {
      return this.#block(
        "cli-outdated",
        `检测到 v${this.cliVersion}。2026-09-20 域名升级后 v0.1.x 已无法连接，必须升级到 v0.2.x 并重建隧道。`,
      );
    }

    const auth = await this.#run(["auth", "status"], { allowFailure: true, timeout: 10000 });
    const authText = `${auth.stdout} ${auth.stderr}`;
    this.authenticated = auth.ok && !/not\s+logged|unauthenticated|login\s+required|未登录/i.test(authText);
    if (!this.authenticated) {
      return this.#block(
        "auth-required",
        "DevBridge 未登录。执行 devbridge auth login（浏览器登录），或设置 HW_API_KEY 后执行 devbridge auth login --api-key \"$HW_API_KEY\"。",
      );
    }

    this.phase = "ready";
    this.log.info(`CLI ${this.cliPath} v${this.cliVersion}，鉴权正常`);
    return true;
  }

  /** 创建隧道；名称已存在时复用既有 ID，不重复创建。 */
  async ensureTunnel() {
    const help = await this.#help(["create"]);
    const descFlag = pickFlag(help, ["-d", "--description"]);
    const expFlag = pickFlag(help, ["-e", "--expiration", "--expire", "--expiration-hours"]);
    const args = ["create", this.tunnelName];
    if (descFlag) args.push(descFlag, String(this.config.tunnelDescription || "dsh远控隧道").replace(/\s+/g, ""));
    if (expFlag) args.push(expFlag, String(this.config.tunnelExpirationHours));

    let r = await this.#run(args, { allowFailure: true });
    if (!r.ok && /unknown flag|unknown shorthand/i.test(r.stderr)) {
      // 去掉最后一个可疑 flag 再试一次，兼容裁剪过的 CLI 构建。
      const fallback = ["create", this.tunnelName];
      this.log.warn("create 参数不被支持，回退到最小参数集", r.stderr.trim().slice(0, 160));
      r = await this.#run(fallback, { allowFailure: true });
    }

    let id = extractTunnelId(r.stdout) || extractTunnelId(`${r.stdout}\n${r.stderr}`);
    const nameTaken = /already (in use|exists)|name.*exist|重复|已存在/i.test(`${r.stderr} ${r.stdout}`);
    // create 的输出格式随版本变化：只要没拿到 ID，就一律用隧道名去 list 反查。
    // 这同时覆盖了「名称已存在需复用」的场景，比依赖报错文案更可靠。
    if (!id || nameTaken) {
      const list = await this.#run(["list"], { allowFailure: true });
      const found = findIdByName(`${list.stdout}\n${list.stderr}`, this.tunnelName);
      if (found && (!id || nameTaken)) {
        id = found;
        this.log.info(nameTaken ? `隧道名已存在，复用 ${id}` : `从 list 反查到隧道 ${id}`);
      }
    }
    if (!id) {
      throw new Error(`创建隧道失败：${(r.stderr || r.stdout).trim().slice(0, 300) || "无输出"}`);
    }
    this.tunnelId = id;
    this.state.patch({ tunnelId: id, tunnelName: this.tunnelName });
    return id;
  }

  /** 配置端口；已存在则跳过。匿名策略由插件门禁兜底，默认允许以便手机直接扫码。 */
  async ensurePort() {
    const id = this.tunnelId;
    const port = this.config.gatePort;
    const list = await this.#run(["port", "list", id], { allowFailure: true });
    const existing = `${list.stdout}\n${list.stderr}`;
    const portPresent = new RegExp(`(^|\\D)${port}(\\D|$)`).test(existing);
    if (portPresent) {
      this.log.info(`端口 ${port} 已在隧道 ${id} 上配置，跳过创建`);
      return true;
    }

    const help = await this.#help(["port", "create"]);
    const portFlag = pickFlag(help, ["--port-number", "-p", "--port"]);
    const protoFlag = pickFlag(help, ["--protocol"]);
    const anonFlag = pickFlag(help, ["--allow-anonymous", "-a"]);
    const denyFlag = pickFlag(help, ["--deny-anonymous"]);

    const args = ["port", "create", id];
    if (portFlag) args.push(portFlag, String(port));
    if (protoFlag && this.config.protocol) args.push(protoFlag, this.config.protocol);
    if (this.config.allowAnonymous && anonFlag) args.push(anonFlag);
    if (!this.config.allowAnonymous && denyFlag) args.push(denyFlag);

    let r = await this.#run(args, { allowFailure: true });
    if (!r.ok && /unknown flag|unknown shorthand/i.test(r.stderr)) {
      const minimal = ["port", "create", id, ...(portFlag ? [portFlag, String(port)] : [])];
      this.log.warn("port create 参数回退", r.stderr.trim().slice(0, 160));
      r = await this.#run(minimal, { allowFailure: true });
    }
    if (!r.ok && !/already|exist|重复/i.test(`${r.stderr} ${r.stdout}`)) {
      throw new Error(`配置端口失败：${(r.stderr || r.stdout).trim().slice(0, 300) || "无输出"}`);
    }
    this.log.info(`端口 ${port} 已绑定隧道 ${id}`);
    return true;
  }

  /** 启动常驻 host 进程，解析公网 URL，挂看护。 */
  async startHost() {
    if (this.hostChild && this.hostChild.exitCode === null) return this.tunnelUrl;
    const args = ["host", this.tunnelId];
    this.log.info(`启动 devbridge ${args.join(" ")}`);
    const child = this.spawnFn(this.cliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: { ...process.env },
    });
    this.hostChild = child;
    this.pid = child.pid ?? null;
    this.startedAt = Date.now();
    this.phase = "hosting";
    this.outputTail = [];

    const onData = (chunk) => {
      const text = String(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.outputTail.push(line.trim());
        if (this.outputTail.length > 40) this.outputTail.shift();
        this.log.debug("host:", line.trim().slice(0, 300));
      }
      const url = extractTunnelUrl(text);
      if (url && url !== this.tunnelUrl) {
        this.tunnelUrl = url;
        this.retryCount = 0;
        this.state.patch({ tunnelUrl: url });
        this.log.info(`Tunnel URL: ${url}`);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      this.lastError = `host 进程错误: ${e.message}`;
      this.log.error(this.lastError);
    });
    child.on("exit", (code, signal) => {
      this.hostChild = null;
      this.pid = null;
      if (this.disposed || this.phase === "stopped") return;
      this.log.warn(`host 退出 (code=${code}, signal=${signal || "none"})`);
      this.tunnelUrl = "";
      this.#scheduleReconnect();
    });

    // 最多等 connectTimeoutMs 拿 URL；拿不到也不阻塞插件，面板会显示错误。
    const deadline = Date.now() + this.config.connectTimeoutMs;
    while (!this.tunnelUrl && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      if (!this.hostChild) break;
    }
    if (!this.tunnelUrl) {
      this.lastError = "host 已启动但未输出 Tunnel URL；请检查 host 日志与中继连通性";
      this.log.warn(this.lastError);
    }
    return this.tunnelUrl;
  }

  #scheduleReconnect() {
    if (!this.config.reconnect || this.disposed || this.retryTimer) return;
    this.phase = "reconnecting";
    this.retryCount += 1;
    const delay = Math.min(
      this.config.reconnectMaxDelayMs,
      this.config.reconnectDelayMs * 2 ** Math.min(this.retryCount - 1, 4),
    );
    this.log.info(`${delay / 1000}s 后第 ${this.retryCount} 次重连`);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      try {
        await this.start();
      } catch (e) {
        this.lastError = e.message;
        this.log.error("重连失败:", e.message);
      }
    }, delay);
    this.retryTimer.unref?.();
  }

  /** 完整启动链：预检 → 建/复用隧道 → 配端口 → 起 host。 */
  async start() {
    if (this.disposed) throw new Error("manager disposed");
    if (!this.config.enabled) throw new Error("插件已在配置中禁用");
    if (this.phase === "hosting" && this.hostChild) return this.status();

    const ok = await this.preflight();
    if (!ok) return this.status();
    if (!this.tunnelId) await this.ensureTunnel();
    await this.ensurePort();
    await this.startHost();
    return this.status();
  }

  async stop() {
    this.phase = "stopped";
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const child = this.hostChild;
    this.hostChild = null;
    if (child && child.exitCode === null) {
      // 先挂监听再发信号：fake/极快退出的进程可能在 kill() 内同步 emit('exit')。
      const exited = new Promise((r) => child.once("exit", r));
      try {
        if (this.processGroup && process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        try { child.kill("SIGTERM"); } catch { /* noop */ }
      }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
      if (child.exitCode === null) {
        try { child.kill("SIGKILL"); } catch { /* noop */ }
      }
    }
    this.pid = null;
    this.tunnelUrl = "";
    this.startedAt = 0;
    this.log.info("远控已停止");
    return this.status();
  }

  /** 切换为「可再次启动」而不杀已有进程（面板重连用）。 */
  reset() {
    this.phase = "idle";
    this.blocker = "";
    this.lastError = "";
    this.tunnelId = this.state.get("tunnelId", "") || "";
  }

  dispose() {
    this.disposed = true;
    void this.stop();
  }
}
