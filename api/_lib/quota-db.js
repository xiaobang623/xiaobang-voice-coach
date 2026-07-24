import { startOfTodayShanghai } from "./quota.js";

/**
 * 统计某个行动者「今天」的会话使用量，供 check-quota / issue-voice-token 共用。
 *
 * 两个信号取较大值（口径见 quota.js）：
 *   1. sessions 表当天落库会话数（结束才写，中途放弃不计）
 *   2. app_events 当天 ready_click 去重 session 数（开始就写，覆盖中途放弃）
 *
 * fail-open：任一查询报错都按 0 计，绝不因护栏故障挡正常用户。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ actor: "user"|"guest", userId?: string|null, guestId?: string|null, anonUserId?: string|null }} args
 * @returns {Promise<{ sessionsToday: number, readyClicksToday: number, degraded: boolean }>}
 */
export async function countSessionsToday(supabase, { actor, userId, guestId, anonUserId }) {
  const todayStart = startOfTodayShanghai();

  // sessions 表按登录用户或游客 id 过滤。
  const sessionsQuery = supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .gte("created_at", todayStart);

  // ready_click 事件：游客可能同时有 localStorage guestId 与匿名 auth uid，两个 id 都查。
  const readyOrFilter =
    actor === "user"
      ? userId
        ? `user_id.eq.${userId}`
        : null
      : anonUserId && guestId
        ? `guest_id.eq.${guestId},user_id.eq.${anonUserId}`
        : guestId
          ? `guest_id.eq.${guestId}`
          : null;

  if (actor === "user") {
    if (!userId) {
      return { sessionsToday: 0, readyClicksToday: 0, degraded: false };
    }
    sessionsQuery.eq("user_id", userId);
  } else {
    if (!guestId) {
      return { sessionsToday: 0, readyClicksToday: 0, degraded: false };
    }
    sessionsQuery.eq("guest_id", guestId);
  }

  const readyClicksQuery = supabase
    .from("app_events")
    .select("session_id")
    .eq("event_name", "ready_click")
    .gte("created_at", todayStart);
  if (readyOrFilter) {
    readyClicksQuery.or(readyOrFilter);
  }

  const [sessionsResult, readyClicksResult] = await Promise.all([
    sessionsQuery,
    readyClicksQuery,
  ]);

  const degraded = Boolean(sessionsResult.error || readyClicksResult.error);
  const sessionsToday = sessionsResult.error ? 0 : (sessionsResult.count ?? 0);
  const readyClicksToday = readyClicksResult.error
    ? 0
    : new Set(
        (readyClicksResult.data ?? []).map((row) => row.session_id).filter(Boolean),
      ).size;

  return { sessionsToday, readyClicksToday, degraded };
}
