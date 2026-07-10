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

function doubaoCostPer1MTokens() {
  const raw = process.env.DOUBAO_COST_PER_1M_TOKENS;
  const parsed = raw ? Number(raw) : null;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function siliconflowCostPer1KChars() {
  const raw = process.env.SILICONFLOW_COST_PER_1K_CHARS;
  const parsed = raw ? Number(raw) : 0.05;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.05;
}

export function calculateSiliconFlowCost(charactersUsed) {
  const per1k = siliconflowCostPer1KChars();
  if (!charactersUsed || charactersUsed <= 0 || per1k <= 0) {
    return 0;
  }
  return Number(((charactersUsed / 1000) * per1k).toFixed(6));
}

export function calculateDoubaoTokenCost(tokensUsed) {
  const perMillion = doubaoCostPer1MTokens();
  if (!perMillion) {
    return null;
  }
  return Number(((tokensUsed / 1_000_000) * perMillion).toFixed(6));
}

export function calculateDoubaoCostFromUsage({ tokensUsed = 0, durationSeconds = null }) {
  if (tokensUsed > 0) {
    const tokenCost = calculateDoubaoTokenCost(tokensUsed);
    if (tokenCost != null) {
      return tokenCost;
    }
  }
  if (durationSeconds && durationSeconds > 0) {
    return calculateDoubaoCost(durationSeconds);
  }
  return 0;
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

  if (
    apiProvider === "doubao" &&
    (!tokensUsed || tokensUsed <= 0) &&
    (!durationSeconds || durationSeconds <= 0)
  ) {
    return;
  }

  if (apiProvider === "siliconflow" && (!tokensUsed || tokensUsed <= 0)) {
    return;
  }

  try {
    const supabase = getAdminSupabase();

    if (sessionId) {
      const { data: existing } = await supabase
        .from("token_logs")
        .select("id")
        .eq("session_id", sessionId)
        .eq("api_provider", apiProvider)
        .maybeSingle();
      if (existing) {
        return;
      }
    }

    let cost = 0;
    let storedTokens = tokensUsed;
    if (apiProvider === "deepseek") {
      cost = calculateDeepseekCost(tokensUsed);
    } else if (apiProvider === "doubao") {
      cost = calculateDoubaoCostFromUsage({ tokensUsed, durationSeconds });
      storedTokens =
        tokensUsed > 0 ? tokensUsed : Math.max(1, Math.round(durationSeconds ?? 0));
    } else if (apiProvider === "siliconflow") {
      cost = calculateSiliconFlowCost(tokensUsed);
      storedTokens = Math.max(1, Math.round(tokensUsed));
    }

    const row = {
      user_id: userId,
      guest_id: guestId,
      api_provider: apiProvider,
      model_name: modelName,
      tokens_used: storedTokens,
      duration_seconds: durationSeconds,
      cost,
      session_id: sessionId,
    };

    let { error } = await supabase.from("token_logs").insert(row);

    if (error && sessionId && /foreign key|violates foreign key constraint/i.test(error.message)) {
      ({ error } = await supabase.from("token_logs").insert({ ...row, session_id: null }));
    }

    if (error) {
      console.warn("[token_logs] insert failed:", error.message, {
        apiProvider,
        userId,
        guestId,
        sessionId,
      });
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
