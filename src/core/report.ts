import type { ReportJSON } from "../types";
import type { VoiceSessionMessage } from "../hooks/useVoiceSession";

export interface GenerateReportInput {
  sessionId: string;
  transcript: string;
  durationSeconds: number;
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

export async function generateReport(input: GenerateReportInput): Promise<ReportJSON> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const useSupabase = Boolean(supabaseUrl && anonKey);
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
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: string; detail?: string };
      detail = payload.error ?? payload.detail ?? "";
    } catch {
      detail = await response.text();
    }
    if (!useSupabase && response.status === 404) {
      throw new Error("复盘服务没启动，请先运行 npm run report-server");
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
  };
}
