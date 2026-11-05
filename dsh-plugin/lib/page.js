/** 独立控制页：不依赖 DSH 客户端注入，本机与远端浏览器都能直接打开。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let cachedPanel = null;
export function panelSource() {
  if (cachedPanel === null) {
    cachedPanel = fs.readFileSync(path.join(HERE, "..", "web", "panel.js"), "utf8");
  }
  return cachedPanel;
}

function esc(value) {
  return JSON.stringify(String(value)).replace(/</g, "\\u003c");
}

export function renderPage({ api, token, version }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>华为云 DevBridge · DSH 远控</title>
<style>
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:#f5f6f8;color:#1a1d21;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:20px 16px 40px}
.top{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.top h1{font-size:16px;margin:0;font-weight:650}
.top .ver{margin-left:auto;font-size:11px;color:#8b909a}
#app{background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;min-height:520px}
</style></head><body><div class="wrap">
<div class="top"><h1>华为云 DevBridge · DSH 远控</h1><span class="ver">v${version}</span></div>
<div id="app"></div></div>
<script>window.DEVBRIDGE_REMOTE_API=${esc(api)};window.DEVBRIDGE_REMOTE_TOKEN=${esc(token)};</script>
<script>${panelSource()}</script>
<script>window.DevBridgePanel.mount(document.getElementById("app"),{standalone:true});</script>
</body></html>`;
}
