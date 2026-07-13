import { requireAdmin } from "../api/_lib/admin-auth.js";
import { getAdminSupabase } from "../api/_lib/admin-supabase.js";
import { getCostProviderMeta } from "../api/_lib/cost-providers.js";
import { setJsonCors, json } from "../api/_lib/http.js";

function parseIntParam(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function defaultDateFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().slice(0, 10);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function guestNickname(guestId) {
  return `游客 ${guestId.slice(0, 8)}`;
}

function isGuestIdColumnMissing(error) {
  return Boolean(error?.message?.includes("guest_id"));
}

async function fetchPersistedSessions(supabase, { dateStart, dateEnd, actorFilter }) {
  const baseFields = "id, user_id, topic, transcript, duration_seconds, created_at";
  const buildQuery = (selectFields, { includeGuestFilter }) => {
    let query = supabase
      .from("sessions")
      .select(selectFields)
      .gte("created_at", dateStart)
      .lte("created_at", dateEnd);

    if (!actorFilter) {
      return query;
    }

    if (includeGuestFilter) {
      return query.or(`user_id.eq.${actorFilter},guest_id.eq.${actorFilter}`);
    }

    return query.eq("user_id", actorFilter);
  };

  let result = await buildQuery(`${baseFields}, guest_id`, { includeGuestFilter: true });
  if (isGuestIdColumnMissing(result.error)) {
    result = await buildQuery(baseFields, { includeGuestFilter: false });
    if (!result.error && result.data) {
      result.data = result.data.map((row) => ({ ...row, guest_id: null }));
    }
  }

  return result;
}

function pickDoubaoLog(logs) {
  if (!logs.length) {
    return null;
  }
  return logs.reduce((best, log) => {
    const tokens = Number(log.tokens_used ?? 0);
    const bestTokens = Number(best.tokens_used ?? 0);
    if (tokens > bestTokens) {
      return log;
    }
    if (tokens === bestTokens && Number(log.cost ?? 0) > Number(best.cost ?? 0)) {
      return log;
    }
    return best;
  });
}

function aggregateSessionUsage(logs) {
  const byProvider = new Map();

  const grouped = new Map();
  for (const log of logs ?? []) {
    if (!log.session_id) {
      continue;
    }
    const bucket = grouped.get(log.session_id) ?? { doubao: [], other: [] };
    if (log.api_provider === "doubao") {
      bucket.doubao.push(log);
    } else {
      bucket.other.push(log);
    }
    grouped.set(log.session_id, bucket);
  }

  for (const [sessionId, bucket] of grouped.entries()) {
    const providers = new Map();
    let earliest = null;

    const consider = (log) => {
      if (!earliest || log.created_at < earliest) {
        earliest = log.created_at;
      }
    };

    const doubaoLog = pickDoubaoLog(bucket.doubao);
    if (doubaoLog) {
      consider(doubaoLog);
      providers.set("doubao", {
        api_provider: "doubao",
        short_label: getCostProviderMeta("doubao").short_label,
        cost: Number(doubaoLog.cost ?? 0),
      });
    }

    for (const log of bucket.other) {
      consider(log);
      const provider = log.api_provider ?? "other";
      const existing = providers.get(provider) ?? {
        api_provider: provider,
        short_label: getCostProviderMeta(provider).short_label,
        cost: 0,
      };
      existing.cost += Number(log.cost ?? 0);
      providers.set(provider, existing);
    }

    const costByProvider = [...providers.values()].map((row) => ({
      ...row,
      cost: Number(row.cost.toFixed(4)),
    }));
    const totalCost = costByProvider.reduce((sum, row) => sum + row.cost, 0);
    const voiceBackend = providers.has("doubao")
      ? "doubao"
      : providers.has("siliconflow")
        ? "selfhosted"
        : providers.size > 0
          ? "selfhosted"
          : null;

    byProvider.set(sessionId, {
      earliest,
      totalCost,
      costByProvider,
      voiceBackend,
    });
  }

  return byProvider;
}

function aggregateGuestLogSessions(logs, persistedIds, usageBySession) {
  const sessionMap = new Map();

  for (const log of logs ?? []) {
    if (!log.session_id || !log.guest_id || persistedIds.has(log.session_id)) {
      continue;
    }

    const usage = usageBySession.get(log.session_id);
    const row =
      sessionMap.get(log.session_id) ??
      {
        id: log.session_id,
        user_id: null,
        guest_id: log.guest_id,
        user_nickname: guestNickname(log.guest_id),
        topic: null,
        duration_seconds: null,
        created_at: usage?.earliest ?? log.created_at,
        transcript_preview: "",
        total_cost: usage?.totalCost ?? 0,
        cost_by_provider: usage?.costByProvider ?? [],
        voice_backend: usage?.voiceBackend ?? null,
        is_guest: true,
        is_archived: false,
      };

    sessionMap.set(log.session_id, row);
  }

  return [...sessionMap.values()].map((row) => ({
    ...row,
    total_cost: Number(row.total_cost.toFixed(2)),
  }));
}

export default async function handler(req, res) {
  setJsonCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const user = await requireAdmin(req, res);
  if (!user) {
    return;
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const page = parseIntParam(url.searchParams.get("page"), 1);
    const limit = Math.min(parseIntParam(url.searchParams.get("limit"), 50), 100);
    const actorFilter = (url.searchParams.get("user_id") ?? "").trim();
    const dateFrom = url.searchParams.get("date_from") ?? defaultDateFrom();
    const dateTo = url.searchParams.get("date_to") ?? todayDate();
    const sortOrder = url.searchParams.get("sort_order") === "asc" ? "asc" : "desc";
    const offset = (page - 1) * limit;

    const supabase = getAdminSupabase();
    const dateStart = `${dateFrom}T00:00:00.000Z`;
    const dateEnd = `${dateTo}T23:59:59.999Z`;

    const { data: sessions, error: sessionError } = await fetchPersistedSessions(supabase, {
      dateStart,
      dateEnd,
      actorFilter,
    });
    if (sessionError) {
      throw new Error(sessionError.message);
    }

    let guestLogQuery = supabase
      .from("token_logs")
      .select("session_id, guest_id, api_provider, cost, created_at")
      .not("guest_id", "is", null)
      .not("session_id", "is", null)
      .gte("created_at", dateStart)
      .lte("created_at", dateEnd);

    if (actorFilter) {
      guestLogQuery = guestLogQuery.or(
        `guest_id.eq.${actorFilter},guest_id.ilike.${actorFilter}%`,
      );
    }

    const { data: guestLogs, error: guestLogError } = await guestLogQuery;
    if (guestLogError) {
      throw new Error(guestLogError.message);
    }

    const sessionList = sessions ?? [];
    const persistedIds = new Set(sessionList.map((session) => session.id));
    const userIds = [...new Set(sessionList.map((session) => session.user_id).filter(Boolean))];
    const sessionIds = sessionList.map((session) => session.id);

    const nicknames = new Map();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nickname")
        .in("id", userIds);
      for (const profile of profiles ?? []) {
        nicknames.set(profile.id, profile.nickname ?? "未设置昵称");
      }
    }

    const allSessionIds = [
      ...new Set([...sessionIds, ...(guestLogs ?? []).map((log) => log.session_id)]),
    ];

    let usageLogs = [];
    if (allSessionIds.length > 0) {
      const { data: logs, error: usageError } = await supabase
        .from("token_logs")
        .select("session_id, api_provider, tokens_used, duration_seconds, cost, created_at")
        .in("session_id", allSessionIds);
      if (usageError) {
        throw new Error(usageError.message);
      }
      usageLogs = logs ?? [];
    }

    const usageBySession = aggregateSessionUsage(usageLogs);

    const persistedRows = sessionList.map((session) => {
      const usage = usageBySession.get(session.id);
      const createdAt = usage?.earliest && usage.earliest < session.created_at
        ? usage.earliest
        : session.created_at;

      return {
        id: session.id,
        user_id: session.user_id,
        guest_id: session.guest_id ?? null,
        user_nickname: session.guest_id
          ? guestNickname(session.guest_id)
          : (nicknames.get(session.user_id) ?? "未知用户"),
        topic: session.topic,
        duration_seconds: session.duration_seconds,
        created_at: createdAt,
        transcript_preview: (session.transcript ?? "").slice(0, 100),
        total_cost: Number((usage?.totalCost ?? 0).toFixed(2)),
        cost_by_provider: usage?.costByProvider ?? [],
        voice_backend: usage?.voiceBackend ?? null,
        is_guest: Boolean(session.guest_id),
        is_archived: true,
      };
    });

    const orphanRows = aggregateGuestLogSessions(guestLogs, persistedIds, usageBySession);
    const rows = [...persistedRows, ...orphanRows];

    rows.sort((left, right) => {
      if (left.created_at === right.created_at) {
        return 0;
      }
      if (sortOrder === "asc") {
        return left.created_at < right.created_at ? -1 : 1;
      }
      return left.created_at > right.created_at ? -1 : 1;
    });

    const total = rows.length;
    const data = rows.slice(offset, offset + limit);

    json(res, 200, {
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load sessions",
    });
  }
}
