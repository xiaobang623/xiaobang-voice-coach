function readNumber(keys, fallback, { allowZero = false } = {}) {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const raw = process.env[key];
    if (raw == null || raw === "") {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0)) {
      return parsed;
    }
  }
  return fallback;
}

function readOptionalNumber(keys) {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const raw = process.env[key];
    if (raw == null || raw === "") {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function money(value) {
  return `¥${Number(value).toLocaleString("zh-CN", {
    maximumFractionDigits: 6,
  })}`;
}

function normalizeModelName(modelName) {
  return String(modelName ?? "").trim();
}

function deepseekRate(modelName) {
  const model = normalizeModelName(modelName) || "deepseek-chat";
  const per1MTokens = readNumber(
    [
      `DEEPSEEK_${model.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_COST_PER_1M_TOKENS`,
      "DEEPSEEK_COST_PER_1M_TOKENS",
    ],
    2,
  );

  return {
    api_provider: "deepseek",
    model_name: model,
    usage_kind: "tokens",
    unit: "tokens",
    per1MTokens,
    rate_hint: `${money(per1MTokens)}/百万 Token`,
  };
}

function doubaoRate(modelName) {
  const model = normalizeModelName(modelName) || "volc.speech.dialog";
  const modelEnvPrefix = `DOUBAO_${model.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const perMinute = readNumber(
    [`${modelEnvPrefix}_COST_PER_MINUTE`, "DOUBAO_SPEECH_DIALOG_COST_PER_MINUTE", "DOUBAO_COST_PER_MINUTE"],
    0.4,
  );
  const per1MTokens = readOptionalNumber([
    `${modelEnvPrefix}_COST_PER_1M_TOKENS`,
    "DOUBAO_SPEECH_DIALOG_COST_PER_1M_TOKENS",
    "DOUBAO_COST_PER_1M_TOKENS",
  ]);

  return {
    api_provider: "doubao",
    model_name: model,
    usage_kind: per1MTokens ? "tokens" : "duration",
    unit: per1MTokens ? "tokens_or_duration" : "duration",
    perMinute,
    per1MTokens,
    rate_hint: per1MTokens
      ? `${money(per1MTokens)}/百万 Token；无 Token 时 ${money(perMinute)}/分钟兜底`
      : `${money(perMinute)}/分钟`,
  };
}

const SILICONFLOW_MODEL_ALIASES = {
  "siliconflow-sensevoice": "FunAudioLLM/SenseVoiceSmall",
  "siliconflow-telespeech": "TeleAI/TeleSpeechASR",
  "siliconflow-cosyvoice": "FunAudioLLM/CosyVoice2-0.5B",
  "siliconflow-moss-ttsd": "fnlp/MOSS-TTSD-v0.5",
};

function siliconFlowRate(modelName) {
  const rawModel = normalizeModelName(modelName) || "siliconflow-cosyvoice";
  const model = SILICONFLOW_MODEL_ALIASES[rawModel] ?? rawModel;
  const envPrefix = `SILICONFLOW_${model.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

  const isAsr =
    rawModel === "siliconflow-sensevoice" ||
    rawModel === "siliconflow-telespeech" ||
    /sensevoice|telespeech|asr/i.test(model);

  const fallback = isAsr ? 0 : readNumber("SILICONFLOW_COST_PER_1K_CHARS", 0.05, { allowZero: true });
  const per1KChars = readNumber(
    [
      `${envPrefix}_COST_PER_1K_CHARS`,
      rawModel === "siliconflow-cosyvoice" ? "SILICONFLOW_COSYVOICE_COST_PER_1K_CHARS" : "",
      rawModel === "siliconflow-moss-ttsd" ? "SILICONFLOW_MOSS_TTSD_COST_PER_1K_CHARS" : "",
      "SILICONFLOW_COST_PER_1K_CHARS",
    ].filter(Boolean),
    fallback,
    { allowZero: true },
  );

  return {
    api_provider: "siliconflow",
    model_name: rawModel,
    canonical_model_name: model,
    usage_kind: "characters",
    unit: "characters",
    per1KChars,
    rate_hint: per1KChars > 0 ? `${money(per1KChars)}/千字符` : "免费 / 未计费",
  };
}

export function getModelCostRate(apiProvider, modelName) {
  if (apiProvider === "deepseek") {
    return deepseekRate(modelName);
  }
  if (apiProvider === "doubao") {
    return doubaoRate(modelName);
  }
  if (apiProvider === "siliconflow") {
    return siliconFlowRate(modelName);
  }
  return {
    api_provider: apiProvider,
    model_name: normalizeModelName(modelName),
    usage_kind: "tokens",
    unit: "tokens",
    rate_hint: "—",
  };
}

export function calculateCostForUsage({
  apiProvider,
  modelName,
  tokensUsed = 0,
  durationSeconds = null,
}) {
  const rate = getModelCostRate(apiProvider, modelName);

  if (apiProvider === "deepseek") {
    return Number((((tokensUsed ?? 0) / 1_000_000) * rate.per1MTokens).toFixed(6));
  }

  if (apiProvider === "doubao") {
    if (tokensUsed > 0 && rate.per1MTokens) {
      return Number(((tokensUsed / 1_000_000) * rate.per1MTokens).toFixed(6));
    }
    if (durationSeconds && durationSeconds > 0) {
      return Number((((durationSeconds / 60) * rate.perMinute)).toFixed(6));
    }
    return 0;
  }

  if (apiProvider === "siliconflow") {
    return Number((((tokensUsed ?? 0) / 1000) * rate.per1KChars).toFixed(6));
  }

  return 0;
}
