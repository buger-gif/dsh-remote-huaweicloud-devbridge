/**
 * 零依赖 QR Code 生成器（byte mode / ECC-L / 版本 1..6 / 8 种掩码）。
 *
 * 只覆盖本插件的实际用途：把一条带 token 的 HTTPS URL 编码成二维码。
 * v6-L 可容纳 136 字节，足够 `https://<tunnelId>-<port>.<cluster>/?t=<32字符>`。
 * 输出 SVG（面板内联）和 PNG（自测用 macOS Vision 解码验证）。
 *
 * 算法按 ISO/IEC 18004 实现：RS 纠错、块交织、功能图形、掩码惩罚、BCH 格式信息。
 */
import zlib from "node:zlib";

// version: [totalCodewords, eccPerBlock, numBlocks, dataCodewords, alignmentCenter]
const SPEC = {
  1: [26, 7, 1, 19, 0],
  2: [44, 10, 1, 34, 18],
  3: [70, 15, 1, 55, 22],
  4: [100, 20, 1, 80, 26],
  5: [134, 26, 1, 108, 30],
  6: [172, 18, 2, 136, 34],
};

// ---- GF(2^8) ---------------------------------------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
function gfMul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function rsDivisor(degree) {
  let poly = [1];
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
    root = gfMul(root, 2);
  }
  return poly;
}

function rsRemainder(data, divisor) {
  const res = new Array(divisor.length - 1).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < res.length; i += 1) res[i] ^= gfMul(divisor[i + 1], factor);
  }
  return res;
}

// ---- 数据编码 --------------------------------------------------------------
function encodeCodewords(text, version) {
  const bytes = Buffer.from(text, "utf8");
  const capacityBits = SPEC[version][3] * 8;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j += 1) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (out.length < SPEC[version][3]) out.push(pads[p++ % 2]);
  return out;
}

function interleave(data, version) {
  const [, eccLen, blocks] = SPEC[version];
  const blockLen = data.length / blocks;
  const divisor = rsDivisor(eccLen);
  const dataBlocks = [];
  const eccBlocks = [];
  for (let i = 0; i < blocks; i += 1) {
    const block = data.slice(i * blockLen, (i + 1) * blockLen);
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, divisor));
  }
  const out = [];
  for (let i = 0; i < blockLen; i += 1) for (const b of dataBlocks) out.push(b[i]);
  for (let i = 0; i < eccLen; i += 1) for (const b of eccBlocks) out.push(b[i]);
  return out;
}

// ---- 矩阵 ------------------------------------------------------------------
function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }
}

function formatBits(mask) {
  const data = (0b01 << 3) | mask; // ECC-L = 01
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function makeMatrix(version, codewords, mask) {
  const size = 17 + 4 * version;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    m[y][x] = !!dark;
    reserved[y][x] = true;
  };

  function finder(cx, cy) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark = inside &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(cx + dx, cy + dy, dark);
      }
    }
  }
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  for (let i = 8; i < size - 8; i += 1) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  if (version > 1) {
    const c = SPEC[version][4];
    for (const cy of [6, c]) {
      for (const cx of [6, c]) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === c) || (cx === c && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
  }

  // 预留格式信息区（真正的值在掩码选好后写入）
  for (let i = 0; i <= 8; i += 1) { set(8, i, false); set(i, 8, false); }
  for (let i = 0; i < 8; i += 1) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
  set(8, size - 8, true); // dark module

  const allBits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i -= 1) allBits.push((cw >>> i) & 1);
  }
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (reserved[y][x]) continue;
        let bit = bitIndex < allBits.length ? allBits[bitIndex] : 0;
        bitIndex += 1;
        if (maskBit(mask, x, y)) bit ^= 1;
        m[y][x] = !!bit;
      }
    }
  }

  const fmt = formatBits(mask);
  const bit = (i) => ((fmt >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);

  return m;
}

function penalty(m) {
  const size = m.length;
  let score = 0;
  const runs = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) run += 1;
      else { if (run >= 5) total += run - 2; run = 1; }
    }
    if (run >= 5) total += run - 2;
    return total;
  };
  for (let y = 0; y < size; y += 1) {
    score += runs(m[y]);
    score += runs(m.map((row) => row[y]));
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }
  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const matches = (arr) => {
    let n = 0;
    for (let i = 0; i + 11 <= arr.length; i += 1) {
      if (pattern.every((p, k) => arr[i + k] === p)) n += 1;
      if (pattern.every((p, k) => arr[i + k] === !p)) n += 1;
    }
    return n;
  };
  for (let y = 0; y < size; y += 1) {
    score += 40 * matches(m[y]);
    score += 40 * matches(m.map((row) => row[y]));
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** @returns {boolean[][]} true = 深色模块 */
export function encodeMatrix(text) {
  const bytes = Buffer.byteLength(String(text), "utf8");
  let version = 0;
  for (const v of Object.keys(SPEC).map(Number)) {
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (headerBits + bytes * 8 <= SPEC[v][3] * 8) { version = v; break; }
  }
  if (!version) throw new Error(`内容过长（${bytes} 字节），超出 v6-L 容量`);
  const codewords = interleave(encodeCodewords(String(text), version), version);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = makeMatrix(version, codewords, mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return best;
}

export function toSvg(text, { scale = 6, quiet = 4 } = {}) {
  const m = encodeMatrix(text);
  const n = m.length + quiet * 2;
  const paths = [];
  for (let y = 0; y < m.length; y += 1) {
    let x = 0;
    while (x < m.length) {
      if (!m[y][x]) { x += 1; continue; }
      let run = 1;
      while (x + run < m.length && m[y][x + run]) run += 1;
      // 坐标必须留在 viewBox 的模块坐标系里；缩放只作用在 width/height 上。
      // 早期版本这里乘了 scale，导致路径绝大部分落在 viewBox 之外，页面上只看到左上角。
      paths.push(`M${x + quiet} ${y + quiet}h${run}v1h${-run}z`);
      x += run;
    }
  }
  const px = n * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="DSH remote pairing QR"><rect width="${n}" height="${n}" fill="#fff"/>` +
    `<path d="${paths.join("")}" fill="#111"/></svg>`;
}

// ---- PNG（灰度、8bit、无隔行；自测时给 Vision 解码） -------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function toPng(text, { scale = 8, quiet = 4 } = {}) {
  const m = encodeMatrix(text);
  const size = (m.length + quiet * 2) * scale;
  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size + 1);
    raw[rowStart] = 0; // filter: none
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / scale) - quiet;
      const dark = my >= 0 && my < m.length && mx >= 0 && mx < m.length && m[my][mx];
      raw[rowStart + 1 + x] = dark ? 0 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
