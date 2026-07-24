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
    const [funnelResult, diagnosticsResult] = await Promise.all([
      supabase.rpc("app_event_funnel", {
        p_from: range.from,
        p_to: range.to,
      }),
      supabase.rpc("app_event_funnel_diagnostics", {
        p_from: range.from,
        p_to: range.to,
      }),
    ]);

    if (funnelResult.error) {
      throw new Error(funnelResult.error.message);
    }
    if (diagnosticsResult.error) {
      throw new Error(diagnosticsResult.error.message);
    }

    const data = funnelResult.data ?? [];

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

    const diagnosticsByName = new Map(
      (diagnosticsResult.data ?? []).map((row) => [
        row.metric_name,
        {
          actor_count: Number(row.actor_count ?? 0),
          event_count: Number(row.event_count ?? 0),
        },
      ]),
    );
    const enterActors = diagnosticsByName.get("enter_session")?.actor_count ?? 0;
    const firstUtteranceActors = diagnosticsByName.get("first_utterance")?.actor_count ?? 0;
    const reluctantRate =
      enterActors > 0 ? Number((1 - firstUtteranceActors / enterActors).toFixed(4)) : null;

    json(res, 200, {
      success: true,
      data: {
        steps,
        extra_events: extraEvents,
        diagnostics: {
          reluctant_open_rate: reluctantRate,
          enter_session_actors: enterActors,
          first_utterance_actors: firstUtteranceActors,
          abandon_reached_ready_actors:
            diagnosticsByName.get("session_abandon_ready")?.actor_count ?? 0,
          abandon_reached_ready_events:
            diagnosticsByName.get("session_abandon_ready")?.event_count ?? 0,
          abandon_not_ready_actors:
            diagnosticsByName.get("session_abandon_not_ready")?.actor_count ?? 0,
          abandon_not_ready_events:
            diagnosticsByName.get("session_abandon_not_ready")?.event_count ?? 0,
        },
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load funnel summary",
    });
  }
}
