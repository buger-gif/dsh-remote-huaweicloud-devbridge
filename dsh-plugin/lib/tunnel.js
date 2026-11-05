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

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_RE, "");
}

/** 从 `devbridge port list` 表格里取端口号；只认每行首个 1–65535 的整数。 */
export function parsePortList(text) {
  const ports = new Set();
  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{1,5})(?:\s|$)/);
    if (!m) continue;
    const port = Number(m[1]);
    if (port >= 1 && port <= 65535) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/** 收集所有带 `Tunnel URL:` 标签的 URL，保持出现顺序并去重。 */
export function extractTunnelUrls(text) {
  const out = [];
  if (!text) return out;
  const re = /Tunnel\s*URL\s*[:=]\s*(https?:\/\/[^\s"'<>\]\)]+)/gi;
  for (const m of String(text).matchAll(re)) {
    const url = m[1].replace(/[.,;]+$/, "");
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * 取隧道公网端口：优先 URL 的显式端口；DevBridge 的 URL 通常把端口放在
 * hostname 首段（`<tunnelId>-<port>.domain`），这里一并识别。
 */
export function urlPort(url) {
  try {
    const u = new URL(url);
    if (u.port) return Number(u.port);
    const first = (u.hostname.split(".")[0] || "");
    const m = first.match(/-(\d{2,5})$/) || first.match(/^(\d{2,5})$/);
    if (m) return Number(m[1]);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return 0;
  }
}

/**
 * 从 host 输出里选唯一入口：优先端口等于 gatePort 的那条；
 * 只有一个候选时接受它（公网端口可能由服务端另行分配）；
 * 多个候选且没有匹配项时返回空，宁可暂时不给链接，也不写死死端口。
 */
export function pickTunnelUrl(text, preferredPort = 0) {
  const urls = extractTunnelUrls(text);
  if (urls.length) {
    const want = Number(preferredPort) || 0;
    if (want) {
      const hit = urls.find((u) => urlPort(u) === want);
      if (hit) return hit;
    }
    return urls.length === 1 ? urls[0] : "";
  }
  // 没有标签时退回旧启发式，但只在恰好一个候选时采用，避免多行里抓错。
  const loose = new Set((String(text || "").match(URL_RE) || []).map((u) => u.replace(/[.,;]+$/, "")));
  return loose.size === 1 ? [...loose][0] : "";
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
    this.hostBuffer = "";
    this.hostUrls = new Set();
    this.hostSettled = false;
    this.portsAligned = false;
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

  /** 读隧道端口列表；CLI 失败返回 null（区别于“没有端口”）。 */
  async #listPorts() {
    const r = await this.#run(["port", "list", this.tunnelId], { allowFailure: true });
    if (!r.ok) {
      this.log.debug(`读取隧道端口失败，跳过自动清理: ${(r.stderr || r.stdout).trim().slice(0, 160)}`);
      return null;
    }
    return parsePortList(`${r.stdout}\n${r.stderr}`);
  }

  /** 删除历史残留端口；返回是否全部清理成功。CLI 不支持时按失败处理。 */
  async #prunePorts(ports) {
    if (!ports.length) return true;
    const help = await this.#help(["port", "delete"]);
    const portFlag = pickFlag(help, ["--port-number", "-p", "--port"]);
    if (!portFlag) {
      this.log.debug("当前 CLI 不支持 port delete，跳过历史端口清理");
      return false;
    }
    let ok = true;
    for (const port of ports) {
      const r = await this.#run(["port", "delete", this.tunnelId, portFlag, String(port)], { allowFailure: true });
      const out = `${r.stderr} ${r.stdout}`.trim();
      if (r.ok || /not\s*found|no such|not\s*configured|不存在/i.test(out)) {
        this.log.debug(`已清理历史端口 ${port}`);
      } else {
        ok = false;
        this.log.debug(`清理历史端口 ${port} 失败，继续启动: ${out.slice(0, 160)}`);
      }
    }
    return ok;
  }

  /**
   * 隧道端口对账：只保留 gatePort。
   * 隧道归插件专用，其余端口一律视为历史残留并自动删除；用户不需要看到或手动处理。
   */
  async reconcilePorts() {
    const port = Number(this.config.gatePort);
    const existing = await this.#listPorts();
    let pruned = true;
    this.portsAligned = false;
    if (existing) {
      pruned = await this.#prunePorts(existing.filter((p) => p !== port));
      if (existing.includes(port)) {
        this.portsAligned = pruned;
        this.log.debug(`端口 ${port} 已就绪`);
        return true;
      }
    }
    await this.#createPort(port);
    // list 失败时无法确认是否还有残留，保守地不启用“单入口不同端口”兜底。
    this.portsAligned = Boolean(existing) && pruned;
    return true;
  }

  /** 创建 gatePort；匿名策略由插件门禁兜底，默认允许以便手机直接扫码。 */
  async #createPort(port) {
    const id = this.tunnelId;
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
      this.log.debug("port create 参数回退", r.stderr.trim().slice(0, 160));
      r = await this.#run(minimal, { allowFailure: true });
    }
    if (!r.ok && !/already|exist|重复/i.test(`${r.stderr} ${r.stdout}`)) {
      throw new Error(`配置端口失败：${(r.stderr || r.stdout).trim().slice(0, 300) || "无输出"}`);
    }
    this.log.debug(`端口 ${port} 已绑定隧道 ${id}`);
    return true;
  }

  #setTunnelUrl(url) {
    if (!url || url === this.tunnelUrl) return false;
    this.tunnelUrl = url;
    this.retryCount = 0;
    this.state.patch({ tunnelUrl: url });
    this.log.info(`Tunnel URL: ${url}`);
    return true;
  }

  /**
   * 只有一个候选、且端口对账已确认“隧道里只剩 gatePort”时，才接受与 gatePort
   * 不同的公网端口（服务端可能另行分配）。多入口或清理未完成时宁可报错也不写死死端口。
   */
  #adoptSingleUrl() {
    if (this.tunnelUrl || !this.portsAligned || this.hostUrls.size !== 1) return false;
    const [only] = this.hostUrls;
    this.#setTunnelUrl(only);
    this.log.debug(`采用 host 输出的公网端口 ${urlPort(only)}（本机网关 ${this.config.gatePort}）`);
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
    this.hostBuffer = "";
    this.hostUrls = new Set();
    this.hostSettled = false;
    // 旧入口先清掉：宁可暂时没有链接，也不让上一轮的残留 URL 继续出现在面板/二维码里。
    this.tunnelUrl = "";
    this.state.patch({ tunnelUrl: "" });

    const onData = (chunk) => {
      this.hostBuffer += String(chunk);
      const lines = this.hostBuffer.split(/\r?\n/);
      this.hostBuffer = lines.pop() ?? "";
      if (this.hostBuffer.length > 8192) this.hostBuffer = this.hostBuffer.slice(-4096);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.outputTail.push(trimmed);
        if (this.outputTail.length > 40) this.outputTail.shift();
        this.log.debug("host:", trimmed.slice(0, 300));
      }
      // 只在完整行上选 URL，避免 chunk 边界把 URL 截断后写进 state。
      const text = lines.join("\n");
      const want = Number(this.config.gatePort);
      const labeled = extractTunnelUrls(text);
      if (labeled.length) {
        for (const url of labeled) this.hostUrls.add(url);
      } else {
        // 老版本 / 裁剪输出可能没有 "Tunnel URL:" 标签；只在唯一候选时收纳。
        const only = pickTunnelUrl(text, want);
        if (only) this.hostUrls.add(only);
      }
      const matched = [...this.hostUrls].find((url) => urlPort(url) === want);
      if (matched) {
        this.#setTunnelUrl(matched);
      } else if (/Ready to accept connections/i.test(text)) {
        if (this.hostUrls.size > 1) {
          this.log.debug(`host 输出 ${this.hostUrls.size} 个入口，没有与网关端口 ${want} 匹配的项`);
        }
        this.hostSettled = true;
        this.#adoptSingleUrl();
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
      this.hostBuffer = "";
      this.hostUrls = new Set();
      this.hostSettled = false;
      if (this.disposed || this.phase === "stopped") return;
      this.log.warn(`host 退出 (code=${code}, signal=${signal || "none"})`);
      this.tunnelUrl = "";
      this.#scheduleReconnect();
    });

    // 最多等 connectTimeoutMs 拿 URL；拿不到也不阻塞插件，面板会显示错误。
    const deadline = Date.now() + this.config.connectTimeoutMs;
    while (!this.tunnelUrl && !this.hostSettled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      if (!this.hostChild) break;
    }
    if (!this.tunnelUrl) this.#adoptSingleUrl();
    if (!this.tunnelUrl) {
      this.lastError = "host 已启动但没有给出可用入口；请点「重启远控」重试（插件会自动对齐隧道端口）";
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

  /** 完整启动链：预检 → 建/复用隧道 → 端口对账 → 起 host。 */
  async start() {
    if (this.disposed) throw new Error("manager disposed");
    if (!this.config.enabled) throw new Error("插件已在配置中禁用");
    if (this.phase === "hosting" && this.hostChild) return this.status();

    const ok = await this.preflight();
    if (!ok) return this.status();
    if (!this.tunnelId) await this.ensureTunnel();
    await this.reconcilePorts();
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
