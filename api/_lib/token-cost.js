import { getAdminSupabase } from "./admin-supabase.js";

function deepseekCostPer1MTokens() {
  const raw = process.env.DEEPSEEK_COST_PER_1M_TOKENS;
  const parsed = raw ? Number(raw) : 2;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

export function calculateDeepseekCost(tokensUsed) {
  const perMillion = deepseekCostPer1MTokens();
  return Number(((tokensUsed / 1_000_000) * perMillion).toFixed(6));
}

export async function logTokenUsage({
  userId,
  apiProvider,
  modelName,
  tokensUsed,
  sessionId = null,
}) {
  if (!userId || !tokensUsed || tokensUsed <= 0) {
    return;
  }

  try {
    const supabase = getAdminSupabase();
    const cost = apiProvider === "deepseek" ? calculateDeepseekCost(tokensUsed) : 0;

    await supabase.from("token_logs").insert({
      user_id: userId,
      api_provider: apiProvider,
      model_name: modelName,
      tokens_used: tokensUsed,
      cost,
      session_id: sessionId,
    });
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
