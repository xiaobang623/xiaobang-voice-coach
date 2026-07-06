import { requireAdmin } from "../_lib/admin-auth.js";
import { getAdminSupabase } from "../_lib/admin-supabase.js";
import { setJsonCors, json } from "../_lib/http.js";

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
    const userId = url.searchParams.get("user_id");
    const dateFrom = url.searchParams.get("date_from") ?? defaultDateFrom();
    const dateTo = url.searchParams.get("date_to") ?? todayDate();
    const sortOrder = url.searchParams.get("sort_order") === "asc" ? "asc" : "desc";
    const offset = (page - 1) * limit;

    const supabase = getAdminSupabase();

    let query = supabase
      .from("sessions")
      .select("id, user_id, topic, transcript, duration_seconds, created_at", { count: "exact" })
      .gte("created_at", `${dateFrom}T00:00:00.000Z`)
      .lte("created_at", `${dateTo}T23:59:59.999Z`)
      .order("created_at", { ascending: sortOrder === "asc" });

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data: sessions, count, error } = await query.range(offset, offset + limit - 1);
    if (error) {
      throw new Error(error.message);
    }

    const sessionList = sessions ?? [];
    const userIds = [...new Set(sessionList.map((s) => s.user_id))];
    const sessionIds = sessionList.map((s) => s.id);

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

    const costs = new Map();
    if (sessionIds.length > 0) {
      const { data: logs } = await supabase
        .from("token_logs")
        .select("session_id, cost")
        .in("session_id", sessionIds);
      for (const log of logs ?? []) {
        if (!log.session_id) {
          continue;
        }
        costs.set(log.session_id, (costs.get(log.session_id) ?? 0) + Number(log.cost));
      }
    }

    const data = sessionList.map((session) => ({
      id: session.id,
      user_id: session.user_id,
      user_nickname: nicknames.get(session.user_id) ?? "未知用户",
      topic: session.topic,
      duration_seconds: session.duration_seconds,
      created_at: session.created_at,
      transcript_preview: (session.transcript ?? "").slice(0, 100),
      total_cost: Number((costs.get(session.id) ?? 0).toFixed(2)),
    }));

    json(res, 200, {
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count ?? 0,
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load sessions",
    });
  }
}
