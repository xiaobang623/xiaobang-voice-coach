import { getAdminSupabase } from "./_lib/admin-supabase.js";
import { setJsonCors, readJsonBody, json } from "./_lib/http.js";
import {
  evaluateGuestQuota,
  evaluateUserQuota,
  resolveGuestDailyLimit,
  resolveUserDailyLimit,
} from "./_lib/quota.js";
import { countSessionsToday } from "./_lib/quota-db.js";

/**
 * C3 成本/滥用护栏：每日会话上限查询（供前端展示「今天还剩几次」用）。
 *
 * POST { userId?, guestId?, anonUserId? } →
 *   { success, allowed, used, limit, remaining, actor }
 *
 * - 游客与登录用户都计数并各自应用日上限（游客 3 次，登录用户更宽，仅防脚本刷）。
 * - 这里只做「展示」；真正拦语音连接的闸门在 /api/issue-voice-token +
 *   proxy 侧 token 校验，前端拿不到 token 就连不上代理。
 * - 护栏原则 fail-open：任何查询失败都放行，绝不因护栏故障挡住正常用户。
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

  const actor = userId ? "user" : "guest";

  if (actor === "guest" && !guestId) {
    json(res, 400, { success: false, error: "userId or guestId is required" });
    return;
  }

  const limitEnv =
    actor === "user"
      ? resolveUserDailyLimit(process.env.USER_DAILY_SESSION_LIMIT)
      : resolveGuestDailyLimit(process.env.GUEST_DAILY_SESSION_LIMIT);

  try {
    const supabase = getAdminSupabase();
    const { sessionsToday, readyClicksToday } = await countSessionsToday(supabase, {
      actor,
      userId,
      guestId,
      anonUserId,
    });

    const quota =
      actor === "user"
        ? evaluateUserQuota({ sessionsToday, readyClicksToday, limit: limitEnv })
        : evaluateGuestQuota({ sessionsToday, readyClicksToday, limit: limitEnv });

    json(res, 200, { success: true, actor, ...quota });
  } catch (error) {
    // fail-open：护栏自身故障时放行。
    console.warn(
      "[check-quota] failed, allowing by default:",
      error instanceof Error ? error.message : error,
    );
    json(res, 200, {
      success: true,
      allowed: true,
      used: 0,
      limit: limitEnv,
      remaining: limitEnv,
      actor,
      degraded: true,
    });
  }
}
