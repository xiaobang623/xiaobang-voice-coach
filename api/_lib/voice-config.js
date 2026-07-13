const CONFIG_CACHE_TTL_MS = 60_000;

export const DOUBAO_VOICE_OPTIONS = [
  { id: "zh_female_vv_jupiter_bigtts", label: "Vivi" },
  { id: "zh_female_xiaohe_jupiter_bigtts", label: "小何" },
  { id: "zh_male_yunzhou_jupiter_bigtts", label: "云舟（男）" },
  { id: "zh_male_xiaotian_jupiter_bigtts", label: "小天（男）" },
];

export const SILICONFLOW_VOICE_OPTIONS = [
  { id: "alex", label: "Alex" },
  { id: "benjamin", label: "Benjamin" },
  { id: "charles", label: "Charles" },
  { id: "david", label: "David" },
  { id: "anna", label: "Anna" },
  { id: "bella", label: "Bella" },
  { id: "claire", label: "Claire" },
  { id: "diana", label: "Diana" },
];

const FALLBACK_COSYVOICE_VOICE_OPTIONS = [{ id: "xiaobang_default", label: "默认音色" }];

export const DEFAULT_VOICE_CONFIG = {
  backend: "doubao",
  doubao: {
    dialogModel: "1.2.1.1",
  },
  selfhosted: {
    asrProvider: "siliconflow-sensevoice",
    platformNativeAsrLocale: "en-US",
    ttsProvider: "local-cosyvoice",
    siliconflowTtsVoice: "diana",
    whisperModel: "base",
    deepseekModel: "deepseek-chat",
    cosyvoiceModelKey: "cosyvoice2-0.5b",
  },
};

const configCache = {
  expiresAt: 0,
  rows: [],
  supabaseKey: null,
};

export function bustConfigCache() {
  configCache.expiresAt = 0;
  configCache.rows = [];
  configCache.supabaseKey = null;
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object") {
    return target;
  }

  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(result[key] ?? {}, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function getBackendValue(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  if (typeof row.backend === "string") {
    return row.backend;
  }
  if (typeof row.value === "string") {
    return row.value;
  }
  if (row.config && typeof row.config === "object" && typeof row.config.backend === "string") {
    return row.config.backend;
  }
  return null;
}

export function inferScopeType(row) {
  const explicit = row.scope_type ?? row.scope ?? row.level ?? row.kind;
  if (typeof explicit === "string") {
    return explicit.toLowerCase();
  }
  if (row.session_id || row.sessionId) {
    return "session";
  }
  if (row.user_id || row.userId || row.guest_id || row.guestId) {
    return "user";
  }
  return "global";
}

export function rowMatchesContext(row, context) {
  const scopeType = inferScopeType(row);
  if (scopeType === "session") {
    const rowSessionId = row.session_id ?? row.sessionId;
    return Boolean(context.sessionId && rowSessionId === context.sessionId);
  }
  if (scopeType === "user") {
    const rowUserId = row.user_id ?? row.userId;
    const rowGuestId = row.guest_id ?? row.guestId;
    if (rowUserId && context.userId) {
      return rowUserId === context.userId;
    }
    if (rowGuestId && context.guestId) {
      return rowGuestId === context.guestId;
    }
    return false;
  }
  return true;
}

function rowToPartialConfig(row) {
  const partial = {};
  const backend = getBackendValue(row);
  if (backend === "doubao" || backend === "selfhosted") {
    partial.backend = backend;
  }
  if (row.config && typeof row.config === "object") {
    const { backend: _ignored, ...rest } = row.config;
    return deepMerge(partial, rest);
  }
  return partial;
}

export function mergeVoiceConfig(rows, context) {
  const globalRow = rows.find((row) => inferScopeType(row) === "global");
  const userRow = rows.find((row) => inferScopeType(row) === "user" && rowMatchesContext(row, context));
  const sessionRow = rows.find(
    (row) => inferScopeType(row) === "session" && rowMatchesContext(row, context),
  );

  let merged = deepMerge({}, DEFAULT_VOICE_CONFIG);
  for (const row of [globalRow, userRow, sessionRow].filter(Boolean)) {
    merged = deepMerge(merged, rowToPartialConfig(row));
    const backend = getBackendValue(row);
    if (backend === "doubao" || backend === "selfhosted") {
      merged.backend = backend;
    }
  }

  if (merged.backend !== "doubao" && merged.backend !== "selfhosted") {
    merged.backend = DEFAULT_VOICE_CONFIG.backend;
  }

  return merged;
}

export function toModelOverrides(config) {
  return {
    doubaoDialogModel: config.doubao?.dialogModel,
    asrProvider: config.selfhosted?.asrProvider,
    platformNativeAsrLocale: config.selfhosted?.platformNativeAsrLocale,
    ttsProvider: config.selfhosted?.ttsProvider,
    siliconflowTtsVoice: config.selfhosted?.siliconflowTtsVoice,
    whisperModel: config.selfhosted?.whisperModel,
    deepseekModel: config.selfhosted?.deepseekModel,
    cosyvoiceModelKey: config.selfhosted?.cosyvoiceModelKey,
  };
}

export async function loadConfigRows(supabase) {
  const cacheKey = supabase ? "active" : "none";
  if (Date.now() < configCache.expiresAt && configCache.supabaseKey === cacheKey) {
    return configCache.rows;
  }

  if (!supabase) {
    configCache.rows = [];
    configCache.expiresAt = Date.now() + CONFIG_CACHE_TTL_MS;
    configCache.supabaseKey = cacheKey;
    return configCache.rows;
  }

  const { data, error } = await supabase.from("voice_backend_config").select("*").limit(200);
  if (error) {
    console.warn("[voice-config] failed to load voice_backend_config:", error.message);
    configCache.rows = [];
    configCache.expiresAt = Date.now() + CONFIG_CACHE_TTL_MS;
    configCache.supabaseKey = cacheKey;
    return configCache.rows;
  }

  configCache.rows = Array.isArray(data) ? data : [];
  configCache.expiresAt = Date.now() + CONFIG_CACHE_TTL_MS;
  configCache.supabaseKey = cacheKey;
  return configCache.rows;
}

async function fetchCosyVoiceSpeakers(baseUrl) {
  if (!baseUrl) {
    return { speakers: [], defaultVoice: FALLBACK_COSYVOICE_VOICE_OPTIONS[0].id };
  }

  let speakers = [];
  let defaultVoice = FALLBACK_COSYVOICE_VOICE_OPTIONS[0].id;

  try {
    const speakersResponse = await fetch(`${baseUrl}/speakers`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (speakersResponse.ok) {
      const payload = await speakersResponse.json();
      if (Array.isArray(payload.speakers)) {
        speakers = payload.speakers.filter((item) => typeof item === "string" && item.trim());
      }
    }
  } catch {
    // Fall back to static options below.
  }

  try {
    const healthResponse = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (healthResponse.ok) {
      const payload = await healthResponse.json();
      if (typeof payload.default_spk === "string" && payload.default_spk.trim()) {
        defaultVoice = payload.default_spk.trim();
      }
    }
  } catch {
    // Keep fallback default voice.
  }

  if (speakers.length === 0) {
    speakers = [defaultVoice];
  }

  if (!speakers.includes(defaultVoice)) {
    defaultVoice = speakers[0];
  }

  return { speakers, defaultVoice };
}

export async function buildVoiceProfile(config, registry = parseModelInstances()) {
  if (config.backend === "doubao") {
    return {
      provider: "doubao",
      defaultVoice: DOUBAO_VOICE_OPTIONS[0].id,
      voices: DOUBAO_VOICE_OPTIONS,
    };
  }

  const ttsProvider = config.selfhosted?.ttsProvider ?? DEFAULT_VOICE_CONFIG.selfhosted.ttsProvider;

  if (typeof ttsProvider === "string" && ttsProvider.startsWith("siliconflow-")) {
    const defaultVoice =
      config.selfhosted?.siliconflowTtsVoice ?? DEFAULT_VOICE_CONFIG.selfhosted.siliconflowTtsVoice;
    return {
      provider: ttsProvider,
      defaultVoice,
      voices: SILICONFLOW_VOICE_OPTIONS,
    };
  }

  const cosyvoiceKey =
    config.selfhosted?.cosyvoiceModelKey ?? DEFAULT_VOICE_CONFIG.selfhosted.cosyvoiceModelKey;
  const cosyvoiceBaseUrl = resolveInstanceUrl(
    registry,
    "cosyvoice",
    cosyvoiceKey,
    process.env.COSYVOICE_BASE_URL ?? "http://127.0.0.1:8001",
  );
  const { speakers, defaultVoice } = await fetchCosyVoiceSpeakers(cosyvoiceBaseUrl);

  return {
    provider: "local-cosyvoice",
    defaultVoice,
    voices: speakers.map((id) => ({ id, label: id })),
  };
}

export function configFromModelOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") {
    return { ...DEFAULT_VOICE_CONFIG, backend: "selfhosted" };
  }

  const selfhosted = {};
  for (const key of [
    "asrProvider",
    "platformNativeAsrLocale",
    "ttsProvider",
    "siliconflowTtsVoice",
    "whisperModel",
    "deepseekModel",
    "cosyvoiceModelKey",
  ]) {
    if (typeof overrides[key] === "string" && overrides[key].trim()) {
      selfhosted[key] = overrides[key].trim();
    }
  }

  return deepMerge(DEFAULT_VOICE_CONFIG, { backend: "selfhosted", selfhosted });
}

/** Session connect only needs merged config — skip voice profile / CosyVoice HTTP probes. */
export async function resolveSessionVoiceConfig(supabase, context = {}) {
  const rows = await loadConfigRows(supabase);
  const config = mergeVoiceConfig(rows, context);
  return {
    backend: config.backend,
    config,
    modelOverrides: toModelOverrides(config),
  };
}

export async function resolveVoiceConfig(supabase, context = {}) {
  const rows = await loadConfigRows(supabase);
  const config = mergeVoiceConfig(rows, context);
  const voiceProfile = await buildVoiceProfile(config);
  return {
    backend: config.backend,
    config,
    modelOverrides: toModelOverrides(config),
    voiceProfile,
    cachedAt: configCache.expiresAt - CONFIG_CACHE_TTL_MS,
  };
}

export function parseModelInstances() {
  const whisperFallback = process.env.WHISPER_BASE_URL ?? "http://127.0.0.1:8000";
  const cosyvoiceFallback = process.env.COSYVOICE_BASE_URL ?? "http://127.0.0.1:8001";
  const raw = process.env.VOICE_MODEL_INSTANCES;

  if (!raw) {
    return {
      whisper: { base: whisperFallback },
      cosyvoice: { "cosyvoice2-0.5b": cosyvoiceFallback },
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      whisper: parsed.whisper ?? { base: whisperFallback },
      cosyvoice: parsed.cosyvoice ?? { "cosyvoice2-0.5b": cosyvoiceFallback },
    };
  } catch {
    return {
      whisper: { base: whisperFallback },
      cosyvoice: { "cosyvoice2-0.5b": cosyvoiceFallback },
    };
  }
}

export function resolveInstanceUrl(registry, kind, key, fallbackUrl) {
  const map = registry?.[kind];
  if (map && key && typeof map[key] === "string") {
    return map[key];
  }
  if (fallbackUrl) {
    return fallbackUrl;
  }
  if (map) {
    const first = Object.values(map).find((value) => typeof value === "string");
    if (first) {
      return first;
    }
  }
  return null;
}

export function listInstanceKeys(registry) {
  return {
    whisper: Object.keys(registry.whisper ?? {}),
    cosyvoice: Object.keys(registry.cosyvoice ?? {}),
  };
}
