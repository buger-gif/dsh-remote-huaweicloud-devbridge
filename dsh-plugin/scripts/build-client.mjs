#!/usr/bin/env node
/** 把 web/panel.js 内联进 lib/client.js。panel.js 是唯一事实源。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const panel = path.join(root, "web", "panel.js");
const template = path.join(root, "lib", "client.template.js");
const out = path.join(root, "lib", "client.js");

const panelSrc = fs.readFileSync(panel, "utf8");
const tpl = fs.readFileSync(template, "utf8");
if (!tpl.includes("/*__PANEL_JS__*/")) {
  console.error("template missing /*__PANEL_JS__*/ placeholder");
  process.exit(1);
}
// 防止面板源码里意外出现模块结束标记破坏包装
if (panelSrc.includes("/* ===== end inline ===== */")) {
  console.error("panel.js contains reserved end-inline marker");
  process.exit(1);
}
const result = tpl.replace("/*__PANEL_JS__*/", panelSrc);
fs.writeFileSync(out, result);
console.log(`wrote ${out} (${result.length} bytes)`);
