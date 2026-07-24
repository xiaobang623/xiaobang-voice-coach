import { getAdminSupabase } from "./_lib/admin-supabase.js";
import { setJsonCors, readJsonBody, json } from "./_lib/http.js";
import {
  evaluateGuestQuota,
  evaluateUserQuota,
  resolveGuestDailyLimit,
  resolveUserDailyLimit,
} from "./_lib/quota.js";
import { countSessionsToday } from "./_lib/quota-db.js";
import { signVoiceToken, VOICE_TOKEN_DEFAULT_TTL_SECONDS } from "./_lib/voice-token.js";

/**
 * C3 护栏 + proxy 鉴权的「唯一入口」：连语音代理前必须来这里换一个短时 token。
 *
 * POST { userId?, guestId?, anonUserId?, sessionId? } →
 *   { success, allowed, token, used, limit, remaining, actor }
 *
 * - 登录用户与游客都计数并各自应用日上限（登录用户上限更宽，仅防脚本刷）。
 * - 只有本接口能用 VOICE_TOKEN_SECRET 签发 token；proxy 用同一密钥校验。
 * - 未超额 → 签发绑定 {actor,id,sessionId} 的 token（默认 120s 有效）。
 * - 超额 → 不签发 token，allowed=false，前端弹「今天次数用完」。
 * - fail-open：额度查询本身故障时按放行处理并照常签发 token
 *   （护栏故障不挡正常用户；而「换不到 token」只会发生在我们自家后端挂掉时，
 *    那时整个 app 都不可用，proxy 拒连是可接受的 fail-closed）。
 */
export default async function handler(req, res) {
  setJsonCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const secret = process.env.VOICE_TOKEN_SECRET ?? "";
  const ttl = VOICE_TOKEN_DEFAULT_TTL_SECONDS;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    body = null;
  }

  const userId = typeof body?.userId === "string" && body.userId ? body.userId : null;
  const guestId = typeof body?.guestId === "string" && body.guestId ? body.guestId : null;
  const anonUserId =
    typeof body?.anonUserId === "string" && body.anonUserId ? body.anonUserId : null;
  const sessionId =
    typeof body?.sessionId === "string" && body.sessionId ? body.sessionId : null;

  const actor = userId ? "user" : "guest";
  const actorId = userId ?? guestId;

  if (!actorId) {
    json(res, 400, { success: false, error: "userId or guestId is required" });
    return;
  }

  const mintToken = () =>
    signVoiceToken({ actor, id: actorId, sessionId, ttlSeconds: ttl }, secret);

  try {
    const supabase = getAdminSupabase();
    const { sessionsToday, readyClicksToday, degraded } = await countSessionsToday(supabase, {
      actor,
      userId,
      guestId,
      anonUserId,
    });

    const quota =
      actor === "user"
        ? evaluateUserQuota({
            sessionsToday,
            readyClicksToday,
            limit: resolveUserDailyLimit(process.env.USER_DAILY_SESSION_LIMIT),
          })
        : evaluateGuestQuota({
            sessionsToday,
            readyClicksToday,
            limit: resolveGuestDailyLimit(process.env.GUEST_DAILY_SESSION_LIMIT),
          });

    if (!quota.allowed) {
      json(res, 200, { success: true, actor, token: null, ...quota });
      return;
    }

    json(res, 200, {
      success: true,
      actor,
      token: mintToken(),
      degraded,
      ...quota,
    });
  } catch (error) {
    // fail-open：额度查询/DB 故障时放行并照常签发 token。
    console.warn(
      "[issue-voice-token] quota check failed, allowing by default:",
      error instanceof Error ? error.message : error,
    );
    json(res, 200, {
      success: true,
      actor,
      token: mintToken(),
      allowed: true,
      used: 0,
      limit: null,
      remaining: null,
      degraded: true,
    });
  }
}
