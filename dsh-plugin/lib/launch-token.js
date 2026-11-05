/**
 * 找 DSH 自身的「启动令牌」（launch token）。
 *
 * DSH 0.2.x 的 BrowserAuth 把令牌放在进程内的 WeakMap（processLaunchToken），
 * 桌面端不会写 ~/.dsh/web-token —— 该文件常常是上一次 `dsh web` 的旧值，
 * 拿它去换会话会静默 401。因此按可靠性依次尝试：
 *
 *   1. 用户在面板里粘贴的启动链接 / DSH_WEB_URL 环境变量（人工兜底，最可靠）
 *   2. 进程内服务：connection / webServer 的 authenticatedUrl() 或 launchToken
 *   3. ~/.dsh/web-token（可能是旧值，仅作最后尝试）
 *
 * 只依赖 Node 内置模块，可离线自测。
 */
import fs from "node:fs";
import { launchTokenPath } from "./config.js";

const SERVICE_NAMES = [
  "connection", "webServer", "browserAuth", "webApp", "clientConnection", "webServerAuth",
];

/** 从 `http://127.0.0.1:3080/?token=xxx` 或裸 token 里取出令牌。 */
export function tokenFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.searchParams.get("token") || "";
  } catch {
    const m = raw.match(/[?&]token=([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    // 也允许用户直接粘 32~64 位的裸令牌
    return /^[A-Za-z0-9_-]{24,128}$/.test(raw) ? raw : "";
  }
}

export function discoverLaunchToken({ ctx = null, webCtx = null, webPort = 3080, env = process.env, state = null } = {}) {
  const manual = (state && state.get("launchUrl", "")) || env.DSH_WEB_URL || "";
  const fromManual = tokenFromUrl(manual);
  if (fromManual) return { token: fromManual, source: "manual" };

  const get = (name) => {
    for (const c of [ctx, webCtx]) {
      try {
        const v = c?.get?.(name);
        if (v) return v;
      } catch { /* 服务不存在 */ }
    }
    return null;
  };

  for (const name of SERVICE_NAMES) {
    const svc = get(name);
    for (const obj of [svc, svc?.browserAuth, svc?.auth, svc?.connection]) {
      if (!obj || typeof obj !== "object") continue;
      if (typeof obj.launchToken === "string" && obj.launchToken) {
        return { token: obj.launchToken, source: `service:${name}` };
      }
      if (typeof obj.authenticatedUrl === "function") {
        try {
          const token = tokenFromUrl(obj.authenticatedUrl(`http://127.0.0.1:${webPort}/`));
          if (token) return { token, source: `service:${name}.authenticatedUrl` };
        } catch { /* 换下一个来源 */ }
      }
    }
  }

  try {
    const token = fs.readFileSync(launchTokenPath(env), "utf8").trim();
    if (token) return { token, source: "file:web-token" };
  } catch { /* noop */ }
  return { token: "", source: "none" };
}
