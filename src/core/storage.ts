import type { ReportJSON } from "../types";
import { supabase } from "./supabaseClient";

export interface PersistSessionInput {
  /** Stable session id (same one sent to generateReport). */
  sessionId: string;
  /** Topic id or label; null for free talk. */
  topic: string | null;
  /** Full "User: … / Coach: …" transcript. */
  transcript: string;
  durationSeconds: number;
  /** The generated report to store alongside the session. */
  report: ReportJSON;
}

/**
 * Persist one finished conversation (session row + report row) for the current
 * user. Safe no-op when Supabase is unconfigured or nobody is signed in, so the
 * main flow never breaks if storage fails.
 */
export async function persistSessionReport(input: PersistSessionInput): Promise<void> {
  if (!supabase) {
    return;
  }

  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user?.id) {
    console.warn("[storage] no signed-in user, skipping persist");
    return;
  }
  if (user.is_anonymous) {
    return;
  }

  const userId = user.id;

  // 1. Upsert the session (id is stable, so a retry updates instead of dupes).
  const { error: sessionError } = await supabase.from("sessions").upsert(
    {
      id: input.sessionId,
      user_id: userId,
      topic: input.topic,
      transcript: input.transcript,
      duration_seconds: input.durationSeconds,
    },
    { onConflict: "id" },
  );

  if (sessionError) {
    console.warn("[storage] failed to save session:", sessionError.message);
    return;
  }

  // 2. Store the report payload, linked to the session.
  const { error: reportError } = await supabase.from("reports").insert({
    session_id: input.sessionId,
    user_id: userId,
    payload: input.report,
  });

  if (reportError) {
    console.warn("[storage] failed to save report:", reportError.message);
  }
}

/**
 * Load past reports for the current user, newest first. Returns [] when
 * unconfigured, signed out, or on error.
 */
export async function listSessionReports(): Promise<ReportJSON[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("reports")
    .select("payload, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[storage] failed to load reports:", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => row.payload as ReportJSON)
    .filter((payload): payload is ReportJSON => Boolean(payload && payload.sessionId));
}
