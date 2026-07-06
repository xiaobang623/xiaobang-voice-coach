import { requireAdmin } from "../_lib/admin-auth.js";
import { getAdminSupabase } from "../_lib/admin-supabase.js";
import { setJsonCors, json } from "../_lib/http.js";

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
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
    const supabase = getAdminSupabase();
    const { start, end } = todayBounds();

    const [
      { count: totalUsers },
      { count: totalSessions },
      { count: newUsersToday },
      { count: sessionsToday },
      { data: allCosts },
      { data: todayCosts },
      { data: guestLogs },
    ] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("sessions").select("id", { count: "exact", head: true }),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", start)
        .lte("created_at", end),
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", start)
        .lte("created_at", end),
      supabase.from("token_logs").select("cost"),
      supabase
        .from("token_logs")
        .select("cost")
        .gte("created_at", start)
        .lte("created_at", end),
      supabase.from("token_logs").select("guest_id").not("guest_id", "is", null),
    ]);

    const totalGuests = new Set((guestLogs ?? []).map((row) => row.guest_id).filter(Boolean)).size;

    const sumCost = (rows) =>
      Number((rows ?? []).reduce((sum, row) => sum + Number(row.cost ?? 0), 0).toFixed(2));

    json(res, 200, {
      success: true,
      data: {
        total_users: totalUsers ?? 0,
        total_guests: totalGuests,
        total_sessions: totalSessions ?? 0,
        total_cost: sumCost(allCosts),
        new_users_today: newUsersToday ?? 0,
        sessions_today: sessionsToday ?? 0,
        cost_today: sumCost(todayCosts),
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load dashboard summary",
    });
  }
}
