import type {
  Correction,
  GrowthPageData,
  GrowthStats,
  MemorySummary,
  ReportHistoryItem,
  ReportJSON,
  UserLevel,
  UserPreferences,
} from "../types";
import { normalizeUserPreferences } from "../config/preferences";
import { invalidateGrowthCache } from "./growthCache";
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

const VALID_LEVELS = new Set<UserLevel>(["beginner", "intermediate", "advanced"]);

function isRegisteredUser(user: { id: string; is_anonymous?: boolean } | null | undefined): user is {
  id: string;
  is_anonymous?: boolean;
} {
  return Boolean(user?.id && !user.is_anonymous);
}

/** Fast local session read — avoids a network round-trip per storage call. */
async function getRegisteredUserId(): Promise<string | null> {
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return isRegisteredUser(user) ? user.id : null;
}

function normalizeMemorySummary(raw: unknown): MemorySummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const userLevel = String(record.userLevel ?? "intermediate").toLowerCase();
  const topics = Array.isArray(record.topics)
    ? record.topics.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
    : [];
  const frequentMistakes = Array.isArray(record.frequentMistakes)
    ? record.frequentMistakes.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
    : [];
  const coachNotes = String(record.coachNotes ?? record.notes ?? "").trim();

  return {
    userLevel: VALID_LEVELS.has(userLevel as UserLevel) ? (userLevel as UserLevel) : "intermediate",
    topics,
    frequentMistakes,
    coachNotes: coachNotes.slice(0, 400),
    updatedAt: String(record.updatedAt ?? new Date().toISOString()),
  };
}

function toDayKey(iso: string): string {
  return iso.slice(0, 10);
}

function computeStreaks(dayKeys: string[]): { current: number; longest: number } {
  if (dayKeys.length === 0) {
    return { current: 0, longest: 0 };
  }

  const unique = [...new Set(dayKeys)].sort();
  let longest = 1;
  let run = 1;

  for (let index = 1; index < unique.length; index += 1) {
    const prev = new Date(`${unique[index - 1]}T00:00:00Z`);
    const curr = new Date(`${unique[index]}T00:00:00Z`);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
    if (diffDays === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const today = toDayKey(new Date().toISOString());
  const yesterday = toDayKey(new Date(Date.now() - 86_400_000).toISOString());
  const newest = unique[unique.length - 1];

  let current = 0;
  if (newest === today || newest === yesterday) {
    current = 1;
    for (let index = unique.length - 2; index >= 0; index -= 1) {
      const prev = new Date(`${unique[index]}T00:00:00Z`);
      const next = new Date(`${unique[index + 1]}T00:00:00Z`);
      const diffDays = Math.round((next.getTime() - prev.getTime()) / 86_400_000);
      if (diffDays === 1) {
        current += 1;
      } else {
        break;
      }
    }
  }

  return { current, longest };
}

function aggregateFrequentMistakes(corrections: Correction[]): GrowthStats["frequentMistakes"] {
  const bucket = new Map<string, GrowthStats["frequentMistakes"][number]>();

  for (const correction of corrections) {
    if (!correction.original || !correction.corrected) {
      continue;
    }
    const key = [
      correction.type,
      correction.original.toLowerCase().trim(),
      correction.corrected.toLowerCase().trim(),
    ].join("|");
    const existing = bucket.get(key);
    if (existing) {
      existing.count += correction.frequency ?? 1;
    } else {
      bucket.set(key, {
        original: correction.original.trim(),
        corrected: correction.corrected.trim(),
        type: correction.type,
        count: correction.frequency ?? 1,
      });
    }
  }

  return [...bucket.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
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

  const { data: auth } = await supabase.auth.getSession();
  const user = auth.session?.user;
  if (!isRegisteredUser(user)) {
    return;
  }

  const userId = user.id;

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

  const { error: reportError } = await supabase.from("reports").insert({
    session_id: input.sessionId,
    user_id: userId,
    payload: input.report,
  });

  if (reportError) {
    console.warn("[storage] failed to save report:", reportError.message);
    return;
  }

  invalidateGrowthCache();
}

/** Load the learner memory profile for the signed-in registered user. */
export async function loadUserMemory(): Promise<MemorySummary | null> {
  if (!supabase) {
    return null;
  }

  const userId = await getRegisteredUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("memory")
    .select("summary")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[storage] failed to load memory:", error.message);
    return null;
  }

  return normalizeMemorySummary(data?.summary);
}

/** Save the merged learner memory profile for the current registered user. */
export async function upsertUserMemory(summary: MemorySummary): Promise<void> {
  if (!supabase) {
    return;
  }

  const userId = await getRegisteredUserId();
  if (!userId) {
    return;
  }

  const { error } = await supabase.from("memory").upsert(
    {
      user_id: userId,
      summary,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.warn("[storage] failed to save memory:", error.message);
  }
}

/** Load practice defaults for the signed-in registered user. */
export async function loadUserPreferences(): Promise<UserPreferences | null> {
  const result = await loadUserPreferencesState();
  return result?.preferences ?? null;
}

/** Load preferences and whether the profile has never saved any. */
export async function loadUserPreferencesState(): Promise<{
  preferences: UserPreferences;
  isUnset: boolean;
} | null> {
  if (!supabase) {
    return null;
  }

  const userId = await getRegisteredUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[storage] failed to load preferences:", error.message);
    return null;
  }

  const raw = data?.preferences;
  const isUnset =
    raw == null || (typeof raw === "object" && Object.keys(raw as object).length === 0);

  return {
    preferences: normalizeUserPreferences(raw),
    isUnset,
  };
}

/** Persist practice defaults for the signed-in registered user. */
export async function saveUserPreferences(preferences: UserPreferences): Promise<void> {
  if (!supabase) {
    return;
  }

  const userId = await getRegisteredUserId();
  if (!userId) {
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, preferences }, { onConflict: "id" });

  if (error) {
    console.warn("[storage] failed to save preferences:", error.message);
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

interface ReportHistoryRow {
  created_at: string;
  session_id: string;
  payload: ReportJSON | null;
  sessions:
    | {
        topic: string | null;
        duration_seconds: number | null;
      }
    | {
        topic: string | null;
        duration_seconds: number | null;
      }[]
    | null;
}

const GROWTH_REPORT_LIMIT = 30;

function buildHistorySummaries(rows: ReportHistoryRow[]): ReportHistoryItem[] {
  const items: ReportHistoryItem[] = [];

  for (const row of rows) {
    const payload = row.payload;
    const sessionId = payload?.sessionId ?? row.session_id;
    if (!sessionId) {
      continue;
    }

    const sessionMeta = Array.isArray(row.sessions) ? row.sessions[0] : row.sessions;

    items.push({
      sessionId,
      createdAt: row.created_at || payload?.createdAt || new Date().toISOString(),
      topic: sessionMeta?.topic ?? null,
      durationSeconds: sessionMeta?.duration_seconds ?? payload?.durationSeconds ?? 0,
      userLevel: payload?.userLevel ?? "intermediate",
      correctionCount: payload?.corrections?.length ?? 0,
    });
  }

  return items;
}

function buildGrowthStats(
  sessions: Array<{ created_at: string; duration_seconds: number | null }>,
  reportRows: Array<{ payload: ReportJSON | null }>,
  memorySummary: unknown,
): GrowthStats {
  const dayKeys = sessions.map((row) => toDayKey(row.created_at));
  const streaks = computeStreaks(dayKeys);

  const allCorrections: Correction[] = [];
  for (const row of reportRows) {
    const payload = row.payload;
    if (payload?.corrections?.length) {
      allCorrections.push(...payload.corrections);
    }
  }

  const memory = normalizeMemorySummary(memorySummary);
  const latestReport = reportRows[0]?.payload ?? undefined;

  return {
    sessionCount: sessions.length,
    totalDurationSeconds: sessions.reduce((sum, row) => sum + (row.duration_seconds ?? 0), 0),
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    latestUserLevel: memory?.userLevel ?? latestReport?.userLevel ?? null,
    frequentMistakes: aggregateFrequentMistakes(allCorrections),
  };
}

/**
 * Single round-trip growth page load: one auth read + three parallel queries.
 * History rows omit full report payloads (loaded on expand).
 */
export async function loadGrowthPageData(): Promise<GrowthPageData | null> {
  if (!supabase) {
    return null;
  }

  const userId = await getRegisteredUserId();
  if (!userId) {
    return null;
  }

  const [sessionsResult, reportsResult, memoryResult] = await Promise.all([
    supabase.from("sessions").select("created_at, duration_seconds").order("created_at", { ascending: true }),
    supabase
      .from("reports")
      .select("created_at, session_id, payload, sessions(topic, duration_seconds)")
      .order("created_at", { ascending: false })
      .limit(GROWTH_REPORT_LIMIT),
    supabase.from("memory").select("summary").eq("user_id", userId).maybeSingle(),
  ]);

  if (sessionsResult.error) {
    console.warn("[storage] failed to load sessions:", sessionsResult.error.message);
    return null;
  }

  if (reportsResult.error) {
    console.warn("[storage] failed to load reports for growth:", reportsResult.error.message);
    return null;
  }

  const sessions = sessionsResult.data ?? [];
  const reportRows = (reportsResult.data ?? []) as ReportHistoryRow[];

  return {
    stats: buildGrowthStats(sessions, reportRows, memoryResult.data?.summary),
    history: buildHistorySummaries(reportRows),
  };
}

/** Fetch one report payload when the user expands a history row. */
export async function loadReportDetail(sessionId: string): Promise<ReportJSON | null> {
  if (!supabase) {
    return null;
  }

  const userId = await getRegisteredUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("reports")
    .select("payload")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.warn("[storage] failed to load report detail:", error.message);
    return null;
  }

  const payload = data?.payload as ReportJSON | undefined;
  return payload?.sessionId ? payload : null;
}
