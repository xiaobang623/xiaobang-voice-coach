import type { MemorySummary, ReportJSON } from "../types";

export interface ExtractMemoryInput {
  transcript: string;
  report: ReportJSON;
  previousSummary: MemorySummary | null;
  userId?: string;
  sessionId?: string;
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

export async function extractMemory(input: ExtractMemoryInput): Promise<MemorySummary> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const useSupabase =
    import.meta.env.VITE_USE_SUPABASE_FUNCTIONS === "true" && Boolean(supabaseUrl && anonKey);
  const endpoint = useSupabase
    ? `${supabaseUrl}/functions/v1/extract-memory`
    : "/api/extract-memory";

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
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await readResponseErrorDetail(response);
    if (!useSupabase && response.status === 404) {
      throw new Error("记忆提取服务未配置，请启动 report-server 或部署 Supabase Edge Function。");
    }
    throw new Error(detail || `记忆提取失败（${response.status}）`);
  }

  return (await response.json()) as MemorySummary;
}
