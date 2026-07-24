import { requireAdmin } from "../api/_lib/admin-auth.js";
import { getAdminSupabase } from "../api/_lib/admin-supabase.js";
import { setJsonCors, json } from "../api/_lib/http.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function defaultDateFrom(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseDateRange(query) {
  const dateFrom = typeof query.date_from === "string" ? query.date_from : defaultDateFrom(30);
  const dateTo = typeof query.date_to === "string" ? query.date_to : todayIsoDate();
  if (!ISO_DATE_PATTERN.test(dateFrom) || !ISO_DATE_PATTERN.test(dateTo)) {
    return null;
  }
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T23:59:59.999`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return null;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function normalizeNorthStarRow(row) {
  return {
    period: row.period === "previous" ? "previous" : "current",
    week_start: String(row.week_start ?? ""),
    speaking_actor_count: Number(row.speaking_actor_count ?? 0),
    total_speaking_seconds: Number(row.total_speaking_seconds ?? 0),
    avg_speaking_minutes: Number(row.avg_speaking_minutes ?? 0),
  };
}

function ratioChange(current, previous) {
  if (!Number.isFinite(previous) || previous <= 0) {
    return current > 0 ? null : 0;
  }
  return Number(((current - previous) / previous).toFixed(4));
}

function normalizeRetentionRow(row) {
  return {
    metric_name: row.metric_name === "seven_day" ? "seven_day" : "next_day",
    cohort_actors: Number(row.cohort_actors ?? 0),
    returned_actors: Number(row.returned_actors ?? 0),
    retention_rate:
      row.retention_rate === null || row.retention_rate === undefined
        ? null
        : Number(row.retention_rate),
  };
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
  const range = parseDateRange(req.query ?? {});
  if (!range) {
    json(res, 400, { success: false, error: "date_from/date_to must be YYYY-MM-DD" });
    return;
  }
  try {
    const supabase = getAdminSupabase();
    const [northStarResult, retentionResult] = await Promise.all([
      supabase.rpc("app_event_north_star"),
      supabase.rpc("app_event_retention", { p_from: range.from, p_to: range.to }),
    ]);
    if (northStarResult.error) {
      throw new Error(northStarResult.error.message);
    }
    if (retentionResult.error) {
      throw new Error(retentionResult.error.message);
    }
    const rows = (northStarResult.data ?? []).map(normalizeNorthStarRow);
    const current = rows.find((row) => row.period === "current") ?? normalizeNorthStarRow({ period: "current" });
    const previous = rows.find((row) => row.period === "previous") ?? normalizeNorthStarRow({ period: "previous" });
    json(res, 200, {
      success: true,
      data: {
        north_star: {
          current,
          previous,
          wow: {
            speaking_actor_count: ratioChange(current.speaking_actor_count, previous.speaking_actor_count),
            avg_speaking_minutes: ratioChange(current.avg_speaking_minutes, previous.avg_speaking_minutes),
          },
        },
        retention: (retentionResult.data ?? []).map(normalizeRetentionRow),
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load learning metrics",
    });
  }
}
