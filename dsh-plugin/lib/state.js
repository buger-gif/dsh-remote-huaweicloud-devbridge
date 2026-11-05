/**
 * 持久化少量运行时状态：隧道 ID、访问 token、上次公网 URL。
 * 权限 0600；写入走临时文件 + rename，避免半截 JSON。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export class State {
  constructor({ file, logger = console } = {}) {
    this.file = file;
    this.logger = logger;
    this.data = {};
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.data = parsed;
      }
    } catch {
      this.data = {};
    }
    return this.data;
  }

  get(key, fallback = undefined) {
    return this.data[key] === undefined ? fallback : this.data[key];
  }

  /** 保证访问 token 存在且稳定；轮换时由 rotateToken 显式生成。 */
  ensureToken() {
    if (!this.data.accessToken) {
      this.data.accessToken = newToken();
      this.save();
    }
    return this.data.accessToken;
  }

  rotateToken() {
    this.data.accessToken = newToken();
    this.save();
    return this.data.accessToken;
  }

  ensureTunnelName(prefix = "dsh-remote") {
    if (!this.data.tunnelName) {
      const host = (process.env.HOSTNAME || "host").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 16) || "host";
      this.data.tunnelName = `${prefix}-${host}`.slice(0, 128);
      this.save();
    }
    return this.data.tunnelName;
  }

  patch(fields) {
    this.data = { ...this.data, ...fields };
    this.save();
    return this.data;
  }

  save() {
    if (!this.file) return;
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch { /* noop */ }
  }
}
