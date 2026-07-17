import { getAdminSupabase } from "./_lib/admin-supabase.js";
import { setJsonCors, readJsonBody, json } from "./_lib/http.js";
import {
  evaluateGuestQuota,
  resolveGuestDailyLimit,
  startOfTodayShanghai,
} from "./_lib/quota.js";

/**
 * C3 成本/滥用护栏：游客每日会话上限查询。
 *
 * POST { userId?, guestId? } →
 *   { success, allowed, used, limit, remaining, actor }
 *
 * - 登录用户（含匿名 auth 转正的正式账号）不限次，直接放行。
 * - 游客按 Asia/Shanghai 自然日计数，取 sessions 落库数与 app_events
 *   ready_click 去重会话数的较大值（口径见 api/_lib/quota.js）。
 * - 护栏原则 fail-open：任何查询失败都放行，绝不因护栏故障挡住正常用户。
 *   前端同样按 fail-open 处理（拿不到结果 = 放行）。
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

  const limit = resolveGuestDailyLimit(process.env.GUEST_DAILY_SESSION_LIMIT);

  try {
    const body = await readJsonBody(req);
    const userId = typeof body?.userId === "string" && body.userId ? body.userId : null;
    const guestId = typeof body?.guestId === "string" && body.guestId ? body.guestId : null;
    // 匿名 auth 的游客：埋点事件按匿名 auth uid 记录（app_events.user_id），
    // sessions 按 localStorage guestId 记录，两个 id 都要查。
    const anonUserId =
      typeof body?.anonUserId === "string" && body.anonUserId ? body.anonUserId : null;

    // 登录用户不限次（额度问题走管理后台日额度告警，不在这里拦）。
    if (userId) {
      json(res, 200, {
        success: true,
        allowed: true,
        used: 0,
        limit: null,
        remaining: null,
        actor: "user",
      });
      return;
    }

    if (!guestId) {
      json(res, 400, { success: false, error: "userId or guestId is required" });
      return;
    }

    const supabase = getAdminSupabase();
    const todayStart = startOfTodayShanghai();

    const [sessionsResult, readyClicksResult] = await Promise.all([
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("guest_id", guestId)
        .gte("created_at", todayStart),
      supabase
        .from("app_events")
        .select("session_id")
        .eq("event_name", "ready_click")
        .or(
          anonUserId
            ? `guest_id.eq.${guestId},user_id.eq.${anonUserId}`
            : `guest_id.eq.${guestId}`,
        )
        .gte("created_at", todayStart),
    ]);

    // fail-open：任一查询报错时按 0 计，不拦人。
    const sessionsToday = sessionsResult.error ? 0 : (sessionsResult.count ?? 0);
    const readyClicksToday = readyClicksResult.error
      ? 0
      : new Set(
          (readyClicksResult.data ?? [])
            .map((row) => row.session_id)
            .filter(Boolean),
        ).size;

    const quota = evaluateGuestQuota({ sessionsToday, readyClicksToday, limit });

    json(res, 200, { success: true, actor: "guest", ...quota });
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
      limit,
      remaining: limit,
      actor: "guest",
      degraded: true,
    });
  }
}
