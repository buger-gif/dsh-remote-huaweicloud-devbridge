/** 环形内存日志：既写到宿主 console，也留给侧边栏面板轮询。 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export class Log {
  constructor({ prefix = "[devbridge-remote]", level = "info", limit = 300, sink = console } = {}) {
    this.prefix = prefix;
    this.level = LEVELS[level] ?? LEVELS.info;
    this.limit = limit;
    this.sink = sink;
    this.entries = [];
  }

  #push(level, args) {
    const text = args
      .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    const entry = { at: Date.now(), level, text };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    const method = level === "debug" ? "log" : level;
    try { this.sink?.[method]?.(this.prefix, text); } catch { /* noop */ }
    return entry;
  }

  debug(...a) { if (this.level <= LEVELS.debug) this.#push("debug", a); }
  info(...a) { if (this.level <= LEVELS.info) this.#push("info", a); }
  warn(...a) { if (this.level <= LEVELS.warn) this.#push("warn", a); }
  error(...a) { if (this.level <= LEVELS.error) this.#push("error", a); }

  tail(since = 0, limit = 100) {
    const rows = since ? this.entries.filter((e) => e.at > since || (e.at === since && e.seq > since)) : this.entries;
    return rows.slice(-Math.max(1, Math.min(limit, this.limit)));
  }
}
