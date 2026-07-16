import { requireAdmin } from "../api/_lib/admin-auth.js";
import { getAdminSupabase } from "../api/_lib/admin-supabase.js";
import { setJsonCors, json } from "../api/_lib/http.js";

/**
 * Speaking-funnel summary for the admin dashboard (开口漏斗).
 * Aggregation happens in Postgres via the app_event_funnel() function
 * (see supabase/migrations/0011_app_events.sql), so this endpoint stays
 * cheap no matter how many raw events accumulate.
 */
const FUNNEL_STEPS = [
  { event: "app_open", label: "打开 App" },
  { event: "enter_session", label: "进入对话页" },
  { event: "ready_click", label: "点「我准备好了」" },
  { event: "first_utterance", label: "说出第一句" },
  { event: "session_complete", label: "完成会话" },
  { event: "report_view", label: "查看复盘报告" },
];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRange(query) {
  const dateFrom = typeof query.date_from === "string" ? query.date_from : "";
  const dateTo = typeof query.date_to === "string" ? query.date_to : "";
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
    json(res, 400, { success: false, error: "date_from and date_to (YYYY-MM-DD) are required" });
    return;
  }

  try {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase.rpc("app_event_funnel", {
      p_from: range.from,
      p_to: range.to,
    });

    if (error) {
      throw new Error(error.message);
    }

    const byEvent = new Map(
      (data ?? []).map((row) => [
        row.event_name,
        {
          actor_count: Number(row.actor_count ?? 0),
          event_count: Number(row.event_count ?? 0),
        },
      ]),
    );

    let previousActors = null;
    const steps = FUNNEL_STEPS.map(({ event, label }) => {
      const stats = byEvent.get(event) ?? { actor_count: 0, event_count: 0 };
      // app_open is a context event; the product funnel conversion starts at
      // enter_session → ready_click → first_utterance → session_complete → report_view.
      if (event === "enter_session") {
        previousActors = null;
      }
      const conversion =
        previousActors != null && previousActors > 0
          ? Number((stats.actor_count / previousActors).toFixed(4))
          : null;
      previousActors = stats.actor_count;
      byEvent.delete(event);
      return {
        event_name: event,
        label,
        actor_count: stats.actor_count,
        event_count: stats.event_count,
        conversion_from_prev: conversion,
      };
    });

    // Anything outside the main funnel (e.g. repractice_start) still shows up.
    const extraEvents = [...byEvent.entries()].map(([event, stats]) => ({
      event_name: event,
      label: event,
      actor_count: stats.actor_count,
      event_count: stats.event_count,
      conversion_from_prev: null,
    }));

    json(res, 200, { success: true, data: { steps, extra_events: extraEvents } });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load funnel summary",
    });
  }
}
