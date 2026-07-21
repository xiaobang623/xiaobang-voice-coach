import type {
  Correction,
  GrowthPageData,
  GrowthStats,
  MemoryEntry,
  MemorySummary,
  ReportHistoryItem,
  ReportJSON,
  TrackedExpression,
  TrackedExpressionSourceType,
  TrackedExpressionStatus,
  UserMemory,
  UserLevel,
  UserPreferences,
} from "../types";
import { normalizeUserPreferences } from "../config/preferences";
import { invalidateGrowthCache } from "./growthCache";
import { buildReportSummary, normalizeReportSummary } from "./reportSummary";
import type { ReportSummary, ReportSummaryCorrection } from "./reportSummary";
import { supabase } from "./supabaseClient";

export interface PersistSessionInput {
  /** Stable session id (same one sent to generateReport). */
  sessionId: string;
  /** Topic id or label; null for free talk. */
  topic: string | null;
  /** Full "User: … / Coach: …" transcript. */
  transcript: string;
  durationSeconds: number;
  userSpeakingSeconds?: number | null;
  userTurns?: number | null;
  /** The generated report to store alongside the session. */
  report: ReportJSON;
}

export interface PersistGuestSessionInput extends PersistSessionInput {
  guestId: string;
}

const VALID_LEVELS = new Set<UserLevel>(["beginner", "intermediate", "advanced"]);
const VALID_TRACKED_SOURCES = new Set<TrackedExpressionSourceType>([
  "correction",
  "sayBetter",
  "newExpression",
]);
const VALID_TRACKED_STATUSES = new Set<TrackedExpressionStatus>([
  "unmastered",
  "reviewing",
  "mastered",
]);

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
  const trackedExpressions = normalizeTrackedExpressions(record.trackedExpressions);
  const personalFacts = Array.isArray(record.personalFacts)
    ? record.personalFacts
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const coachNotes = String(record.coachNotes ?? record.notes ?? "").trim();

  return {
    userLevel: VALID_LEVELS.has(userLevel as UserLevel) ? (userLevel as UserLevel) : "intermediate",
    topics,
    frequentMistakes,
    trackedExpressions,
    personalFacts,
    coachNotes: coachNotes.slice(0, 400),
    updatedAt: String(record.updatedAt ?? new Date().toISOString()),
  };
}

function limitWords(value: string, maxWords: number): string {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function normalizeMemoryEntries(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: MemoryEntry[] = [];
  const seenSessionIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const sessionId = String(record.sessionId ?? "").trim();
    if (!sessionId || seenSessionIds.has(sessionId)) {
      continue;
    }

    const createdAt = String(record.createdAt ?? new Date().toISOString());
    result.push({
      sessionId,
      topic: limitWords(String(record.topic ?? "practice"), 6),
      highlights: limitWords(String(record.highlights ?? ""), 20),
      mistakes: limitWords(String(record.mistakes ?? ""), 20),
      storyNotes: limitWords(String(record.storyNotes ?? ""), 20),
      createdAt,
    });
    seenSessionIds.add(sessionId);
  }

  return result
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-20);
}

function normalizeUserMemory(summaryRaw: unknown, entriesRaw: unknown): UserMemory | null {
  const summary = normalizeMemorySummary(summaryRaw);
  if (!summary) {
    return null;
  }

  return {
    summary,
    entries: normalizeMemoryEntries(entriesRaw),
  };
}

function normalizeTrackedExpressions(raw: unknown): TrackedExpression[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: TrackedExpression[] = [];
  const seenTargets = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = String(record.id ?? "").trim();
    const sourceType = String(record.sourceType ?? "").trim() as TrackedExpressionSourceType;
    const targetText = String(record.targetText ?? "").trim();
    const targetKey = targetText.toLowerCase();
    if (!id || !targetText || !VALID_TRACKED_SOURCES.has(sourceType) || seenTargets.has(targetKey)) {
      continue;
    }

    const status = String(record.status ?? "").trim() as TrackedExpressionStatus;
    const firstSeenAt = String(record.firstSeenAt ?? record.lastSeenAt ?? new Date().toISOString());
    const lastSeenAt = String(record.lastSeenAt ?? firstSeenAt);
    const expression: TrackedExpression = {
      id,
      sourceType,
      originalText: String(record.originalText ?? "").trim(),
      targetText,
      category: String(record.category ?? "未分类").trim() || "未分类",
      status: VALID_TRACKED_STATUSES.has(status) ? status : "unmastered",
      firstSeenAt,
      lastSeenAt,
      reuseCount: Number.isFinite(Number(record.reuseCount))
        ? Math.max(0, Number(record.reuseCount))
        : 0,
    };

    if (typeof record.nextReviewAt === "string" && record.nextReviewAt.trim()) {
      expression.nextReviewAt = record.nextReviewAt.trim();
    }

    seenTargets.add(targetKey);
    result.push(expression);
  }

  return result;
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

function aggregateFrequentMistakes(
  corrections: Array<Pick<Correction, "original" | "corrected" | "type" | "frequency">>,
): GrowthStats["frequentMistakes"] {
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
      user_speaking_seconds: input.userSpeakingSeconds ?? null,
      user_turns: input.userTurns ?? null,
    },
    { onConflict: "id" },
  );

  if (sessionError) {
    console.warn("[storage] failed to save session:", sessionError.message);
    return;
  }

  const reportRow = {
    session_id: input.sessionId,
    user_id: userId,
    payload: input.report,
    summary: buildReportSummary({
      ...input.report,
      sessionId: input.report.sessionId || input.sessionId,
    }),
  };

  const { error: reportError } = await supabase.from("reports").insert(reportRow);

  if (reportError) {
    if (isMissingSummaryColumnError(reportError)) {
      const { error: fallbackReportError } = await supabase.from("reports").insert({
        session_id: input.sessionId,
        user_id: userId,
        payload: input.report,
      });
      if (!fallbackReportError) {
        console.warn("[storage] reports.summary column missing; saved report without summary");
        invalidateGrowthCache();
        return;
      }
      console.warn("[storage] failed to save report:", fallbackReportError.message);
      return;
    }

    console.warn("[storage] failed to save report:", reportError.message);
    return;
  }

  invalidateGrowthCache();
}

/** Persist a finished guest conversation via server API (service role). */
export async function persistGuestSessionReport(input: PersistGuestSessionInput): Promise<void> {
  try {
    const response = await fetch("/api/persist-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: input.sessionId,
        guestId: input.guestId,
        topic: input.topic,
        transcript: input.transcript,
        durationSeconds: input.durationSeconds,
        userSpeakingSeconds: input.userSpeakingSeconds ?? null,
        userTurns: input.userTurns ?? null,
        report: input.report,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn("[storage] failed to save guest session:", detail || response.status);
    }
  } catch (error) {
    console.warn(
      "[storage] failed to save guest session:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Load the learner memory profile for the signed-in registered user. */
export async function loadUserMemory(): Promise<UserMemory | null> {
  if (!supabase) {
    return null;
  }

  const userId = await getRegisteredUserId();
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("memory")
    .select("summary, entries")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[storage] failed to load memory:", error.message);
    return null;
  }

  return normalizeUserMemory(data?.summary, data?.entries);
}

/** Save the merged learner memory profile for the current registered user. */
export async function upsertUserMemory(memory: UserMemory): Promise<void> {
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
      summary: memory.summary,
      entries: memory.entries,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.warn("[storage] failed to save memory:", error.message);
    throw new Error(error.message);
  }

  invalidateGrowthCache();
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
  summary?: ReportSummary | Record<string, unknown> | null;
  payload?: ReportJSON | null;
  sessions:
    | {
        topic: string | null;
        duration_seconds: number | null;
        user_speaking_seconds: number | null;
        user_turns: number | null;
      }
    | {
        topic: string | null;
        duration_seconds: number | null;
        user_speaking_seconds: number | null;
        user_turns: number | null;
      }[]
    | null;
}

const GROWTH_REPORT_LIMIT = 30;

function isMissingSummaryColumnError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42703" ||
    /column\s+reports\.summary\s+does\s+not\s+exist|summary.*does\s+not\s+exist|could\s+not\s+find.*summary.*column|schema\s+cache.*summary/i.test(
      error.message ?? "",
    )
  );
}

async function loadGrowthReportRows(): Promise<{
  data: ReportHistoryRow[] | null;
  error: { code?: string; message: string } | null;
}> {
  if (!supabase) {
    return { data: [], error: null };
  }

  const summaryResult = await supabase
    .from("reports")
    .select(
      "created_at, session_id, summary, sessions(topic, duration_seconds, user_speaking_seconds, user_turns)",
    )
    .order("created_at", { ascending: false })
    .limit(GROWTH_REPORT_LIMIT);

  if (!summaryResult.error) {
    return { data: (summaryResult.data ?? []) as ReportHistoryRow[], error: null };
  }

  if (!isMissingSummaryColumnError(summaryResult.error)) {
    return { data: null, error: summaryResult.error };
  }

  // Deployment safety: if the frontend ships before migration 0013 is applied,
  // keep the page working by falling back to the legacy payload query.
  const fallbackResult = await supabase
    .from("reports")
    .select(
      "created_at, session_id, payload, sessions(topic, duration_seconds, user_speaking_seconds, user_turns)",
    )
    .order("created_at", { ascending: false })
    .limit(GROWTH_REPORT_LIMIT);

  if (fallbackResult.error) {
    return { data: null, error: fallbackResult.error };
  }

  console.warn("[storage] reports.summary column missing; growth page used legacy payload fallback");
  return { data: (fallbackResult.data ?? []) as ReportHistoryRow[], error: null };
}

function buildHistorySummaries(rows: ReportHistoryRow[]): ReportHistoryItem[] {
  const items: ReportHistoryItem[] = [];

  for (const row of rows) {
    const summary = normalizeReportSummary(row.summary) ??
      (row.payload ? buildReportSummary(row.payload, row.created_at) : null);
    const sessionId = summary?.sessionId || row.payload?.sessionId || row.session_id;
    if (!sessionId) {
      continue;
    }

    const sessionMeta = Array.isArray(row.sessions) ? row.sessions[0] : row.sessions;

    items.push({
      sessionId,
      createdAt: row.created_at || summary?.createdAt || row.payload?.createdAt || new Date().toISOString(),
      topic: sessionMeta?.topic ?? null,
      durationSeconds: sessionMeta?.duration_seconds ?? row.payload?.durationSeconds ?? 0,
      userSpeakingSeconds:
        sessionMeta?.user_speaking_seconds ?? row.payload?.userSpeakingSeconds ?? null,
      userTurns: sessionMeta?.user_turns ?? row.payload?.userTurns ?? null,
      userLevel: summary?.userLevel ?? row.payload?.userLevel ?? "intermediate",
      correctionCount: summary?.correctionCount ?? row.payload?.corrections?.length ?? 0,
    });
  }

  return items;
}

function buildGrowthStats(
  sessions: Array<{
    created_at: string;
    duration_seconds: number | null;
    user_speaking_seconds?: number | null;
  }>,
  reportRows: Array<{ summary?: ReportSummary | Record<string, unknown> | null; payload?: ReportJSON | null }>,
  memorySummary: MemorySummary | null,
): GrowthStats {
  const dayKeys = sessions.map((row) => toDayKey(row.created_at));
  const streaks = computeStreaks(dayKeys);
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartMs = weekStart.getTime();

  const allCorrections: ReportSummaryCorrection[] = [];
  for (const row of reportRows) {
    const summary = normalizeReportSummary(row.summary) ??
      (row.payload ? buildReportSummary(row.payload) : null);
    if (summary?.corrections?.length) {
      allCorrections.push(...summary.corrections);
    }
  }

  const latestSummary = normalizeReportSummary(reportRows[0]?.summary) ??
    (reportRows[0]?.payload ? buildReportSummary(reportRows[0].payload) : null);

  return {
    sessionCount: sessions.length,
    totalDurationSeconds: sessions.reduce((sum, row) => sum + (row.duration_seconds ?? 0), 0),
    weekSpeakingSeconds: sessions.reduce((sum, row) => {
      const createdAtMs = new Date(row.created_at).getTime();
      if (Number.isNaN(createdAtMs) || createdAtMs < weekStartMs) {
        return sum;
      }
      return sum + (row.user_speaking_seconds ?? 0);
    }, 0),
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    latestUserLevel: memorySummary?.userLevel ?? latestSummary?.userLevel ?? null,
    frequentMistakes: aggregateFrequentMistakes(allCorrections),
  };
}

/**
 * Count how often each topic id appears in the user's session history.
 * `sessions.topic` stores clean ids ("daily" / "travel" / task ids) or null
 * for free talk — null rows are skipped, no fuzzy matching needed.
 */
function countTopicFrequency(
  sessions: Array<{ topic?: string | null }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of sessions) {
    if (!row.topic) {
      continue;
    }
    counts[row.topic] = (counts[row.topic] ?? 0) + 1;
  }
  return counts;
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
    supabase
      .from("sessions")
      .select("created_at, duration_seconds, user_speaking_seconds, topic")
      .order("created_at", { ascending: true }),
    loadGrowthReportRows(),
    supabase.from("memory").select("summary, entries").eq("user_id", userId).maybeSingle(),
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
  const memory = normalizeUserMemory(memoryResult.data?.summary, memoryResult.data?.entries);

  return {
    stats: buildGrowthStats(sessions, reportRows, memory?.summary ?? null),
    history: buildHistorySummaries(reportRows),
    trackedExpressions: memory?.summary.trackedExpressions ?? [],
    memory,
    topicCounts: countTopicFrequency(sessions),
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
