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

export const COST_PROVIDER_ORDER = ["doubao", "siliconflow", "deepseek"];

export const COST_PROVIDER_META = {
  doubao: {
    api_provider: "doubao",
    label: "豆包",
    short_label: "豆包",
    usage_kind: "duration",
    rate_hint() {
      const perMinute = doubaoCostPerMinute();
      const perMillion = doubaoCostPer1MTokens();
      if (perMillion) {
        return `¥${perMinute}/分钟 · 或 ¥${perMillion}/百万 Token`;
      }
      return `¥${perMinute}/分钟`;
    },
  },
  siliconflow: {
    api_provider: "siliconflow",
    label: "硅谷云",
    short_label: "硅谷云",
    usage_kind: "characters",
    rate_hint() {
      const per1k = siliconflowCostPer1KChars();
      return per1k > 0 ? `TTS ¥${per1k}/千字符 · ASR 免费` : "ASR 免费 · TTS 按量";
    },
  },
  deepseek: {
    api_provider: "deepseek",
    label: "DeepSeek",
    short_label: "DeepSeek",
    usage_kind: "tokens",
    rate_hint() {
      return `¥${deepseekCostPer1MTokens()}/百万 Token`;
    },
  },
};

export function normalizeCostProvider(apiProvider) {
  if (apiProvider === "doubao" || apiProvider === "siliconflow" || apiProvider === "deepseek") {
    return apiProvider;
  }
  return "other";
}

export function getCostProviderMeta(apiProvider) {
  const key = normalizeCostProvider(apiProvider);
  if (key === "other") {
    return {
      api_provider: apiProvider,
      label: apiProvider,
      short_label: apiProvider,
      usage_kind: "tokens",
      rate_hint: () => "—",
    };
  }
  return COST_PROVIDER_META[key];
}

export function formatModelDisplayName(apiProvider, modelName) {
  const provider = normalizeCostProvider(apiProvider);
  if (provider === "doubao") {
    if (modelName === "volc.speech.dialog") {
      return "实时语音对话";
    }
    return modelName || "实时语音";
  }
  if (provider === "deepseek") {
    if (modelName === "deepseek-chat") {
      return "文本对话 / 报告";
    }
    return modelName || "deepseek-chat";
  }
  if (provider === "siliconflow") {
    const map = {
      "siliconflow-sensevoice": "SenseVoice ASR",
      "siliconflow-telespeech": "TeleSpeech ASR",
      "siliconflow-cosyvoice": "CosyVoice TTS",
      "siliconflow-moss-ttsd": "MOSS-TTSD TTS",
      "FunAudioLLM/SenseVoiceSmall": "SenseVoice ASR",
      "TeleAI/TeleSpeechASR": "TeleSpeech ASR",
      "FunAudioLLM/CosyVoice2-0.5B": "CosyVoice TTS",
      "fnlp/MOSS-TTSD-v0.5": "MOSS-TTSD TTS",
    };
    return map[modelName] ?? modelName ?? "SiliconFlow";
  }
  return modelName || "—";
}

export function createEmptyProviderRow(apiProvider) {
  const meta = getCostProviderMeta(apiProvider);
  return {
    api_provider: meta.api_provider,
    label: meta.label,
    short_label: meta.short_label,
    usage_kind: meta.usage_kind,
    rate_hint: meta.rate_hint(),
    call_count: 0,
    total_tokens: 0,
    total_duration_seconds: 0,
    total_characters: 0,
    total_cost: 0,
  };
}

export function aggregateCostLog(row, log) {
  const tokens = Number(log.tokens_used ?? 0);
  const cost = Number(log.cost ?? 0);
  const durationSeconds = Number(log.duration_seconds ?? 0);
  const provider = normalizeCostProvider(log.api_provider);

  row.call_count += 1;
  row.total_cost += cost;

  if (provider === "doubao") {
    row.total_duration_seconds += durationSeconds > 0 ? durationSeconds : tokens;
    row.total_tokens += tokens;
    return;
  }

  if (provider === "siliconflow") {
    row.total_characters += tokens;
    return;
  }

  row.total_tokens += tokens;
}

export function finalizeProviderRow(row) {
  return {
    ...row,
    total_cost: Number(row.total_cost.toFixed(2)),
  };
}

export function buildCostByProvider(logs) {
  const map = new Map();

  for (const provider of COST_PROVIDER_ORDER) {
    map.set(provider, createEmptyProviderRow(provider));
  }

  for (const log of logs ?? []) {
    const key = normalizeCostProvider(log.api_provider);
    const row = map.get(key) ?? createEmptyProviderRow(key);
    aggregateCostLog(row, log);
    map.set(key, row);
  }

  return [...map.values()]
    .map(finalizeProviderRow)
    .filter((row) => row.call_count > 0 || COST_PROVIDER_ORDER.includes(row.api_provider))
    .sort((a, b) => {
      const orderA = COST_PROVIDER_ORDER.indexOf(a.api_provider);
      const orderB = COST_PROVIDER_ORDER.indexOf(b.api_provider);
      if (orderA !== -1 && orderB !== -1 && orderA !== orderB) {
        return orderA - orderB;
      }
      return b.total_cost - a.total_cost;
    });
}
