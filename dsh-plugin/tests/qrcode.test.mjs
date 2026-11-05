import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { encodeMatrix, toSvg, toPng } from "../lib/qrcode.js";

// 一次 Swift 编译解码所有样例，避免重复启动编译器拖慢测试。
const DECODE_SWIFT = `import Foundation
import Vision
import AppKit
let paths = Array(CommandLine.arguments.dropFirst())
for p in paths {
  guard let img = NSImage(contentsOfFile: p),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERROR:load"); continue
  }
  let req = VNDetectBarcodesRequest()
  req.symbologies = [.qr]
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  do {
    try handler.perform([req])
    let r = req.results ?? []
    print(r.isEmpty ? "ERROR:nodetect" : (r[0].payloadStringValue ?? "ERROR:empty"))
  } catch { print("ERROR:\\(error)") }
}
`;

test("矩阵尺寸符合 17+4×version，SVG/PNG 可生成", () => {
  const m = encodeMatrix("https://a.tunnel.example.com/?t=xyz");
  assert.equal(m.length, 29); // version 3
  assert.equal(m.every((row) => row.length === m.length), true);
  assert.match(toSvg("hello"), /^<svg /);
  assert.match(toSvg("hello"), /<\/svg>$/);
  assert.equal(toPng("hello").subarray(1, 4).toString(), "PNG");
});

test("SVG 回归：路径坐标必须留在 viewBox 内（曾经乘了 scale 只显示左上角）", () => {
  const svg = toSvg("https://a.tunnel.example.com/?t=xyz", { scale: 6, quiet: 4 });
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(vb, "缺少 viewBox");
  const n = Number(vb[1]);
  const rect = svg.match(/<rect width="(\d+)" height="(\d+)"/);
  assert.equal(Number(rect[1]), n, "白底必须铺满 viewBox");
  const runs = [...svg.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)/g)];
  assert.ok(runs.length > 10, "应生成可观的深色模块");
  for (const m of runs) {
    const [, x, y, w, h] = m.map(Number);
    assert.ok(x + w <= n, `路径 x=${x} w=${w} 超出 viewBox ${n}`);
    assert.ok(y + h <= n, `路径 y=${y} h=${h} 超出 viewBox ${n}`);
  }
});

test("SVG 与 PNG 渲染的是同一张码（路径回读成矩阵逐格比对）", () => {
  const text = "https://a.tunnel.example.com/?t=xyz";
  const quiet = 4;
  const svg = toSvg(text, { scale: 6, quiet });
  const n = Number(svg.match(/viewBox="0 0 (\d+) (\d+)"/)[1]);
  const rebuilt = Array.from({ length: n }, () => new Array(n).fill(false));
  let modules = 0;
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g)) {
    const [, x, y, w, h] = m.map(Number);
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) { rebuilt[y + dy][x + dx] = true; modules += 1; }
    }
  }
  const expected = encodeMatrix(text);
  assert.ok(modules > 100, "深色模块数量应足够");
  for (let y = 0; y < expected.length; y += 1) {
    for (let x = 0; x < expected.length; x += 1) {
      assert.equal(rebuilt[y + quiet][x + quiet], expected[y][x], `模块 (${x},${y}) 不一致`);
    }
  }
});

test("超长内容明确报错而不是静默截断", () => {
  assert.throws(() => encodeMatrix("x".repeat(400)), /内容过长/);
});

test("真实解码：生成的二维码能被 macOS Vision 正确读出（含中文）", { skip: !fs.existsSync("/usr/bin/swift") }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dbr-qr-"));
  const swiftFile = path.join(tmp, "decode.swift");
  fs.writeFileSync(swiftFile, DECODE_SWIFT);
  const cases = [
    "https://noh56s7x-3081.tunnel.example.com/?t=AbCdEf0123456789AbCdEf0123456789",
    "https://a.tunnel.example.com/?t=xyz",
    "华为云远控",
  ];
  const pngs = cases.map((text, i) => {
    const p = path.join(tmp, `qr-${i}.png`);
    fs.writeFileSync(p, toPng(text, { scale: 10 }));
    return p;
  });
  const r = spawnSync("/usr/bin/swift", [swiftFile, ...pngs], { encoding: "utf8", timeout: 180000 });
  assert.equal(r.status, 0, `解码器执行失败: ${r.stderr}`);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, cases.length);
  lines.forEach((line, i) => assert.equal(line, cases[i], `第 ${i + 1} 张二维码解码不一致`));
});
