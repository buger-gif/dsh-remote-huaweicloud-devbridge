/**
 * 配置解析。优先级（后者覆盖前者）：
 *   DEFAULTS < config.json（面板写入） < Cordis entry config < 环境变量
 *
 * 刻意不依赖任何 DSH 内部模块：本文件在插件进程、doctor、自测里都能独立 import。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULTS = Object.freeze({
  enabled: true,
  /** DSH 启动后是否自动开隧道。默认关，避免在未登录 DevBridge 时反复重试。 */
  autoStart: false,

  /** 插件内嵌鉴权网关的监听地址。只绑回环，公网入口由 DevBridge 出站隧道提供。 */
  gateHost: "127.0.0.1",
  gatePort: 3081,

  /** 上游 DSH Web。webPort=0 时运行时向 ctx.webServer.port 探测。 */
  webHost: "127.0.0.1",
  webPort: 0,

  /** DevBridge 隧道参数。tunnelName 为空时按主机名生成并在 state 里持久化复用。 */
  tunnelName: "",
  tunnelDescription: "dsh远控隧道",
  tunnelExpirationHours: 72,
  protocol: "auto",
  allowAnonymous: true,
  devbridgeBin: "",
  apiKeyEnv: "HW_API_KEY",

  /** 门禁。accessToken 为空时自动生成随机 token 并写入 state（权限 0600）。 */
  accessToken: "",
  sessionTtlMinutes: 720,
  maxFails: 10,
  failWindowMs: 600000,

  /** 隧道进程看护。 */
  reconnect: true,
  reconnectDelayMs: 5000,
  reconnectMaxDelayMs: 60000,
  connectTimeoutMs: 20000,

  logLevel: "info",
});

export function dshHome(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

export function stateDir(env = process.env) {
  return path.join(dshHome(env), "devbridge-remote");
}

export function configPath(env = process.env) {
  return path.join(stateDir(env), "config.json");
}

export function statePath(env = process.env) {
  return path.join(stateDir(env), "state.json");
}

export function launchTokenPath(env = process.env) {
  return path.join(dshHome(env), "web-token");
}

const ENV_KEYS = {
  enabled: "DEVBRIDGE_REMOTE_ENABLED",
  autoStart: "DEVBRIDGE_REMOTE_AUTOSTART",
  gateHost: "DEVBRIDGE_REMOTE_GATE_HOST",
  gatePort: "DEVBRIDGE_REMOTE_GATE_PORT",
  webHost: "DEVBRIDGE_REMOTE_WEB_HOST",
  webPort: "DEVBRIDGE_REMOTE_WEB_PORT",
  tunnelName: "DEVBRIDGE_REMOTE_TUNNEL_NAME",
  tunnelExpirationHours: "DEVBRIDGE_REMOTE_EXPIRE_HOURS",
  protocol: "DEVBRIDGE_REMOTE_PROTOCOL",
  allowAnonymous: "DEVBRIDGE_REMOTE_ALLOW_ANONYMOUS",
  devbridgeBin: "DEVBRIDGE_BIN",
  apiKeyEnv: "DEVBRIDGE_REMOTE_API_KEY_ENV",
  accessToken: "DEVBRIDGE_REMOTE_TOKEN",
  sessionTtlMinutes: "DEVBRIDGE_REMOTE_SESSION_TTL",
  maxFails: "DEVBRIDGE_REMOTE_MAX_FAILS",
  failWindowMs: "DEVBRIDGE_REMOTE_FAIL_WINDOW_MS",
};

const BOOL_KEYS = new Set(["enabled", "autoStart", "allowAnonymous", "reconnect"]);
const NUM_KEYS = new Set([
  "gatePort", "webPort", "tunnelExpirationHours", "sessionTtlMinutes",
  "maxFails", "failWindowMs", "reconnectDelayMs", "reconnectMaxDelayMs",
  "connectTimeoutMs",
]);

function coerce(key, value) {
  if (BOOL_KEYS.has(key)) {
    if (typeof value === "boolean") return value;
    return !["0", "false", "no", "off", ""].includes(String(value).trim().toLowerCase());
  }
  if (NUM_KEYS.has(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : DEFAULTS[key];
  }
  return String(value);
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 只接受已知键，避免拼错的配置静默生效。 */
function pickKnown(input, env = process.env) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    if (!(k in DEFAULTS) || v === undefined || v === null) continue;
    out[k] = coerce(k, v);
  }
  return out;
}

function fromEnv(env) {
  const out = {};
  for (const [key, name] of Object.entries(ENV_KEYS)) {
    if (env[name] !== undefined) out[key] = coerce(key, env[name]);
  }
  return out;
}

/**
 * @param {object} cordisConfig Cordis entry 的 config（apply 的第二参数 / ctx.config）
 * @param {object} env 环境变量，便于自测注入
 */
export function resolveConfig(cordisConfig = {}, env = process.env) {
  const file = pickKnown(readJson(configPath(env)), env);
  const merged = {
    ...DEFAULTS,
    ...file,
    ...pickKnown(cordisConfig, env),
    ...fromEnv(env),
  };
  // 端口合法性兜底：0 表示自动探测，其余必须在 1..65535。
  if (merged.gatePort < 1 || merged.gatePort > 65535) merged.gatePort = DEFAULTS.gatePort;
  if (merged.webPort < 0 || merged.webPort > 65535) merged.webPort = 0;
  merged.tunnelExpirationHours = Math.min(720, Math.max(1, merged.tunnelExpirationHours));
  merged.sessionTtlMinutes = Math.max(1, merged.sessionTtlMinutes);
  return merged;
}

/** 面板写回：只落用户真正改过的键，保持文件短小可读。 */
export function writeConfigFile(patch, env = process.env) {
  const dir = stateDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const current = readJson(configPath(env));
  const next = { ...current, ...pickKnown(patch, env) };
  const file = configPath(env);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* noop */ }
  return next;
}
