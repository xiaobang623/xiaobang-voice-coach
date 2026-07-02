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
  };
}
