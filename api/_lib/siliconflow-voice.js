export const SILICONFLOW_API_BASE =
  process.env.SILICONFLOW_API_BASE ?? "https://api.siliconflow.cn/v1";

/** Admin / config keys → SiliconFlow model IDs */
export const SILICONFLOW_ASR_PROVIDERS = {
  "siliconflow-sensevoice": "FunAudioLLM/SenseVoiceSmall",
  "siliconflow-telespeech": "TeleAI/TeleSpeechASR",
};

export const SILICONFLOW_TTS_PROVIDERS = {
  "siliconflow-cosyvoice": "FunAudioLLM/CosyVoice2-0.5B",
  "siliconflow-moss-ttsd": "fnlp/MOSS-TTSD-v0.5",
};

export const SILICONFLOW_TTS_VOICES = ["alex", "benjamin", "charles", "david", "anna", "bella", "claire", "diana"];

const DEFAULT_TTS_VOICE = {
  "siliconflow-cosyvoice": "diana",
  "siliconflow-moss-ttsd": "diana",
};

// Instruct 前缀会给每个 TTS 句子多付 ~110 字符的首包延迟（实测 +0.3~0.7s/句）——仅显式配置时启用。
const SILICONFLOW_TTS_INSTRUCT = process.env.SILICONFLOW_TTS_INSTRUCT?.trim() || null;

export function resolveSiliconFlowApiKey(envLocal = {}) {
  const key = process.env.SILICONFLOW_API_KEY ?? envLocal.SILICONFLOW_API_KEY;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export function isSiliconFlowAsrProvider(provider) {
  return provider in SILICONFLOW_ASR_PROVIDERS;
}

export function isSiliconFlowTtsProvider(provider) {
  return provider in SILICONFLOW_TTS_PROVIDERS;
}

export function buildSiliconFlowVoiceId(ttsProvider, voiceName) {
  const model = SILICONFLOW_TTS_PROVIDERS[ttsProvider];
  if (!model) {
    throw new Error(`未知 SiliconFlow TTS 提供方: ${ttsProvider}`);
  }
  const shortName = (voiceName || DEFAULT_TTS_VOICE[ttsProvider] || "alex").trim();
  return `${model}:${shortName}`;
}

export function formatMossTtsdInput(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^\[S\d]/.test(trimmed)) {
    return trimmed;
  }
  return `[S1]${trimmed}`;
}

function hasSiliconFlowInstruct(input) {
  return input.includes("<|endofprompt|>");
}

/** Prepend CosyVoice2 / MOSS-TTSD style instruct only when explicitly configured. */
export function formatSiliconFlowTtsInput(ttsProvider, input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  const body = ttsProvider === "siliconflow-moss-ttsd" ? formatMossTtsdInput(trimmed) : trimmed;
  if (!SILICONFLOW_TTS_INSTRUCT || hasSiliconFlowInstruct(body)) {
    return body;
  }

  const instruct = SILICONFLOW_TTS_INSTRUCT.endsWith("<|endofprompt|>")
    ? SILICONFLOW_TTS_INSTRUCT
    : `${SILICONFLOW_TTS_INSTRUCT}<|endofprompt|>`;

  return `${instruct}${body}`;
}

async function callSiliconFlowAsr({ apiKey, provider, wavBuffer, signal }) {
  const model = SILICONFLOW_ASR_PROVIDERS[provider];
  if (!model) {
    throw new Error(`未知 SiliconFlow ASR 提供方: ${provider}`);
  }
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY 未配置，无法使用 SiliconFlow ASR。");
  }

  const form = new FormData();
  form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "turn.wav");
  form.append("model", model);
  // 不传 language，让 SenseVoice / TeleSpeech 自动识别中英混合

  const startedAt = Date.now();
  const response = await fetch(`${SILICONFLOW_API_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`SiliconFlow ASR（${model}）失败: ${detail || response.status}`);
  }

  const payload = await response.json();
  return {
    text: String(payload.text ?? "").trim(),
    language: "unknown",
    segments: [],
    durationMs: Date.now() - startedAt,
    model,
    provider,
  };
}

/** Real user audio cancels any in-flight warmup so we never hit the API twice. */
export async function transcribeSiliconFlow({ apiKey, provider, wavBuffer, signal }) {
  abortSiliconFlowAsrWarmup();
  if (siliconFlowAsrWarmupPromise) {
    await siliconFlowAsrWarmupPromise.catch(() => {});
  }
  return callSiliconFlowAsr({ apiKey, provider, wavBuffer, signal });
}

export async function streamSiliconFlowSpeech({
  apiKey,
  ttsProvider,
  voice,
  input,
  speed = 0.85,
  sampleRate = 16000,
  signal,
  onChunk,
}) {
  const model = SILICONFLOW_TTS_PROVIDERS[ttsProvider];
  if (!model) {
    throw new Error(`未知 SiliconFlow TTS 提供方: ${ttsProvider}`);
  }
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY 未配置，无法使用 SiliconFlow TTS。");
  }

  const normalizedInput = formatSiliconFlowTtsInput(ttsProvider, input);

  const response = await fetch(`${SILICONFLOW_API_BASE}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: normalizedInput,
      voice: buildSiliconFlowVoiceId(ttsProvider, voice),
      stream: true,
      response_format: "pcm",
      sample_rate: sampleRate,
      speed,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`SiliconFlow TTS（${model}）失败: ${detail || response.status}`);
  }

  const reader = response.body.getReader();
  let isFirstChunk = true;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value?.byteLength) {
      continue;
    }
    const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (onChunk) {
      onChunk(chunk, { first: isFirstChunk });
    }
    isFirstChunk = false;
  }

  return { model, provider: ttsProvider };
}

export function siliconFlowConfigStatus(apiKey) {
  return {
    apiKeyConfigured: Boolean(apiKey),
    asr: Object.fromEntries(
      Object.entries(SILICONFLOW_ASR_PROVIDERS).map(([key, model]) => [
        key,
        { model, ok: Boolean(apiKey), detail: apiKey ? "api key configured" : "missing SILICONFLOW_API_KEY" },
      ]),
    ),
    tts: Object.fromEntries(
      Object.entries(SILICONFLOW_TTS_PROVIDERS).map(([key, model]) => [
        key,
        { model, ok: Boolean(apiKey), detail: apiKey ? "api key configured" : "missing SILICONFLOW_API_KEY" },
      ]),
    ),
  };
}

let siliconFlowAsrWarmupPromise = null;
let siliconFlowAsrWarmupAbort = null;
const siliconFlowAsrWarmedProviders = new Set();

function abortSiliconFlowAsrWarmup() {
  if (siliconFlowAsrWarmupAbort) {
    siliconFlowAsrWarmupAbort.abort();
    siliconFlowAsrWarmupAbort = null;
  }
}

/** Prime TLS + API route at server boot only — never race with a real user turn. */
export function warmupSiliconFlowAsr(apiKey, provider = "siliconflow-sensevoice") {
  if (!apiKey || !isSiliconFlowAsrProvider(provider)) {
    return Promise.resolve();
  }
  if (siliconFlowAsrWarmedProviders.has(provider)) {
    return Promise.resolve();
  }
  if (siliconFlowAsrWarmupPromise) {
    return siliconFlowAsrWarmupPromise;
  }

  const pcm = Buffer.alloc(16_000);
  const wav = buildSilentWav(pcm, 16000);
  siliconFlowAsrWarmupAbort = new AbortController();
  const timeoutSignal = AbortSignal.timeout(12_000);
  const signal = AbortSignal.any([siliconFlowAsrWarmupAbort.signal, timeoutSignal]);

  siliconFlowAsrWarmupPromise = callSiliconFlowAsr({
    apiKey,
    provider,
    wavBuffer: wav,
    signal,
  })
    .then(() => {
      siliconFlowAsrWarmedProviders.add(provider);
      console.log("[selfhosted-voice] siliconflow asr warmup ok");
    })
    .catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      console.warn(
        "[selfhosted-voice] siliconflow asr warmup failed:",
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      siliconFlowAsrWarmupPromise = null;
      siliconFlowAsrWarmupAbort = null;
    });

  return siliconFlowAsrWarmupPromise;
}

function buildSilentWav(pcmBuffer, sampleRate = 16000) {
  const channelCount = 1;
  const bitsPerSample = 16;
  const blockAlign = (channelCount * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);
  return buffer;
}
