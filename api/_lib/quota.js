/**
 * C3 成本/滥用护栏 · 纯逻辑（零依赖，供 API 和 evals smoke 共用）。
 *
 * 口径说明：
 * - 「一天」按 Asia/Shanghai (UTC+8) 的自然日计算，用户主要在国内。
 * - 游客当日会话数取两个信号的较大值：
 *   1. sessions 表当天落库的会话数（会话结束时写入，中途放弃不计）
 *   2. app_events 当天 ready_click 去重 session 数（会话开始时写入，覆盖中途放弃）
 *   两者都是服务端写入，客户端伪造成本高；取 max 防止单一信号漏计。
 * - 护栏原则 fail-open：查询失败时放行，绝不因护栏故障挡住正常用户。
 */

export const DEFAULT_GUEST_DAILY_SESSION_LIMIT = 3;
// 登录用户不再「无限」：给一个宽松但兜底的日上限，堵住「注册即绕过护栏」。
// 正常用户一天几乎不可能练到 30 次；主要是防脚本用注册号刷爆语音成本。
export const DEFAULT_USER_DAILY_SESSION_LIMIT = 30;
export const DEFAULT_DAILY_COST_ALERT_CNY = 5;

/** Resolve a positive-integer limit from an env-ish value, falling back to the default. */
export function resolveGuestDailyLimit(rawValue) {
  const parsed = Number(rawValue);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_GUEST_DAILY_SESSION_LIMIT;
}

/** Resolve the per-user daily session limit from an env-ish value. */
export function resolveUserDailyLimit(rawValue) {
  const parsed = Number(rawValue);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_USER_DAILY_SESSION_LIMIT;
}

/** Resolve the per-actor daily cost alert threshold (CNY). */
export function resolveDailyCostAlertThreshold(rawValue) {
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_DAILY_COST_ALERT_CNY;
}

/** ISO timestamp of today's 00:00 in Asia/Shanghai (UTC+8, no DST). */
export function startOfTodayShanghai(now = new Date()) {
  const shanghaiMs = now.getTime() + 8 * 60 * 60 * 1000;
  const shanghaiDayStartMs = Math.floor(shanghaiMs / 86_400_000) * 86_400_000;
  return new Date(shanghaiDayStartMs - 8 * 60 * 60 * 1000).toISOString();
}

/**
 * Decide whether a guest may start another session today.
 * Counts are clamped to non-negative integers; bad input never blocks.
 */
export function evaluateGuestQuota({ sessionsToday, readyClicksToday, limit }) {
  const safeCount = (value) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

  const used = Math.max(safeCount(sessionsToday), safeCount(readyClicksToday));
  const safeLimit = resolveGuestDailyLimit(limit);

  return {
    allowed: used < safeLimit,
    used,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - used),
  };
}

/**
 * Decide whether a logged-in user may start another session today.
 * Same shape as guest, but with the (looser) user daily limit.
 */
export function evaluateUserQuota({ sessionsToday, readyClicksToday, limit }) {
  const safeCount = (value) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

  const used = Math.max(safeCount(sessionsToday), safeCount(readyClicksToday));
  const safeLimit = resolveUserDailyLimit(limit);

  return {
    allowed: used < safeLimit,
    used,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - used),
  };
}

/**
 * Aggregate today's token_logs rows into per-actor cost alerts.
 * Input rows: { user_id, guest_id, cost }. Returns actors whose summed cost
 * meets/exceeds the threshold, sorted by cost desc.
 */
export function buildDailyCostAlerts(rows, threshold) {
  const safeThreshold = resolveDailyCostAlertThreshold(threshold);
  const totals = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const userId = row.user_id ?? null;
    const guestId = row.guest_id ?? null;
    if (!userId && !guestId) {
      continue;
    }
    const cost = Number(row.cost ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) {
      continue;
    }
    const key = userId ? `user:${userId}` : `guest:${guestId}`;
    totals.set(key, (totals.get(key) ?? 0) + cost);
  }

  const alerts = [];
  for (const [key, cost] of totals) {
    if (cost >= safeThreshold) {
      const [actorType, actorId] = key.split(/:(.*)/s);
      alerts.push({
        actor_type: actorType,
        actor_id: actorId,
        cost: Number(cost.toFixed(2)),
      });
    }
  }

  return alerts.sort((a, b) => b.cost - a.cost);
}
