import { getAdminSupabase } from "./admin-supabase.js";

function deepseekCostPer1MTokens() {
  const raw = process.env.DEEPSEEK_COST_PER_1M_TOKENS;
  const parsed = raw ? Number(raw) : 2;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

function doubaoCostPerMinute() {
  const raw = process.env.DOUBAO_COST_PER_MINUTE;
  const parsed = raw ? Number(raw) : 0.4;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.4;
}

export function calculateDeepseekCost(tokensUsed) {
  const perMillion = deepseekCostPer1MTokens();
  return Number(((tokensUsed / 1_000_000) * perMillion).toFixed(6));
}

export function calculateDoubaoCost(durationSeconds) {
  const minutes = durationSeconds / 60;
  return Number((minutes * doubaoCostPerMinute()).toFixed(6));
}

export async function logTokenUsage({
  userId = null,
  guestId = null,
  apiProvider,
  modelName,
  tokensUsed = 0,
  durationSeconds = null,
  sessionId = null,
}) {
  if (!userId && !guestId) {
    return;
  }

  if (apiProvider === "deepseek" && (!tokensUsed || tokensUsed <= 0)) {
    return;
  }

  if (apiProvider === "doubao" && (!durationSeconds || durationSeconds <= 0)) {
    return;
  }

  try {
    const supabase = getAdminSupabase();
    let cost = 0;
    if (apiProvider === "deepseek") {
      cost = calculateDeepseekCost(tokensUsed);
    } else if (apiProvider === "doubao") {
      cost = calculateDoubaoCost(durationSeconds);
    }

    const { error } = await supabase.from("token_logs").insert({
      user_id: userId,
      guest_id: guestId,
      api_provider: apiProvider,
      model_name: modelName,
      tokens_used: apiProvider === "doubao" ? Math.max(1, Math.round(durationSeconds)) : tokensUsed,
      duration_seconds: durationSeconds,
      cost,
      session_id: sessionId,
    });

    if (error) {
      console.warn("[token_logs] insert failed:", error.message);
    }
  } catch (error) {
    console.warn("[token_logs] failed to write:", error instanceof Error ? error.message : error);
  }
}

export function extractDeepseekUsage(completion) {
  const usage = completion?.usage;
  if (!usage || typeof usage !== "object") {
    return 0;
  }

  const total = Number(usage.total_tokens);
  if (Number.isFinite(total) && total > 0) {
    return total;
  }

  const prompt = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  return prompt + completionTokens;
}
