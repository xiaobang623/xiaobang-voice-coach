import { getModelCostRate } from "./cost-rates.js";

export const COST_PROVIDER_ORDER = ["doubao", "siliconflow", "deepseek"];

export const COST_PROVIDER_META = {
  doubao: {
    api_provider: "doubao",
    label: "豆包",
    short_label: "豆包",
    usage_kind: "duration",
    rate_hint() {
      return getModelCostRate("doubao", "volc.speech.dialog").rate_hint;
    },
  },
  siliconflow: {
    api_provider: "siliconflow",
    label: "硅谷云",
    short_label: "硅谷云",
    usage_kind: "characters",
    rate_hint() {
      return `CosyVoice ${getModelCostRate("siliconflow", "siliconflow-cosyvoice").rate_hint} · ASR 免费`;
    },
  },
  deepseek: {
    api_provider: "deepseek",
    label: "DeepSeek",
    short_label: "DeepSeek",
    usage_kind: "tokens",
    rate_hint() {
      return getModelCostRate("deepseek", "deepseek-chat").rate_hint;
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
      "platform-native-asr": "平台原生 ASR",
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

export function getModelRateHint(apiProvider, modelName) {
  return getModelCostRate(apiProvider, modelName).rate_hint;
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
    total_cost: roundCost(row.total_cost),
  };
}

export function roundCost(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Number(amount.toFixed(Math.abs(amount) < 1 ? 6 : 2));
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
