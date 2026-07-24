/**
 * 语音代理鉴权 token · 纯逻辑（node:crypto，零第三方依赖）。
 *
 * 为什么要它：proxy.js 直连豆包实时语音（最贵的资源），此前只按 Origin 白名单
 * 放行，而 Origin 头对非浏览器客户端可随手伪造 → 谁拿到 proxy 地址就能白嫖烧钱。
 * 这里用 HMAC-SHA256 短时签名，把「身份 + 会话 + 过期」绑成一个 token：
 *   - 只有服务端（Vercel /api/issue-voice-token）用共享密钥能签发；
 *   - proxy 用同一密钥校验签名+过期+身份一致，验不过直接拒连。
 * 前后端同一个纯函数模块，避免两侧实现漂移。
 *
 * Token 结构（紧凑，放 URL query 里）：
 *   base64url(payloadJson) + "." + base64url(hmac)
 *   payload = { a: actor("user"|"guest"), i: id, s: sessionId, e: expEpochSec }
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 120;

function base64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecodeToString(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function hmacBase64url(message, secret) {
  return base64urlEncode(createHmac("sha256", secret).update(message).digest());
}

/**
 * 签发一个短时 voice token。secret 缺失时返回 null（调用方决定是否放行）。
 * @param {{ actor: "user"|"guest", id: string, sessionId?: string|null, ttlSeconds?: number }} claims
 * @param {string} secret
 * @param {{ now?: number }} [opts] now 单位毫秒，便于测试
 */
export function signVoiceToken(claims, secret, opts = {}) {
  if (!secret || typeof secret !== "string") {
    return null;
  }
  const actor = claims?.actor === "user" ? "user" : "guest";
  const id = typeof claims?.id === "string" ? claims.id : "";
  if (!id) {
    return null;
  }
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const ttl = Number.isFinite(claims?.ttlSeconds) && claims.ttlSeconds > 0
    ? Math.floor(claims.ttlSeconds)
    : DEFAULT_TTL_SECONDS;
  const payload = {
    a: actor,
    i: id,
    s: typeof claims?.sessionId === "string" && claims.sessionId ? claims.sessionId : null,
    e: nowSec + ttl,
  };
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  const sigPart = hmacBase64url(payloadPart, secret);
  return `${payloadPart}.${sigPart}`;
}

/**
 * 校验 token。返回 { valid, reason, claims }。
 * reason 取值：ok / no-secret / malformed / bad-signature / expired。
 * @param {string} token
 * @param {string} secret
 * @param {{ now?: number }} [opts]
 */
export function verifyVoiceToken(token, secret, opts = {}) {
  if (!secret || typeof secret !== "string") {
    return { valid: false, reason: "no-secret", claims: null };
  }
  if (typeof token !== "string" || !token.includes(".")) {
    return { valid: false, reason: "malformed", claims: null };
  }
  const dot = token.indexOf(".");
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  if (!payloadPart || !sigPart) {
    return { valid: false, reason: "malformed", claims: null };
  }

  const expectedSig = hmacBase64url(payloadPart, secret);
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad-signature", claims: null };
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecodeToString(payloadPart));
  } catch {
    return { valid: false, reason: "malformed", claims: null };
  }
  if (!payload || typeof payload !== "object") {
    return { valid: false, reason: "malformed", claims: null };
  }

  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!Number.isFinite(payload.e) || payload.e < nowSec) {
    return { valid: false, reason: "expired", claims: null };
  }

  return {
    valid: true,
    reason: "ok",
    claims: {
      actor: payload.a === "user" ? "user" : "guest",
      id: typeof payload.i === "string" ? payload.i : "",
      sessionId: typeof payload.s === "string" ? payload.s : null,
      exp: payload.e,
    },
  };
}

export const VOICE_TOKEN_DEFAULT_TTL_SECONDS = DEFAULT_TTL_SECONDS;
