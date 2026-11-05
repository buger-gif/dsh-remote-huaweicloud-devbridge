import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  generateKeyPair, publicKeyDer, fingerprint, deriveKeys,
  seal, open, E2eeSessions, INFO_MASTER, INFO_C2S, INFO_S2C,
} from "../lib/e2ee.js";

const enc = new TextEncoder();
const subtle = globalThis.crypto?.subtle;
const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** 模拟浏览器侧：WebCrypto 的 ECDH + HKDF + AES-GCM，与 Node 侧必须互操作。 */
async function browserSide(serverSpki, sid) {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const clientSpki = new Uint8Array(await subtle.exportKey("spki", kp.publicKey));
  const serverKey = await subtle.importKey("spki", serverSpki, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: serverKey }, kp.privateKey, 256));

  const hkdf = async (ikm, salt, info) => {
    const base = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info }, base, 256,
    ));
  };
  const master = await hkdf(shared, enc.encode(sid), enc.encode(INFO_MASTER));
  const c2s = await hkdf(master, enc.encode(sid), enc.encode(INFO_C2S));
  const s2c = await hkdf(master, enc.encode(sid), enc.encode(INFO_S2C));
  return { clientSpki, c2s, s2c };
}

async function webAesKey(raw) {
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

test("指纹：稳定、短、且随公钥变化", () => {
  const a = generateKeyPair();
  const b = generateKeyPair();
  const der = publicKeyDer(a.publicKey);
  const fp = fingerprint(der);
  assert.equal(fp, fingerprint(der));
  assert.match(fp, /^[A-Za-z0-9_-]{11}$/);
  assert.notEqual(fp, fingerprint(publicKeyDer(b.publicKey)));
});

test("Node 侧自行往返 + 篡改 / 重放 / 绑定校验", () => {
  const kp = generateKeyPair();
  const der = publicKeyDer(kp.publicKey);
  const sid = "session-1";
  const keys = deriveKeys({ privateKey: kp.privateKey, peerPublicDer: der, sid });
  assert.notEqual(keys.c2s.toString("hex"), keys.s2c.toString("hex"), "两个方向密钥必须不同");

  const frame = seal(keys.c2s, "聊天内容：不要被中继看到", { sid, dir: "c2s", seq: 1 });
  assert.equal(open(keys.c2s, frame, { sid, dir: "c2s", minSeq: 0 }).toString(), "聊天内容：不要被中继看到");

  const tampered = { ...frame, ct: b64u(Buffer.from(frame.ct, "base64url").map((x, i) => (i === 0 ? x ^ 1 : x))) };
  assert.throws(() => open(keys.c2s, tampered, { sid, dir: "c2s", minSeq: 0 }), /auth|tag|final|unable/i);
  assert.throws(() => open(keys.c2s, frame, { sid, dir: "c2s", minSeq: 1 }), /replay|sequence/i);
  assert.throws(() => open(keys.c2s, frame, { sid: "other", dir: "c2s", minSeq: 0 }), /binding/i);
  assert.throws(() => open(keys.s2c, frame, { sid, dir: "c2s", minSeq: 0 }));
});

test("Node 与 WebCrypto 双侧派生出完全相同的密钥，并且跨语言加解密互通", { skip: !subtle }, async () => {
  const kp = generateKeyPair();
  const serverSpki = publicKeyDer(kp.publicKey);
  const sid = "xchg-session-2";
  const browser = await browserSide(serverSpki, sid);
  const server = deriveKeys({ privateKey: kp.privateKey, peerPublicDer: browser.clientSpki, sid });

  assert.equal(Buffer.from(browser.c2s).toString("hex"), server.c2s.toString("hex"), "c2s 派生不一致");
  assert.equal(Buffer.from(browser.s2c).toString("hex"), server.s2c.toString("hex"), "s2c 派生不一致");

  // 浏览器加密 → 网关解密
  const iv = crypto.randomBytes(12);
  const aad = enc.encode(`${sid}|c2s|7`);
  const key = await webAesKey(browser.c2s);
  const cipher = new Uint8Array(await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad }, key, enc.encode("来自浏览器的密文"),
  ));
  const frame = { sid, dir: "c2s", seq: 7, iv: b64u(iv), ct: b64u(cipher) };
  assert.equal(open(server.c2s, frame, { sid, dir: "c2s", minSeq: 6 }).toString(), "来自浏览器的密文");

  // 网关加密 → 浏览器解密
  const back = seal(server.s2c, "来自网关的流式输出", { sid, dir: "s2c", seq: 3 });
  const key2 = await webAesKey(browser.s2c);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(back.iv, "base64url"), additionalData: enc.encode(`${sid}|s2c|3`) },
    key2, Buffer.from(back.ct, "base64url"),
  );
  assert.equal(new TextDecoder().decode(plain), "来自网关的流式输出");
});

test("E2eeSessions：序号窗口、会话隔离、TTL 与容量", () => {
  let now = 1000;
  const sessions = new E2eeSessions({ ttlMs: 1000, max: 2, now: () => now });
  const kp = generateKeyPair();
  const der = publicKeyDer(kp.publicKey);
  const sid = "session-1";
  const keys = deriveKeys({ privateKey: kp.privateKey, peerPublicDer: der, sid });
  assert.equal(sessions.create(keys, { sid, dshCookies: ["a=b"] }), sid);
  const row = sessions.get(sid);
  assert.deepEqual(row.dshCookies, ["a=b"]);

  const f = seal(row.keys.c2s, "hello", { sid, dir: "c2s", seq: 0 });
  assert.equal(sessions.openClient(row, f, sid).toString(), "hello");
  assert.throws(() => sessions.openClient(row, f, sid), /replay|sequence/);
  const out = sessions.sealServer(row, "world", sid);
  assert.equal(open(row.keys.s2c, out, { sid, dir: "s2c", minSeq: -1 }).toString(), "world");
  assert.equal(sessions.sealServer(row, "again", sid).seq, 1, "服务端序号必须单调递增");

  now += 1001;
  assert.equal(sessions.get(sid), null, "过期会话应被清除");

  const s2 = sessions.create(deriveKeys({ privateKey: kp.privateKey, peerPublicDer: der, sid: "a" }));
  const s3 = sessions.create(deriveKeys({ privateKey: kp.privateKey, peerPublicDer: der, sid: "b" }));
  const s4 = sessions.create(deriveKeys({ privateKey: kp.privateKey, peerPublicDer: der, sid: "c" }));
  assert.equal(sessions.size, 2, "超过容量应淘汰最旧会话");
  assert.ok(s3 && s4 && !sessions.get(s2));
});
