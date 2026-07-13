import { getAdminSupabase } from "./admin-supabase.js";
import { calculateCostForUsage, getModelCostRate } from "./cost-rates.js";

export function calculateSiliconFlowCost(charactersUsed) {
  const cost = calculateCostForUsage({
    apiProvider: "siliconflow",
    modelName: "siliconflow-cosyvoice",
    tokensUsed: charactersUsed,
  });
  if (!charactersUsed || charactersUsed <= 0 || cost <= 0) {
    return 0;
  }
  return cost;
}

export function calculateDoubaoTokenCost(tokensUsed) {
  const rate = getModelCostRate("doubao", "volc.speech.dialog");
  if (!rate.per1MTokens) {
    return null;
  }
  return calculateCostForUsage({
    apiProvider: "doubao",
    modelName: "volc.speech.dialog",
    tokensUsed,
  });
}

export function calculateDoubaoCostFromUsage({ tokensUsed = 0, durationSeconds = null }) {
  return calculateCostForUsage({
    apiProvider: "doubao",
    modelName: "volc.speech.dialog",
    tokensUsed,
    durationSeconds,
  });
}

export function calculateDeepseekCost(tokensUsed) {
  return calculateCostForUsage({
    apiProvider: "deepseek",
    modelName: "deepseek-chat",
    tokensUsed,
  });
}

export function calculateDoubaoCost(durationSeconds) {
  return calculateCostForUsage({
    apiProvider: "doubao",
    modelName: "volc.speech.dialog",
    durationSeconds,
  });
}

async function updateExistingDoubaoUsageIfMorePrecise(supabase, existing, row, incomingTokens) {
  const existingTokens = Number(existing.tokens_used ?? 0);
  const existingDuration = Number(existing.duration_seconds ?? 0);
  const existingLooksDurationOnly =
    existingDuration > 0 && (!existingTokens || existingTokens === Math.round(existingDuration));

  // Frontend logs a duration fallback before the proxy receives the final Doubao
  // usage frame. When the proxy later sends real token usage, replace the row so
  // the admin dashboard shows the more precise model usage instead of dropping it.
  if (incomingTokens > 0 && existingLooksDurationOnly) {
    const { error } = await supabase
      .from("token_logs")
      .update({
        model_name: row.model_name,
        tokens_used: row.tokens_used,
        duration_seconds: row.duration_seconds,
        cost: row.cost,
      })
      .eq("id", existing.id);

    if (error) {
      console.warn("[token_logs] failed to update doubao usage:", error.message);
    }
  }
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

    if (sessionId && apiProvider === "doubao") {
      const { data: existing } = await supabase
        .from("token_logs")
        .select("id, tokens_used, duration_seconds, cost")
        .eq("session_id", sessionId)
        .eq("api_provider", apiProvider)
        .maybeSingle();
      if (existing) {
        const cost = calculateCostForUsage({
          apiProvider,
          modelName,
          tokensUsed,
          durationSeconds,
        });
        const row = {
          model_name: modelName,
          tokens_used: tokensUsed > 0 ? tokensUsed : Math.max(1, Math.round(durationSeconds ?? 0)),
          duration_seconds: durationSeconds,
          cost,
        };
        await updateExistingDoubaoUsageIfMorePrecise(supabase, existing, row, tokensUsed);
        return;
      }
    }

    let cost = calculateCostForUsage({
      apiProvider,
      modelName,
      tokensUsed,
      durationSeconds,
    });
    let storedTokens = tokensUsed;
    if (apiProvider === "doubao") {
      storedTokens =
        tokensUsed > 0 ? tokensUsed : Math.max(1, Math.round(durationSeconds ?? 0));
    } else if (apiProvider === "siliconflow") {
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
