/** 侧边栏面板 / 独立控制页共用的同源 API。 */
import { toSvg } from "./qrcode.js";
import { writeConfigFile } from "./config.js";
import { tokenFromUrl } from "./launch-token.js";

const EDITABLE = new Set([
  "autoStart", "gatePort", "tunnelName", "tunnelExpirationHours", "protocol",
  "allowAnonymous", "devbridgeBin", "reconnect", "logLevel",
]);

const BLOCKER_HELP = {
  "cli-missing": "未找到 devbridge CLI（需 v0.2.x）。在插件目录运行 node scripts/doctor.mjs 查看安装命令。",
  "cli-broken": "devbridge CLI 无法执行，重新安装 v0.2.x。",
  "cli-outdated": "CLI 是 v0.1.x，旧域名已下线。升级到 v0.2.x 后重建隧道。",
  "auth-required": "DevBridge 未登录。执行 devbridge auth login，或设置 HW_API_KEY 后执行 devbridge auth login --api-key \"$HW_API_KEY\"。",
  "gate-failed": "鉴权网关端口被占用或无法监听，检查 gatePort 配置。",
};

/** 把公网 URL 与访问令牌拼成扫码链接；URL 一律来自 host 输出，不手工拼域名。 */
export function pairingUrlFor(tunnelUrl, token) {
  if (!tunnelUrl || !token) return "";
  try {
    const u = new URL(tunnelUrl);
    u.pathname = "/";
    u.search = "";
    u.hash = "";
    u.searchParams.set("t", token);
    return u.toString();
  } catch {
    return "";
  }
}

export class Control {
  constructor({ getConfig, state, getTunnel, getGate, log, getLaunchInfo = null, setLaunchUrl = null, getLaunchToken = null, version = "0.1.4" } = {}) {
    this.getConfig = getConfig;
    this.state = state;
    this.getTunnel = getTunnel;
    this.getGate = getGate;
    this.log = log;
    this.getLaunchInfo = getLaunchInfo || (() => ({ token: getLaunchToken ? getLaunchToken() : "", source: "legacy" }));
    this.setLaunchUrl = setLaunchUrl;
    this.version = version;
  }

  status() {
    const cfg = this.getConfig();
    const tunnel = this.getTunnel();
    const gate = this.getGate();
    const t = tunnel ? tunnel.status() : { phase: "unavailable", blocker: "plugin-not-ready" };
    const accessToken = this.state.get("accessToken", "");
    const pairingUrl = pairingUrlFor(t.tunnelUrl, accessToken);
    const gateStatus = gate ? gate.status() : { running: false };
    const launch = this.getLaunchInfo();
    const exchange = gateStatus.launchExchange || { ok: false, error: "网关未运行" };
    return {
      ok: true,
      version: this.version,
      enabled: cfg.enabled,
      autoStart: cfg.autoStart,
      tunnel: t,
      gate: gateStatus,
      tunnelUrl: t.tunnelUrl || "",
      pairingUrl,
      accessToken,
      hasLaunchToken: !!launch.token,
      launchTokenSource: launch.source,
      launchExchange: exchange,
      launchHelp: exchange.ok ? "" :
        `远端还打不开 DSH 主界面：${exchange.error || "会话未兑换"}。把终端里 dsh web 打印的完整链接（含 ?token=）粘到下方「DSH 启动链接」并保存，然后重新扫码。`,
      blockerHelp: t.blocker ? (BLOCKER_HELP[t.blocker] || t.lastError || t.blocker) : "",
      config: {
        gateHost: cfg.gateHost,
        gatePort: cfg.gatePort,
        webPort: cfg.webPort,
        tunnelName: t.tunnelName || cfg.tunnelName,
        tunnelExpirationHours: cfg.tunnelExpirationHours,
        protocol: cfg.protocol,
        allowAnonymous: cfg.allowAnonymous,
        devbridgeBin: cfg.devbridgeBin,
        reconnect: cfg.reconnect,
        sessionTtlMinutes: cfg.sessionTtlMinutes,
      },
      ts: Date.now(),
    };
  }

  async #start() {
    const gate = this.getGate();
    const tunnel = this.getTunnel();
    if (!gate || !tunnel) throw new Error("插件尚未就绪（缺少 webServer 服务）");
    if (!gate.running) await gate.start();
    tunnel.reset();
    return tunnel.start();
  }

  async handle(path, method = "GET", query = new URLSearchParams(), body = {}) {
    const m = String(method || "GET").toUpperCase();
    const tunnel = this.getTunnel();
    const gate = this.getGate();
    try {
      if (path === "/api/status" && m === "GET") return { status: 200, body: this.status() };

      if (path === "/api/health" && m === "GET") {
        return { status: 200, body: { ok: true, ts: Date.now(), uptime: process.uptime() } };
      }

      if (path === "/api/logs" && m === "GET") {
        const since = Number(query.get?.("since") || 0);
        return { status: 200, body: { ok: true, entries: this.log.tail(since, 120) } };
      }

      if (path === "/api/qr" && m === "GET") {
        const s = this.status();
        if (!s.pairingUrl) return { status: 409, body: { ok: false, error: "隧道尚未就绪，暂无可扫码的链接" } };
        return { status: 200, body: { ok: true, svg: toSvg(s.pairingUrl), text: s.pairingUrl } };
      }

      if (path === "/api/start" && m === "POST") {
        const st = await this.#start();
        return { status: 200, body: { ok: true, tunnel: st } };
      }

      if (path === "/api/stop" && m === "POST") {
        if (!tunnel) throw new Error("隧道管理器未就绪");
        return { status: 200, body: { ok: true, tunnel: await tunnel.stop() } };
      }

      if (path === "/api/restart" && m === "POST") {
        if (tunnel) await tunnel.stop();
        const st = await this.#start();
        return { status: 200, body: { ok: true, tunnel: st } };
      }

      if (path === "/api/token/rotate" && m === "POST") {
        const token = this.state.rotateToken();
        const g = this.getGate();
        if (g) g.accessToken = token; // 立刻让旧会话 Cookie 失效
        this.log.info("访问令牌已轮换，旧扫码链接与旧会话全部失效");
        return { status: 200, body: { ok: true, accessToken: token } };
      }

      if (path === "/api/tunnel/forget" && m === "POST") {
        if (tunnel) await tunnel.stop();
        this.state.patch({ tunnelId: "", tunnelUrl: "", tunnelName: "" });
        if (tunnel) {
          tunnel.tunnelId = "";
          tunnel.tunnelName = this.getConfig().tunnelName || this.state.ensureTunnelName();
        }
        this.log.info("已忘记旧隧道，下次开启会重建");
        return { status: 200, body: { ok: true } };
      }

      if (path === "/api/config" && m === "GET") {
        return { status: 200, body: { ok: true, config: this.status().config, editable: [...EDITABLE] } };
      }

      if (path === "/api/config" && m === "POST") {
        const patch = {};
        for (const k of EDITABLE) if (body && body[k] !== undefined) patch[k] = body[k];
        writeConfigFile(patch);
        this.log.info("配置已写入 config.json；端口/路径类改动需重启插件生效", Object.keys(patch).join(","));
        return { status: 200, body: { ok: true, patch, note: "端口与 CLI 路径需重启 DSH 后生效" } };
      }

      if (path === "/api/launch-url" && m === "POST") {
        const url = String(body?.url || "").trim();
        const token = tokenFromUrl(url);
        if (!token) return { status: 400, body: { ok: false, error: "链接里没找到有效的 token 参数" } };
        this.state.patch({ launchUrl: url });
        const info = this.setLaunchUrl ? this.setLaunchUrl(url) : { source: "manual" };
        this.log.info(`DSH 启动链接已登记（来源 ${info.source}）；重新扫码即可兑换会话`);
        return { status: 200, body: { ok: true, source: info.source, note: "已保存，重新扫码即可完成会话兑换" } };
      }

      if (path === "/api/gate/start" && m === "POST") {
        if (!gate) throw new Error("网关未就绪");
        return { status: 200, body: { ok: true, gate: await gate.start() } };
      }

      return { status: 404, body: { ok: false, error: "not found", path } };
    } catch (e) {
      this.log.error(`api ${path}:`, e);
      return { status: 500, body: { ok: false, error: e?.message || String(e) } };
    }
  }
}
