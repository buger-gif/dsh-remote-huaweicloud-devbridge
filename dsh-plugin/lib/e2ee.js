/**
 * 端到端加密核心（零第三方依赖）。
 *
 * 威胁模型：华为云 DevBridge 中继会终止公网 TLS，能看到到达网关的明文 HTTP。
 * 本层让浏览器与本机网关之间再建立一条应用层加密通道：
 *
 *   二维码（带外，摄像头扫描，不触网）只放一个 8 字节公钥指纹
 *     ↓
 *   浏览器生成临时 ECDH P-256 密钥对 → 明文发公钥给网关（公钥不是秘密）
 *     ↓
 *   网关用长期 ECDH 私钥算共享密钥；浏览器校验网关公钥哈希 == 二维码指纹
 *     ↓ 中继即使替换公钥，也过不了指纹校验
 *   HKDF-SHA256 派生 32B 主密钥，再拆成 c2s / s2c 两个方向密钥
 *     ↓
 *   AES-256-GCM，12B 随机 IV，AAD 绑定 sid|方向|序号；序号严格递增防重放
 *
 * 浏览器侧用 WebCrypto 实现同样算法（见 web/e2ee-shim.js），Node 侧用 node:crypto；
 * 两者互操作由 tests/e2ee.test.mjs 覆盖。
 *
 * 边界：页面 JS 本身仍经中继加载，可防被动窃听/日志留存/公钥替换，
 * 不防中继主动篡改页面脚本（那需要带外可信客户端）。
 */
import crypto from "node:crypto";

export const INFO_MASTER = "dsh-devbridge-e2ee-v1";
export const INFO_C2S = "c2s";
export const INFO_S2C = "s2c";

export function generateKeyPair() {
  return crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}

export function publicKeyDer(publicKey) {
  return publicKey.export({ format: "der", type: "spki" });
}

/** 二维码里携带的短指纹：SHA-256(SPKI) 前 8 字节 → 11 个 base64url 字符。 */
export function fingerprint(publicKeyDerBytes) {
  return crypto.createHash("sha256").update(publicKeyDerBytes).digest().subarray(0, 8).toString("base64url");
}

export function deriveKeys({ privateKey, peerPublicDer, sid }) {
  const peer = crypto.createPublicKey({ key: peerPublicDer, format: "der", type: "spki" });
  const shared = crypto.diffieHellman({ privateKey, publicKey: peer });
  const master = Buffer.from(crypto.hkdfSync(
    "sha256", shared, Buffer.from(sid, "utf8"), Buffer.from(INFO_MASTER, "utf8"), 32,
  ));
  // 用 sid 作 salt（而非空 salt）：Node 与 WebCrypto 对空 salt 的处理存在实现差异，
  // 固定非空 salt 才能保证两侧派生结果逐字节一致。
  const sub = (info) => Buffer.from(crypto.hkdfSync(
    "sha256", master, Buffer.from(sid, "utf8"), Buffer.from(info, "utf8"), 32,
  ));
  return { c2s: sub(INFO_C2S), s2c: sub(INFO_S2C) };
}

/** 加密任意 Buffer/字符串，返回可 JSON 序列化的帧。 */
export function seal(key, plain, { sid, dir, seq }) {
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`${sid}|${dir}|${seq}`, "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const body = Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), "utf8");
  const ct = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  return {
    sid, seq, dir,
    iv: iv.toString("base64url"),
    ct: ct.toString("base64url"),
  };
}

/** 解密并校验 AAD / GCM tag；任何篡改都会抛错。 */
export function open(key, frame, { sid, dir, minSeq = -1 }) {
  if (!frame || frame.sid !== sid || frame.dir !== dir) throw new Error("e2ee frame binding mismatch");
  if (!Number.isSafeInteger(frame.seq) || frame.seq <= minSeq) throw new Error("e2ee replay or bad sequence");
  const raw = Buffer.from(String(frame.ct), "base64url");
  if (raw.length < 17) throw new Error("e2ee ciphertext too short");
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(0, raw.length - 16);
  const iv = Buffer.from(String(frame.iv), "base64url");
  if (iv.length !== 12) throw new Error("e2ee bad iv");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`${sid}|${dir}|${frame.seq}`, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** 网关侧会话表：一个 sid 对应一组方向密钥与独立的收发序号窗口。 */
export class E2eeSessions {
  constructor({ ttlMs = 12 * 60 * 60 * 1000, max = 64, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  create(keys, { dshCookies = [], sid = null } = {}) {
    if (this.map.size >= this.max) {
      // 清理最旧的会话，避免无限增长。
      const oldest = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.map.delete(oldest[0]);
    }
    // 握手时先定 sid，再用它派生密钥，所以这里允许显式传入。
    const id = sid || crypto.randomBytes(12).toString("base64url");
    this.map.set(id, {
      keys,
      at: this.now(),
      dshCookies,
      recvSeq: -1,   // 已处理的 c2s 最大序号
      sendSeq: -1,   // 已发出的 s2c 最大序号
    });
    return id;
  }

  get(sid) {
    const row = this.map.get(sid);
    if (!row) return null;
    if (this.now() - row.at > this.ttlMs) {
      this.map.delete(sid);
      return null;
    }
    return row;
  }

  /** 校验并解开浏览器 → 网关的帧，顺带推进防重放窗口。 */
  openClient(row, frame, sid) {
    const plain = open(row.keys.c2s, frame, { sid, dir: "c2s", minSeq: row.recvSeq });
    row.recvSeq = frame.seq;
    return plain;
  }

  /** 封装网关 → 浏览器的帧，序号单调递增。 */
  sealServer(row, plain, sid) {
    row.sendSeq += 1;
    return seal(row.keys.s2c, plain, { sid, dir: "s2c", seq: row.sendSeq });
  }

  dispose(sid) { this.map.delete(sid); }

  get size() { return this.map.size; }
}
