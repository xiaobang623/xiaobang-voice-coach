import { getAdminSupabase } from "./admin-supabase.js";

/**
 * Persist session + report using service role (guests cannot write via RLS).
 */
export async function persistSessionReportAdmin(input) {
  const { sessionId, userId, guestId, topic, transcript, durationSeconds, report } = input;

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

  if (existingReport?.id) {
    const { error: updateError } = await supabase
      .from("reports")
      .update({
        user_id: userId ?? null,
        guest_id: guestId ?? null,
        payload: report,
      })
      .eq("id", existingReport.id);

    if (updateError) {
      throw new Error(updateError.message);
    }
    return;
  }

  const { error: reportError } = await supabase.from("reports").insert({
    session_id: sessionId,
    user_id: userId ?? null,
    guest_id: guestId ?? null,
    payload: report,
  });

  if (reportError) {
    throw new Error(reportError.message);
  }
}
