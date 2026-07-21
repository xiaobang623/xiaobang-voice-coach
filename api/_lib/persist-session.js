import { getAdminSupabase } from "./admin-supabase.js";
import { buildReportSummary } from "./report-summary.js";

function isMissingSummaryColumnError(error) {
  return (
    error?.code === "42703" ||
    /column\s+reports\.summary\s+does\s+not\s+exist|summary.*does\s+not\s+exist|could\s+not\s+find.*summary.*column|schema\s+cache.*summary/i.test(
      error?.message ?? "",
    )
  );
}

/**
 * Persist session + report using service role (guests cannot write via RLS).
 */
export async function persistSessionReportAdmin(input) {
  const {
    sessionId,
    userId,
    guestId,
    topic,
    transcript,
    durationSeconds,
    userSpeakingSeconds,
    userTurns,
    report,
  } = input;

  if (!sessionId) {
    throw new Error("sessionId is required");
  }
  if (!userId && !guestId) {
    throw new Error("userId or guestId is required");
  }
  if (userId && guestId) {
    throw new Error("userId and guestId are mutually exclusive");
  }

  const supabase = getAdminSupabase();

  const { error: sessionError } = await supabase.from("sessions").upsert(
    {
      id: sessionId,
      user_id: userId ?? null,
      guest_id: guestId ?? null,
      topic: topic ?? null,
      transcript: transcript ?? "",
      duration_seconds: durationSeconds ?? null,
      user_speaking_seconds: userSpeakingSeconds ?? null,
      user_turns: userTurns ?? null,
    },
    { onConflict: "id" },
  );

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const { data: existingReport, error: existingError } = await supabase
    .from("reports")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const reportSummary = buildReportSummary({
    ...report,
    sessionId: report?.sessionId || sessionId,
  });

  if (existingReport?.id) {
    const { error: updateError } = await supabase
      .from("reports")
      .update({
        user_id: userId ?? null,
        guest_id: guestId ?? null,
        payload: report,
        summary: reportSummary,
      })
      .eq("id", existingReport.id);

    if (updateError) {
      if (isMissingSummaryColumnError(updateError)) {
        const { error: fallbackUpdateError } = await supabase
          .from("reports")
          .update({
            user_id: userId ?? null,
            guest_id: guestId ?? null,
            payload: report,
          })
          .eq("id", existingReport.id);

        if (!fallbackUpdateError) {
          return;
        }
        throw new Error(fallbackUpdateError.message);
      }
      throw new Error(updateError.message);
    }
    return;
  }

  const { error: reportError } = await supabase.from("reports").insert({
    session_id: sessionId,
    user_id: userId ?? null,
    guest_id: guestId ?? null,
    payload: report,
    summary: reportSummary,
  });

  if (reportError) {
    if (isMissingSummaryColumnError(reportError)) {
      const { error: fallbackReportError } = await supabase.from("reports").insert({
        session_id: sessionId,
        user_id: userId ?? null,
        guest_id: guestId ?? null,
        payload: report,
      });

      if (!fallbackReportError) {
        return;
      }
      throw new Error(fallbackReportError.message);
    }
    throw new Error(reportError.message);
  }
}
