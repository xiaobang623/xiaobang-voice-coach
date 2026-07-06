import { requireAdmin } from "../_lib/admin-auth.js";
import { getAdminSupabase } from "../_lib/admin-supabase.js";
import { setJsonCors, json } from "../_lib/http.js";

function parseIntParam(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
    const search = (url.searchParams.get("search") ?? "").trim();
    const sortBy = url.searchParams.get("sort_by") ?? "created_at";
    const sortOrder = url.searchParams.get("sort_order") === "asc" ? "asc" : "desc";
    const offset = (page - 1) * limit;

    const supabase = getAdminSupabase();

    let profileQuery = supabase.from("profiles").select("id, nickname, created_at", { count: "exact" });

    if (search) {
      profileQuery = profileQuery.ilike("nickname", `%${search}%`);
    }

    const { data: profiles, count, error: profileError } = await profileQuery;
    if (profileError) {
      throw new Error(profileError.message);
    }

    const profileList = profiles ?? [];
    const userIds = profileList.map((p) => p.id);

    const sessionCounts = new Map();
    const lastSessions = new Map();
    const totalCosts = new Map();

    if (userIds.length > 0) {
      const { data: sessions, error: sessionError } = await supabase
        .from("sessions")
        .select("user_id, created_at")
        .in("user_id", userIds);

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      for (const session of sessions ?? []) {
        sessionCounts.set(session.user_id, (sessionCounts.get(session.user_id) ?? 0) + 1);
        const prev = lastSessions.get(session.user_id);
        if (!prev || session.created_at > prev) {
          lastSessions.set(session.user_id, session.created_at);
        }
      }

      const { data: logs, error: logError } = await supabase
        .from("token_logs")
        .select("user_id, cost")
        .in("user_id", userIds);

      if (logError) {
        throw new Error(logError.message);
      }

      for (const log of logs ?? []) {
        totalCosts.set(log.user_id, (totalCosts.get(log.user_id) ?? 0) + Number(log.cost));
      }
    }

    const rows = profileList.map((profile) => ({
      id: profile.id,
      nickname: profile.nickname ?? "未设置昵称",
      created_at: profile.created_at,
      session_count: sessionCounts.get(profile.id) ?? 0,
      total_cost: Number((totalCosts.get(profile.id) ?? 0).toFixed(2)),
      last_session: lastSessions.get(profile.id) ?? null,
    }));

    const sortableKeys = new Set(["created_at", "session_count", "total_cost"]);
    const key = sortableKeys.has(sortBy) ? sortBy : "created_at";

    rows.sort((a, b) => {
      const left = a[key];
      const right = b[key];
      if (left === right) {
        return 0;
      }
      if (left === null) {
        return 1;
      }
      if (right === null) {
        return -1;
      }
      if (left < right) {
        return sortOrder === "asc" ? -1 : 1;
      }
      return sortOrder === "asc" ? 1 : -1;
    });

    const paged = rows.slice(offset, offset + limit);

    json(res, 200, {
      success: true,
      data: paged,
      pagination: {
        page,
        limit,
        total: count ?? rows.length,
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load users",
    });
  }
}
