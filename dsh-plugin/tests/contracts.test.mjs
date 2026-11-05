/**
 * 契约对账：代码是事实，docs/specs/contracts/ 是契约。
 * 纯读文件，不开端口、不连 CLI、不需要华为云账号。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "../lib/config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.dirname(HERE);
const REPO = path.dirname(PLUGIN);
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const sorted = (xs) => [...new Set(xs)].sort();
const section = (text, heading) => {
  const at = text.indexOf(heading);
  assert.ok(at >= 0, `缺少小节 ${heading}`);
  return text.slice(at + heading.length).split(/\n## /)[0];
};

const pkg = JSON.parse(read("dsh-plugin/package.json"));

test("版本：package.json 是唯一真源，lib 里不得再新增硬编码", () => {
  const found = [];
  for (const f of fs.readdirSync(path.join(PLUGIN, "lib")).filter((n) => n.endsWith(".js"))) {
    const src = read(`dsh-plugin/lib/${f}`);
    for (const m of src.matchAll(/version\s*[:=]\s*["'](\d+\.\d+\.\d+)["']/g)) {
      found.push([f, m[1]]);
    }
  }
  assert.ok(found.length > 0, "lib/ 里应有可核对的版本字面量");
  for (const [file, value] of found) {
    assert.equal(value, pkg.version, `${file} 的版本与 package.json 不一致`);
  }
  assert.ok(found.length <= 3, "不要再新增版本硬编码，改为从 package.json 读取（见 PROGRESS.md）");
});

test("契约 01：/api/* 路由集合与 control.js 一致", () => {
  const ctrl = read("dsh-plugin/lib/control.js");
  const codeRoutes = [...ctrl.matchAll(/path === "(\/api\/[a-z0-9/_-]+)"/g)].map((m) => m[1]);
  const doc = read("docs/specs/contracts/01-api.md");
  const docRoutes = [];
  for (const heading of ["## 读接口（GET）", "## 写接口（POST）"]) {
    for (const line of section(doc, heading).split("\n")) {
      if (!line.trim().startsWith("|")) continue;
      const m = line.match(/`(\/api\/[a-z0-9/_-]+)`/);
      if (m) docRoutes.push(m[1]);
    }
  }
  assert.ok(codeRoutes.length > 0);
  assert.deepEqual(sorted(docRoutes), sorted(codeRoutes), "改了路由就要同 commit 改 01-api.md");
});

test("契约 02：配置键与默认值与 DEFAULTS 一致", () => {
  const doc = read("docs/specs/contracts/02-config.md");
  const rows = [];
  for (const line of section(doc, "## 键与默认值").split("\n")) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*[^|]*\|\s*`([^`]*)`\s*\|/);
    if (m) rows.push([m[1], m[2]]);
  }
  assert.ok(rows.length > 0);
  assert.deepEqual(sorted(rows.map((r) => r[0])), sorted(Object.keys(DEFAULTS)),
    "新增 / 改名 / 删配置键就要同 commit 改 02-config.md");
  for (const [key, raw] of rows) {
    let value = raw;
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    assert.equal(String(DEFAULTS[key]), value, `配置键 ${key} 的默认值不一致`);
  }
});

test("契约 03：state.json 字段与代码一致", () => {
  const doc = read("docs/specs/contracts/03-state.md");
  const docFields = [...section(doc, "## 顶层").matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((m) => m[1]);
  const sources = [
    "dsh-plugin/lib/state.js", "dsh-plugin/lib/control.js", "dsh-plugin/lib/tunnel.js",
    "dsh-plugin/lib/index.js", "dsh-plugin/lib/launch-token.js",
  ].map(read).join("\n");
  const codeFields = [];
  for (const m of sources.matchAll(/this\.data\.([A-Za-z_]\w*)/g)) codeFields.push(m[1]);
  for (const m of sources.matchAll(/state\.patch\(\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/([A-Za-z_]\w*)\s*:/g)) codeFields.push(k[1]);
  }
  for (const m of sources.matchAll(/state\.get\(\s*["']([A-Za-z_]\w*)["']/g)) codeFields.push(m[1]);
  assert.ok(docFields.length > 0);
  assert.deepEqual(sorted(docFields), sorted(codeFields),
    "改了 state.json 字段就要同 commit 改 03-state.md");
});

test("构建产物：lib/client.js 与 web/panel.js + 模板一致", () => {
  const panel = read("dsh-plugin/web/panel.js");
  const tpl = read("dsh-plugin/lib/client.template.js");
  const built = read("dsh-plugin/lib/client.js");
  assert.ok(tpl.includes("/*__PANEL_JS__*/"), "模板占位符丢了");
  assert.ok(!panel.includes("/* ===== end inline ===== */"), "panel.js 含保留结束标记");
  assert.equal(built, tpl.replace("/*__PANEL_JS__*/", panel),
    "改了 web/panel.js 就跑 npm run build:client；不要手改 lib/client.js");
});

test("包声明：files / main / exports 指向的路径都存在", () => {
  for (const rel of pkg.files) {
    assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `package.json files 缺 ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(PLUGIN, pkg.main)), "main 指向的文件不存在");
  for (const rel of Object.values(pkg.exports)) {
    assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `exports 指向的文件不存在：${rel}`);
  }
  assert.equal(pkg.license, "MIT", "开源许可证必须与 LICENSE 一致");
});
