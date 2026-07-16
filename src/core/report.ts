import type { ExpressionPracticeContext, ExpressionPracticeSummary, ReportJSON } from "../types";
import type { VoiceSessionMessage } from "../hooks/useVoiceSession";



export interface GenerateExpressionPracticeSummaryInput {
  sessionId: string;
  targetExpressions: ExpressionPracticeContext["targetExpressions"];
  transcript: string;
  durationSeconds: number;
  userId?: string;
  guestId?: string;
}

export interface GenerateReportInput {
  sessionId: string;
  transcript: string;
  durationSeconds: number;
  userId?: string;
  guestId?: string;
  /** Task goals to judge when session is in task mode. */
  taskGoals?: Array<{ id: string; desc: string }>;
}

export function buildTranscriptFromMessages(messages: VoiceSessionMessage[]): string {
  return messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => `${message.role === "user" ? "User" : "Coach"}: ${message.text}`)
    .join("\n");
}

export function countUserSpeechStats(messages: VoiceSessionMessage[]): {
  wordCount: number;
  sentenceCount: number;
} {
  const userText = messages
    .filter((message) => message.role === "user" && message.isFinal)
    .map((message) => message.text)
    .join(" ");

  const wordCount = userText.trim() ? userText.trim().split(/\s+/).length : 0;
  const sentenceCount = messages.filter(
    (message) => message.role === "user" && message.isFinal && message.text.trim().length > 0,
  ).length;

  return { wordCount, sentenceCount };
}

async function readResponseErrorDetail(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) {
    return "";
  }
  try {
    const payload = JSON.parse(body) as { error?: string; detail?: string };
    return payload.error ?? payload.detail ?? body;
  } catch {
    return body;
  }
}

export async function generateReport(input: GenerateReportInput): Promise<ReportJSON> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Report generation defaults to /api/generate-report (local report-server in
  // dev, Vercel function in prod). Only route to the Supabase Edge Function when
  // explicitly opted in — merely *configuring* Supabase (for auth/storage) must
  // NOT hijack the report endpoint to an undeployed function.
  const useSupabase =
    import.meta.env.VITE_USE_SUPABASE_FUNCTIONS === "true" && Boolean(supabaseUrl && anonKey);
  const endpoint = useSupabase
    ? `${supabaseUrl}/functions/v1/generate-report`
    : "/api/generate-report";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (useSupabase && anonKey) {
    headers.Authorization = `Bearer ${anonKey}`;
    headers.apikey = anonKey;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await readResponseErrorDetail(response);
    if (!useSupabase && response.status === 404) {
      throw new Error("复盘服务未配置，请在 Vercel 设置 DEEPSEEK_API_KEY 或配置 Supabase。");
    }
    throw new Error(detail || `生成复盘失败（${response.status}）`);
  }

  const report = (await response.json()) as ReportJSON;
  return {
    ...report,
    sessionId: report.sessionId || input.sessionId,
    durationSeconds: report.durationSeconds ?? input.durationSeconds,
    userLevel: report.userLevel ?? "intermediate",
    corrections: Array.isArray(report.corrections) ? report.corrections : [],
    ...(Array.isArray(report.reusedExpressions)
      ? { reusedExpressions: report.reusedExpressions }
      : {}),
    ...(Array.isArray(report.taskResults) ? { taskResults: report.taskResults } : {}),
    ...(report.taskScore ? { taskScore: report.taskScore } : {}),
  };
}


export async function generateExpressionPracticeSummary(
  input: GenerateExpressionPracticeSummaryInput,
): Promise<ExpressionPracticeSummary> {
  const response = await fetch("/api/generate-expression-practice-summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await readResponseErrorDetail(response);
    throw new Error(detail || `生成复练小结失败（${response.status}）`);
  }

  const summary = (await response.json()) as ExpressionPracticeSummary;
  const targetTexts = input.targetExpressions.map((item) => item.text).filter(Boolean).slice(0, 3);
  return {
    sessionId: summary.sessionId || input.sessionId,
    createdAt: summary.createdAt || new Date().toISOString(),
    targetExpressions: Array.isArray(summary.targetExpressions) && summary.targetExpressions.length > 0
      ? summary.targetExpressions
      : targetTexts,
    attemptedExpressions: Array.isArray(summary.attemptedExpressions)
      ? summary.attemptedExpressions
      : targetTexts.map((target) => ({
          target,
          feedback: input.transcript.trim()
            ? `这次还没明显用到「${target}」。下次可以从一句更短的话开始。`
            : `这次开口内容还不够多，暂时没法判断「${target}」的使用情况。`,
        })),
    nextSuggestion: summary.nextSuggestion?.expression
      ? summary.nextSuggestion
      : {
          expression: targetTexts[0] ?? "",
          reason: input.transcript.trim()
            ? "下次优先挑一个表达接到自己的真实经历里。"
            : "这次内容偏短，下次可以先用它说一句自己的真实经历。",
        },
  };
}
