#!/usr/bin/env node
/**
 * npm / yarn 安装本插件时自动准备 DevBridge CLI（华为云官方命令）。
 *
 * 设计取舍：
 *  1. 只使用官方安装命令，不从环境变量覆盖官方 URL。
 *  2. 幂等：已是 v0.2.x 直接跳过；v0.1.x 或未安装才执行（官方脚本自身也会比对 SHA256）。
 *  3. 永不因 CLI 安装失败让插件安装失败 —— 插件运行时还有一次懒安装兜底，
 *     因为 pnpm 10+/11 默认不执行第三方依赖的生命周期脚本。
 *  4. DEVBRIDGE_SKIP_INSTALL=1 可完全跳过（CI / 离线 / 安全策略）。
 */
import { ensureDevbridge, SKIP_ENV } from "../lib/installer.js";

const result = await ensureDevbridge({ logger: console });

switch (result.action) {
  case "already-installed":
    console.log(`[devbridge-remote] DevBridge CLI 已就绪：v${result.version}`);
    break;
  case "installed":
  case "upgraded":
    console.log(`[devbridge-remote] 已通过华为云官方命令${result.action === "upgraded" ? "升级" : "安装"} DevBridge CLI：v${result.version}`);
    console.log("[devbridge-remote] 下一步：devbridge auth login（浏览器登录），或设置 HW_API_KEY 后用 --api-key 登录。");
    break;
  case "skipped-by-env":
    console.log(`[devbridge-remote] 已跳过 CLI 自动安装（${SKIP_ENV}）；首次开启远控时仍会按需安装，除非保持该变量。`);
    break;
  default:
    console.warn(`[devbridge-remote] CLI 未自动装好：${result.reason || "未知原因"}`);
    console.warn("[devbridge-remote] 这不影响插件安装。可手动执行 sh scripts/install-cli.sh，或在 DSH 面板点「开启远控」触发重试。");
    break;
}

// 关键：安装失败不能让 `dsh plugin add` / `npm install` 整体失败。
process.exit(0);
