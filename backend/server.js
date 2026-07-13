import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Agent as UndiciAgent, setGlobalDispatcher } from "undici";
import { createClient } from "@supabase/supabase-js";
import {
  configFromModelOverrides,
  parseModelInstances,
  resolveInstanceUrl,
  resolveSessionVoiceConfig,
  resolveVoiceConfig,
  SILICONFLOW_VOICE_OPTIONS,
  toModelOverrides,
} from "../api/_lib/voice-config.js";
import {
  isSiliconFlowAsrProvider,
  isSiliconFlowTtsProvider,
  resolveSiliconFlowApiKey,
  siliconFlowConfigStatus,
  streamSiliconFlowSpeech,
  transcribeSiliconFlow,
  warmupSiliconFlowAsr,
} from "../api/_lib/siliconflow-voice.js";
import { logTokenUsage } from "../api/_lib/token-cost.js";

// Keep HTTP connections to TTS/ASR/DeepSeek warm between turns — the default
// fetch agent drops idle sockets after ~4s, so every turn paid a fresh
// TCP(+TLS) handshake. Turns are usually more than 4s apart.
setGlobalDispatcher(
  new UndiciAgent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 300_000,
  }),
);

// Railway 等云平台注入 PORT；本地用 SELFHOSTED_VOICE_PORT 或默认 8081。
const PORT = Number(process.env.SELFHOSTED_VOICE_PORT || process.env.PORT || 8081);
const IS_CLOUD_BIND = Boolean(process.env.SELFHOSTED_VOICE_PORT || process.env.PORT);
const WS_PATH = "/ws";
const ENV_LOCAL_PATH = resolve(process.cwd(), ".env.local");
const WHISPER_BASE_URL = process.env.WHISPER_BASE_URL ?? "http://127.0.0.1:8000";
const COSYVOICE_BASE_URL = process.env.COSYVOICE_BASE_URL ?? "http://127.0.0.1:8001";
const OUTPUT_SAMPLE_RATE = 16000;
const DEFAULT_COSYVOICE_SPEED = 1.0;
const DEFAULT_SILICONFLOW_SPEED = 1.0;
const HEALTH_CHECK_TTL_MS = 10_000;
/** Cache synthesized PCM for short, repeated coach lines (keyed by provider+voice+speed+text). */
const TTS_CACHE_MAX_ENTRIES = 32;
const TTS_CACHE_MAX_TEXT_CHARS = 120;
/** Conversational fillers pre-synthesized at session start; double as a TTS warmup. */
const TTS_FILLER_TEXTS = ["Hmm.", "Okay.", "Right."];
/**
 * If no real audio has gone out this long after the user's turn, play a filler
 * to mask latency. Default 0 = disabled: with this chain's steady ~2s TTFB the
 * filler fired on every turn and read as a robotic tic that never matched the
 * subtitle text. Re-enable via env for experiments, e.g. TTS_FILLER_DELAY_MS=1800.
 */
const FILLER_DELAY_MS = Number(process.env.TTS_FILLER_DELAY_MS ?? 0);
/** Pad fillers with trailing silence so they clear the client prime buffer and land as a natural beat. */
const FILLER_TOTAL_MS = 1000;
/**
 * Cloud TTS warmup is disabled by default: SiliconFlow's first tiny warmup
 * request can spend several seconds cold-starting and compete with the user's
 * real first reply, making perceived opening latency worse. Enable only when
 * deliberately testing fillers or provider warmup behavior.
 */
const TTS_WARMUP_ENABLED = process.env.TTS_WARMUP_ENABLED === "true";
const PLATFORM_NATIVE_ASR_PROVIDER = "platform-native-asr";
const PLATFORM_NATIVE_ASR_AUDIO_FALLBACK_PROVIDER = "siliconflow-sensevoice";
const modelInstances = parseModelInstances();
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_COACH_PROMPT = [
  "You are Xiaobang Coach, a warm English speaking partner.",
  "Reply like a real live conversation, not a lesson or written explanation.",
  "Prefer one short spoken sentence under 15 words; use two only when necessary.",
  "Your job is to keep the learner talking: end almost every reply with exactly one short, easy follow-up question.",
  "Never reply with only a comment like 'That's great' — react briefly, then ask something concrete.",
  "If the learner gives a short answer, dig deeper: ask why, how, or for an example.",
  "When a topic runs dry, proactively suggest a new concrete angle or a related everyday topic instead of waiting.",
  "Do not use markdown, bullet points, emojis, stage directions, or grammar lectures.",
].join(" ");

function parseEnvLocalFile() {
  if (!existsSync(ENV_LOCAL_PATH)) {
    return {};
  }

  const file = readFileSync(ENV_LOCAL_PATH, "utf8");
  const entries = {};
  for (const rawLine of file.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    entries[key] = value;
  }
  return entries;
}

const envLocal = parseEnvLocalFile();

// 与 proxy.js 相同的 Origin 白名单：公网部署时设 ALLOWED_ORIGINS，避免任意站点消耗 DeepSeek/TTS 额度。
function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();

function isOriginAllowed(origin) {
  if (!origin) {
    return allowedOrigins.length === 0;
  }
  if (allowedOrigins.length === 0) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

const deepseekApiKey = process.env.DEEPSEEK_API_KEY ?? envLocal.DEEPSEEK_API_KEY;
const siliconflowApiKey = resolveSiliconFlowApiKey(envLocal);
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? envLocal.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  envLocal.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  envLocal.VITE_SUPABASE_ANON_KEY;

const supabaseClient =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const dependencyStatus = {
  whisper: { ok: false, checkedAt: 0, detail: "not checked yet" },
  cosyvoice: { ok: false, checkedAt: 0, detail: "not checked yet", sampleRate: null },
};

function createSessionUsageTracker() {
  return {
    deepseekTokens: 0,
    siliconflowChars: 0,
    siliconflowTtsProvider: null,
    logged: false,
  };
}

function estimateDeepseekTokens(text) {
  const chars = String(text ?? "").trim().length;
  if (chars <= 0) {
    return 0;
  }
  return Math.max(16, Math.ceil(chars / 2.5));
}

async function flushSessionUsage(connection) {
  const usage = connection.usage;
  const config = connection.config;
  if (!usage || usage.logged || !config) {
    return;
  }

  const hasActor = Boolean(config.userId || config.guestId);
  if (!hasActor) {
    return;
  }

  usage.logged = true;

  if (usage.deepseekTokens > 0) {
    await logTokenUsage({
      userId: config.userId ?? null,
      guestId: config.guestId ?? null,
      sessionId: config.sessionId ?? null,
      apiProvider: "deepseek",
      modelName: getDeepSeekModel(connection),
      tokensUsed: usage.deepseekTokens,
    });
  }

  if (usage.siliconflowChars > 0) {
    await logTokenUsage({
      userId: config.userId ?? null,
      guestId: config.guestId ?? null,
      sessionId: config.sessionId ?? null,
      apiProvider: "siliconflow",
      modelName: usage.siliconflowTtsProvider ?? getTtsProvider(connection),
      tokensUsed: usage.siliconflowChars,
    });
  }
}

function trackSiliconFlowTtsUsage(connection, text) {
  const provider = getTtsProvider(connection);
  if (!isSiliconFlowTtsProvider(provider)) {
    return;
  }
  const chars = String(text ?? "").trim().length;
  if (chars <= 0) {
    return;
  }
  connection.usage.siliconflowChars += chars;
  connection.usage.siliconflowTtsProvider = provider;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function emitSocketJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/** Batch PCM frames — low-latency first packet, then ~100ms steady chunks. */
function createPcmSocketBatcher(socket, flushBytes = 3200) {
  let pending = Buffer.alloc(0);
  let isFirst = true;
  const firstFlushBytes = 1280;

  const push = (pcmChunk) => {
    if (!pcmChunk?.byteLength || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    pending = Buffer.concat([pending, pcmChunk]);

    while (pending.length > 0) {
      if (isFirst) {
        if (pending.length < firstFlushBytes) {
          return;
        }
        socket.send(pending, { binary: true });
        pending = Buffer.alloc(0);
        isFirst = false;
        continue;
      }

      if (pending.length < flushBytes) {
        return;
      }
      socket.send(pending.subarray(0, flushBytes), { binary: true });
      pending = pending.subarray(flushBytes);
    }
  };

  const flush = () => {
    if (pending.length > 0 && socket.readyState === WebSocket.OPEN) {
      socket.send(pending, { binary: true });
      pending = Buffer.alloc(0);
    }
    isFirst = false;
  };

  return { push, flush };
}

/** Split assistant text into speakable units as DeepSeek streams (supports EN + CN punctuation). */
const SENTENCE_BOUNDARY_RE = /^([\s\S]*?[.!?。！？])(?:\s+|$)/u;

// 首句抢跑加强（07-11）：Coach 回复收紧到 15 词内后基本是一整句，等句号 = 等 DeepSeek 全文，
// 抢跑形同虚设（实测 tts-start 总在 deepseek-done 之后）。第一批不等句号：
// 攒到从句标点（逗号等）或足够长的词边界就先切一段去 TTS，把 SiliconFlow ~0.6-0.9s 的
// 首包成本提前到 DeepSeek 还在吐字的时候摊付。只影响本轮第一批，后续仍按整句/大批攒。
const EARLY_FIRST_CUT_MIN_CLAUSE_CHARS = 16; // 从句标点切分的最小段长
const EARLY_FIRST_CUT_MIN_WORD_CHARS = 36; // 无标点时按词边界切的最小段长
const CLAUSE_BOUNDARY_RE = /([,;:][)"'”’]?\s+|[，；：、][)"'”’]?)/g;

function findEarlyFirstCut(pending) {
  // 优先切在最后一个从句标点之后：标点留在前一段里，TTS 会读出自然停顿
  let clauseCut = -1;
  let match;
  CLAUSE_BOUNDARY_RE.lastIndex = 0;
  while ((match = CLAUSE_BOUNDARY_RE.exec(pending)) !== null) {
    clauseCut = match.index + match[0].length;
  }
  if (clauseCut >= EARLY_FIRST_CUT_MIN_CLAUSE_CHARS) {
    return clauseCut;
  }
  // 没有标点但已经很长：退而求其次切在词边界，避免半个单词进 TTS
  if (pending.length >= EARLY_FIRST_CUT_MIN_WORD_CHARS) {
    const wordCut = pending.lastIndexOf(" ");
    if (wordCut >= EARLY_FIRST_CUT_MIN_CLAUSE_CHARS) {
      return wordCut + 1;
    }
  }
  return -1;
}

function drainSpeakableUnits(text, fromIndex, minUnitLength = 2) {
  const units = [];
  let cursor = fromIndex;

  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    const match = remaining.match(SENTENCE_BOUNDARY_RE);
    if (!match) {
      break;
    }

    const unit = match[1].trim();
    cursor += match[0].length;
    if (unit.length < minUnitLength) {
      continue;
    }
    units.push(unit);
  }

  return { units, nextIndex: cursor };
}

/** Start TTS immediately; consumer reads PCM chunks in order as they arrive. */
function createPrefetchTtsStream(text, connection, timer) {
  const queue = [];
  let waiters = [];
  let done = false;
  let error = null;

  const notify = () => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) {
      resolve();
    }
  };

  const onChunk = (chunk) => {
    queue.push(Buffer.from(chunk));
    notify();
  };

  const synthPromise = synthesizeReplyCached(text, connection, timer, onChunk)
    .then(() => {
      done = true;
      notify();
    })
    .catch((cause) => {
      error = cause;
      done = true;
      notify();
    });

  async function* iterateChunks() {
    let index = 0;
    while (index < queue.length || !done) {
      while (index < queue.length) {
        yield queue[index];
        index += 1;
      }
      if (!done) {
        await new Promise((resolve) => {
          waiters.push(resolve);
        });
      }
    }
    if (error) {
      throw error;
    }
    await synthPromise;
  }

  return iterateChunks();
}

function createStreamingTtsQueue({ socket, connection, timer, isTurnCurrent, fillerGuard }) {
  const pcmBatcher = createPcmSocketBatcher(socket);
  let sendChain = Promise.resolve();
  let started = false;
  let sentAudio = false;
  let batchesStarted = 0;
  let pendingTtsText = "";

  const shouldSpeakBuffered = (text, force) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    if (force) {
      return true;
    }
    // 首句抢跑：第一批只要凑出一个像样的句子就立刻请求 TTS，让首包成本
    // 尽早开始摊付；太短的首句（"Great!"）先攒着，避免它播完时第二批还没就绪。
    if (batchesStarted === 0) {
      return trimmed.length >= 12;
    }
    // 每个 TTS 请求有 1~3s 固定首包成本，后续内容攒大批次减少句间空窗；
    // 第二批在首句播放期间并行预取，首包成本被首句播放时间盖住。
    return trimmed.length >= 160;
  };

  const startUnitStream = (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    batchesStarted += 1;
    const stream = createPrefetchTtsStream(trimmed, connection, timer);

    sendChain = sendChain.then(async () => {
      if (isTurnCurrent && !isTurnCurrent()) {
        return;
      }
      if (!started) {
        timer?.mark("tts-start-early", { chars: trimmed.length });
        started = true;
      }

      for await (const chunk of stream) {
        if (isTurnCurrent && !isTurnCurrent()) {
          return;
        }
        if (!sentAudio) {
          sentAudio = true;
          const lead = fillerGuard?.takeLead();
          if (lead) {
            pcmBatcher.push(lead);
          }
        }
        pcmBatcher.push(chunk);
      }
    });
  };

  const enqueue = (text) => {
    const piece = text.trim();
    if (!piece) {
      return;
    }

    pendingTtsText = pendingTtsText ? `${pendingTtsText} ${piece}` : piece;
    if (!shouldSpeakBuffered(pendingTtsText, false)) {
      return;
    }

    const batch = pendingTtsText;
    pendingTtsText = "";
    startUnitStream(batch);
  };

  // 首句抢跑加强：不等阈值/句号，立刻把已攒文本（含未说完的短句）作为一批发出去
  const enqueueNow = (text) => {
    const piece = text.trim();
    if (!piece) {
      return;
    }
    pendingTtsText = pendingTtsText ? `${pendingTtsText} ${piece}` : piece;
    const batch = pendingTtsText;
    pendingTtsText = "";
    startUnitStream(batch);
  };

  const flush = async () => {
    if (pendingTtsText.trim()) {
      const batch = pendingTtsText;
      pendingTtsText = "";
      startUnitStream(batch);
    }

    await sendChain;
    if (isTurnCurrent && !isTurnCurrent()) {
      return;
    }
    pcmBatcher.flush();
    timer?.mark("audio-sent");
  };

  return {
    enqueue,
    enqueueNow,
    flush,
    get started() { return started; },
    get batches() { return batchesStarted; },
  };
}

let turnCounter = 0;

function createTurnTimer(kind = "turn") {
  const id = ++turnCounter;
  const label = `${kind}#${id}`;
  const t0 = Date.now();
  let last = t0;
  const marks = [];

  return {
    mark(stage, extra) {
      const now = Date.now();
      const entry = { stage, totalMs: now - t0, stepMs: now - last, ...extra };
      marks.push(entry);
      last = now;
      const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
      console.log(
        `[selfhosted-voice][${label}] ${stage} total=${entry.totalMs}ms step=+${entry.stepMs}ms${suffix}`,
      );
    },
    finish(note = "summary") {
      const totalMs = Date.now() - t0;
      const timeline = marks.map((m) => `${m.stage}@${m.totalMs}ms`).join(" → ");
      console.log(`[selfhosted-voice][${label}] ${note} total=${totalMs}ms | ${timeline}`);
    },
  };
}

function getAsrProvider(connection) {
  const provider = connection?.voiceModelConfig?.selfhosted?.asrProvider ?? PLATFORM_NATIVE_ASR_AUDIO_FALLBACK_PROVIDER;
  // 平台原生 ASR 正常不会把音频发到后端；若浏览器不支持或异常回到音频链路，
  // 后端用 SenseVoiceSmall 兜底，避免 unknown provider 直接失败。
  return provider === PLATFORM_NATIVE_ASR_PROVIDER ? PLATFORM_NATIVE_ASR_AUDIO_FALLBACK_PROVIDER : provider;
}

function getTtsProvider(connection) {
  return connection?.voiceModelConfig?.selfhosted?.ttsProvider ?? "local-cosyvoice";
}

/**
 * Re-apply the client's explicit modelOverrides on top of a refreshed admin
 * config, so a session keeps the exact providers it said "ready" with
 * (voice consistency: greeting and later turns must use the same TTS).
 */
function mergeClientModelOverrides(resolvedConfig, overrides) {
  if (!overrides || typeof overrides !== "object") {
    return resolvedConfig;
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
  return {
    ...resolvedConfig,
    selfhosted: { ...resolvedConfig.selfhosted, ...selfhosted },
  };
}

function getSiliconFlowTtsVoice(connection) {
  const userVoice = connection?.config?.voiceType;
  const allowed = new Set(SILICONFLOW_VOICE_OPTIONS.map((voice) => voice.id));
  if (typeof userVoice === "string" && allowed.has(userVoice)) {
    return userVoice;
  }
  return connection?.voiceModelConfig?.selfhosted?.siliconflowTtsVoice ?? "diana";
}

function getLocalCosyVoiceSpkId(connection) {
  const userVoice = connection?.config?.voiceType;
  if (typeof userVoice === "string" && userVoice.trim()) {
    return userVoice.trim();
  }
  return undefined;
}

function getWhisperBaseUrl(connection) {
  const key = connection?.voiceModelConfig?.selfhosted?.whisperModel ?? "base";
  return resolveInstanceUrl(modelInstances, "whisper", key, WHISPER_BASE_URL);
}

function getCosyVoiceBaseUrl(connection) {
  const key = connection?.voiceModelConfig?.selfhosted?.cosyvoiceModelKey ?? "cosyvoice2-0.5b";
  return resolveInstanceUrl(modelInstances, "cosyvoice", key, COSYVOICE_BASE_URL);
}

function getDeepSeekModel(connection) {
  return connection?.voiceModelConfig?.selfhosted?.deepseekModel ?? "deepseek-chat";
}

async function fetchHealthJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function checkDependency(name, baseUrl, force = false) {
  const current = dependencyStatus[name];
  if (!force && Date.now() - current.checkedAt < HEALTH_CHECK_TTL_MS) {
    return current;
  }

  const url = `${baseUrl}/health`;
  try {
    const payload = await fetchHealthJson(url);
    const next = {
      ok: true,
      checkedAt: Date.now(),
      detail: "ok",
      ...(name === "cosyvoice" ? { sampleRate: Number(payload.sample_rate) || null } : {}),
    };
    dependencyStatus[name] = next;
    return next;
  } catch (error) {
    const next = {
      ...current,
      ok: false,
      checkedAt: Date.now(),
      detail: error instanceof Error ? error.message : String(error),
    };
    dependencyStatus[name] = next;
    return next;
  }
}

async function startupHealthCheck() {
  const [whisper, cosyvoice] = await Promise.all([
    checkDependency("whisper", WHISPER_BASE_URL, true),
    checkDependency("cosyvoice", COSYVOICE_BASE_URL, true),
  ]);

  if (!whisper.ok) {
    console.warn("[selfhosted-voice] whisper health check failed:", whisper.detail);
  } else {
    console.log("[selfhosted-voice] whisper ready");
  }

  if (!cosyvoice.ok) {
    console.warn("[selfhosted-voice] cosyvoice health check failed:", cosyvoice.detail);
  } else {
    console.log(
      `[selfhosted-voice] cosyvoice ready (sample_rate=${cosyvoice.sampleRate ?? "unknown"})`,
    );
  }

  if (siliconflowApiKey) {
    console.log("[selfhosted-voice] siliconflow api key configured");
    void warmupSiliconFlowAsr(siliconflowApiKey);
  } else {
    console.warn("[selfhosted-voice] SILICONFLOW_API_KEY not set — cloud ASR/TTS providers unavailable");
  }
}

function pcm16ToWavBuffer(pcmBuffer, sampleRate = 16000, channelCount = 1) {
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

async function transcribeWithLocalWhisper(wavBuffer, pcmBuffer, timer, connection) {
  const whisperBaseUrl = getWhisperBaseUrl(connection);
  if (!whisperBaseUrl) {
    throw new Error("未找到 Whisper 实例配置，请检查 VOICE_MODEL_INSTANCES。");
  }

  timer?.mark("asr-start", { provider: "local-whisper", audioBytes: pcmBuffer.length });

  const form = new FormData();
  form.append("audio", new Blob([wavBuffer], { type: "audio/wav" }), "turn.wav");

  const response = await fetch(`${whisperBaseUrl}/transcribe`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whisper 转录失败: ${detail || response.status}`);
  }

  const payload = await response.json();
  timer?.mark("asr-done", {
    provider: "local-whisper",
    asrMs: payload.duration_ms ?? null,
    language: payload.language ?? "unknown",
    chars: String(payload.text ?? "").length,
  });

  return {
    text: String(payload.text ?? "").trim(),
    language: String(payload.language ?? "unknown"),
    segments: Array.isArray(payload.segments) ? payload.segments : [],
  };
}

async function transcribeWithSiliconFlow(wavBuffer, pcmBuffer, timer, connection) {
  const provider = getAsrProvider(connection);
  timer?.mark("asr-start", { provider, audioBytes: pcmBuffer.length });

  const result = await transcribeSiliconFlow({
    apiKey: siliconflowApiKey,
    provider,
    wavBuffer,
    signal: AbortSignal.timeout(60_000),
  });

  timer?.mark("asr-done", {
    provider,
    asrMs: result.durationMs ?? null,
    model: result.model,
    chars: result.text.length,
  });

  return {
    text: result.text,
    language: result.language,
    segments: result.segments,
  };
}

async function transcribeTurn(pcmChunks, timer, connection) {
  const pcmBuffer = Buffer.concat(pcmChunks);
  if (pcmBuffer.length === 0) {
    return { text: "", language: "unknown", segments: [] };
  }

  // < ~0.25s @ 16kHz mono — skip short noise that wastes a cloud ASR round-trip
  if (pcmBuffer.length < 8000) {
    timer?.mark("asr-skipped-short", { audioBytes: pcmBuffer.length });
    return { text: "", language: "unknown", segments: [] };
  }

  const wavBuffer = pcm16ToWavBuffer(pcmBuffer, 16000, 1);
  const provider = getAsrProvider(connection);

  if (provider === "local-whisper") {
    return transcribeWithLocalWhisper(wavBuffer, pcmBuffer, timer, connection);
  }

  if (isSiliconFlowAsrProvider(provider)) {
    return transcribeWithSiliconFlow(wavBuffer, pcmBuffer, timer, connection);
  }

  throw new Error(`未知 ASR 提供方「${provider}」，请在管理后台重新选择。`);
}

function createConversationState(config) {
  return [
    {
      role: "system",
      content: config.systemPrompt?.trim() || DEFAULT_COACH_PROMPT,
    },
  ];
}


function compactMessagesForRealtime(messages) {
  if (!Array.isArray(messages) || messages.length <= 9) {
    return messages;
  }
  const [systemMessage, ...turns] = messages;
  return [systemMessage, ...turns.slice(-8)];
}


function parseDeepSeekErrorDetail(detail) {
  const raw = String(detail ?? "").trim();
  if (!raw) {
    return { raw: "", code: "", message: "" };
  }

  try {
    const payload = JSON.parse(raw);
    const error = payload?.error ?? payload;
    return {
      raw,
      code: String(error?.code ?? payload?.code ?? ""),
      message: String(error?.message ?? payload?.message ?? raw),
    };
  } catch {
    return { raw, code: "", message: raw };
  }
}

function createDeepSeekRequestError(detail, status) {
  const parsed = parseDeepSeekErrorDetail(detail);
  const haystack = `${parsed.code} ${parsed.message} ${parsed.raw}`.toLowerCase();
  const isRateLimit = status === 429 || haystack.includes("rate_limit") || haystack.includes("rate limit") || haystack.includes("session limit");
  const isAuth = status === 401 || status === 403 || haystack.includes("invalid api key") || haystack.includes("authentication");

  const userMessage = isRateLimit
    ? "DeepSeek 当前触发限流 / 会话额度上限，请稍等到页面提示的重置时间后再试，或到 DeepSeek 控制台检查余额。"
    : isAuth
      ? "DeepSeek API Key 校验失败，请检查 Railway 环境变量 DEEPSEEK_API_KEY 是否与平台一致。"
      : `DeepSeek 对话失败（HTTP ${status}）：${parsed.message || parsed.raw || "未知错误"}`;

  const error = new Error(userMessage);
  error.code = isRateLimit ? "deepseek_rate_limit" : isAuth ? "deepseek_auth_error" : "deepseek_request_failed";
  error.status = status;
  error.detail = parsed.raw;
  return error;
}

async function* streamDeepSeekReply(messages, connection) {
  if (!deepseekApiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置，无法使用 self-hosted 对话链路。");
  }

  const model = getDeepSeekModel(connection);
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deepseekApiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.7,
      max_tokens: 60,
      messages,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw createDeepSeekRequestError(detail, response.status);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      for (const rawLine of frame.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) {
          continue;
        }
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        const text = payload?.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text.length > 0) {
          yield text;
        }
      }
    }
  }
}

async function resampleWavToPcm16(wavBuffer) {
  return new Promise((resolvePromise, rejectPromise) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "1",
      "-ar",
      String(OUTPUT_SAMPLE_RATE),
      "pipe:1",
    ]);

    const stdoutChunks = [];
    const stderrChunks = [];
    ffmpeg.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    ffmpeg.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    ffmpeg.on("error", rejectPromise);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdoutChunks));
        return;
      }
      rejectPromise(new Error(Buffer.concat(stderrChunks).toString("utf8") || `ffmpeg exited ${code}`));
    });

    ffmpeg.stdin.end(wavBuffer);
  });
}

function mapCosyVoiceSpeed(speedRatio) {
  if (typeof speedRatio !== "number" || !Number.isFinite(speedRatio)) {
    return DEFAULT_COSYVOICE_SPEED;
  }
  // 2026-07-11 用户反馈基础语速偏慢：取消旧的 0.85 折算，UI 预设 1:1 映射（正常=1.0）。
  return Math.min(1.3, Math.max(0.8, speedRatio));
}

function mapSiliconFlowSpeed(speedRatio) {
  if (typeof speedRatio !== "number" || !Number.isFinite(speedRatio)) {
    return DEFAULT_SILICONFLOW_SPEED;
  }
  // 2026-07-11 用户反馈基础语速偏慢：取消旧的 0.82 折算，UI 预设 1:1 映射（正常=1.0）。
  return Math.min(1.3, Math.max(0.8, speedRatio));
}

async function synthesizeWithLocalCosyVoice(text, connection, timer, onPcmChunk) {
  const cosyvoiceBaseUrl = getCosyVoiceBaseUrl(connection);
  if (!cosyvoiceBaseUrl) {
    throw new Error("未找到 CosyVoice 实例配置，请检查 VOICE_MODEL_INSTANCES。");
  }

  const cosyStatus = await checkDependency("cosyvoice", cosyvoiceBaseUrl);
  if (!cosyStatus.ok) {
    const modelKey = connection?.voiceModelConfig?.selfhosted?.cosyvoiceModelKey ?? "cosyvoice2-0.5b";
    throw new Error(`CosyVoice 实例「${modelKey}」不可用，请启动对应服务后再试。`);
  }

  const config = connection.config;
  timer?.mark("tts-start", { provider: "local-cosyvoice", chars: text.length });

  const form = new FormData();
  form.append("text", text);
  form.append("mode", "sft");
  form.append("stream", "true");
  form.append("output_format", "pcm");
  form.append("speed", String(mapCosyVoiceSpeed(config.speedRatio)));
  const spkId = getLocalCosyVoiceSpkId(connection);
  if (spkId) {
    form.append("spk_id", spkId);
  }

  const response = await fetch(`${cosyvoiceBaseUrl}/synthesize`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`CosyVoice 合成失败: ${detail || response.status}`);
  }

  const pcmChunks = [];
  const reader = response.body.getReader();
  let sentFirstChunk = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value?.byteLength) {
      continue;
    }
    if (!sentFirstChunk) {
      timer?.mark("tts-first-chunk", { provider: "local-cosyvoice" });
      sentFirstChunk = true;
    }
    const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (onPcmChunk) {
      onPcmChunk(chunk);
    } else {
      pcmChunks.push(chunk);
    }
  }

  if (onPcmChunk) {
    timer?.mark("tts-done", { provider: "local-cosyvoice" });
    return null;
  }

  const pcmBuffer = Buffer.concat(pcmChunks);
  timer?.mark("tts-done", { provider: "local-cosyvoice", audioBytes: pcmBuffer.length });
  return pcmBuffer;
}

async function synthesizeWithSiliconFlow(text, connection, timer, onPcmChunk) {
  const ttsProvider = getTtsProvider(connection);
  const config = connection.config;
  timer?.mark("tts-start", { provider: ttsProvider, chars: text.length });
  trackSiliconFlowTtsUsage(connection, text);

  const pcmChunks = [];
  await streamSiliconFlowSpeech({
    apiKey: siliconflowApiKey,
    ttsProvider,
    voice: getSiliconFlowTtsVoice(connection),
    input: text,
    speed: mapSiliconFlowSpeed(config.speedRatio),
    sampleRate: OUTPUT_SAMPLE_RATE,
    signal: AbortSignal.timeout(180_000),
    onChunk: (chunk, meta) => {
      if (meta.first) {
        timer?.mark("tts-first-chunk", { provider: ttsProvider });
      }
      if (onPcmChunk) {
        onPcmChunk(chunk);
      } else {
        pcmChunks.push(chunk);
      }
    },
  });

  if (onPcmChunk) {
    timer?.mark("tts-done", { provider: ttsProvider });
    return null;
  }

  const pcmBuffer = Buffer.concat(pcmChunks);
  timer?.mark("tts-done", { provider: ttsProvider, audioBytes: pcmBuffer.length });
  return pcmBuffer;
}

async function synthesizeReply(text, connection, timer, onPcmChunk) {
  const provider = getTtsProvider(connection);

  if (provider === "local-cosyvoice") {
    return synthesizeWithLocalCosyVoice(text, connection, timer, onPcmChunk);
  }

  if (isSiliconFlowTtsProvider(provider)) {
    return synthesizeWithSiliconFlow(text, connection, timer, onPcmChunk);
  }

  throw new Error(`未知 TTS 提供方「${provider}」，请在管理后台重新选择。`);
}

// ---------------------------------------------------------------------------
// TTS PCM cache + fillers
// ---------------------------------------------------------------------------

/** insertion-ordered Map used as a tiny LRU: text -> PCM Buffer */
const ttsPcmCache = new Map();

function ttsCacheKey(connection, text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > TTS_CACHE_MAX_TEXT_CHARS) {
    return null;
  }
  const provider = getTtsProvider(connection);
  const speedRatio = connection?.config?.speedRatio;
  if (provider === "local-cosyvoice") {
    const voice = getLocalCosyVoiceSpkId(connection) ?? "default";
    return `${provider}|${getCosyVoiceBaseUrl(connection)}|${voice}|${mapCosyVoiceSpeed(speedRatio)}|${trimmed}`;
  }
  if (isSiliconFlowTtsProvider(provider)) {
    return `${provider}|${getSiliconFlowTtsVoice(connection)}|${mapSiliconFlowSpeed(speedRatio)}|${trimmed}`;
  }
  return null;
}

function ttsCacheStore(key, buffer) {
  if (!key || !buffer?.length) {
    return;
  }
  ttsPcmCache.delete(key);
  ttsPcmCache.set(key, buffer);
  while (ttsPcmCache.size > TTS_CACHE_MAX_ENTRIES) {
    ttsPcmCache.delete(ttsPcmCache.keys().next().value);
  }
}

/**
 * synthesizeReply with a read-through PCM cache. Short repeated lines
 * ("Great!", greetings, fillers) skip the 1~3s TTS first-packet cost entirely.
 */
async function synthesizeReplyCached(text, connection, timer, onPcmChunk) {
  const key = ttsCacheKey(connection, text);
  if (key) {
    const hit = ttsPcmCache.get(key);
    if (hit) {
      ttsPcmCache.delete(key);
      ttsPcmCache.set(key, hit);
      timer?.mark("tts-cache-hit", { chars: text.trim().length, audioBytes: hit.length });
      if (onPcmChunk) {
        onPcmChunk(hit);
        return null;
      }
      return hit;
    }
  }

  if (!key) {
    return synthesizeReply(text, connection, timer, onPcmChunk);
  }

  if (!onPcmChunk) {
    const buffer = await synthesizeReply(text, connection, timer, null);
    ttsCacheStore(key, buffer);
    return buffer;
  }

  const collected = [];
  await synthesizeReply(text, connection, timer, (chunk) => {
    collected.push(chunk);
    onPcmChunk(chunk);
  });
  ttsCacheStore(key, Buffer.concat(collected));
  return null;
}

function pickCachedFiller(connection) {
  const candidates = [];
  for (const text of TTS_FILLER_TEXTS) {
    const key = ttsCacheKey(connection, text);
    const hit = key ? ttsPcmCache.get(key) : null;
    if (hit) {
      candidates.push(hit);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Pre-synthesize fillers for this session's voice/speed only when it will not
 * hurt the first real reply. Cloud TTS warmup is opt-in because a cold filler
 * request can occupy the provider queue for several seconds.
 */
async function warmupTtsForConnection(connection) {
  const provider = getTtsProvider(connection);
  const shouldWarmup =
    TTS_WARMUP_ENABLED ||
    FILLER_DELAY_MS > 0 ||
    provider === "local-cosyvoice";

  if (!shouldWarmup) {
    return;
  }

  for (const text of TTS_FILLER_TEXTS) {
    try {
      await synthesizeReplyCached(text, connection, null, null);
    } catch (error) {
      console.warn(
        "[selfhosted-voice] tts warmup skipped:",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
  }
}

/**
 * Plays a cached filler ("Hmm.") if the real reply audio has not started
 * within FILLER_DELAY_MS — a 1s "thinking" beat feels natural, dead silence
 * does not. Padded with silence so it clears the client's prime buffer.
 */
function createFillerGuard({ socket, connection, timer, isTurnCurrent }) {
  if (!FILLER_DELAY_MS) {
    return { cancel() {}, takeLead: () => null };
  }
  let fillerSent = false;
  const timerId = setTimeout(() => {
    if (isTurnCurrent && !isTurnCurrent()) {
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const pcm = pickCachedFiller(connection);
    if (!pcm) {
      return;
    }
    const targetBytes = Math.floor((OUTPUT_SAMPLE_RATE * 2 * FILLER_TOTAL_MS) / 1000) & ~1;
    const padBytes = Math.max(0, targetBytes - pcm.length) & ~1;
    fillerSent = true;
    timer?.mark("filler-audio", { audioBytes: pcm.length + padBytes });
    socket.send(padBytes > 0 ? Buffer.concat([pcm, Buffer.alloc(padBytes)]) : pcm, { binary: true });
  }, FILLER_DELAY_MS);

  return {
    cancel() {
      clearTimeout(timerId);
    },
    /** Call right before the first real audio bytes; returns lead-in silence if a filler already played. */
    takeLead() {
      clearTimeout(timerId);
      if (!fillerSent) {
        return null;
      }
      fillerSent = false;
      const gapBytes = Math.floor((OUTPUT_SAMPLE_RATE * 2 * 150) / 1000) & ~1;
      return Buffer.alloc(gapBytes);
    },
  };
}

async function handleBotTurn({ socket, connection, userText, timer, isTurnCurrent }) {
  if (!userText.trim()) {
    return;
  }
  if (isTurnCurrent && !isTurnCurrent()) {
    return;
  }

  connection.messages.push({ role: "user", content: userText });

  timer?.mark("deepseek-start");
  const fillerGuard = createFillerGuard({ socket, connection, timer, isTurnCurrent });

  try {
    let fullReply = "";
    let sawFirstToken = false;
    let spokenCharOffset = 0;
    const ttsQueue = createStreamingTtsQueue({ socket, connection, timer, isTurnCurrent, fillerGuard });

    const drainNewSpeakableUnits = () => {
      const { units, nextIndex } = drainSpeakableUnits(fullReply, spokenCharOffset);
      for (const unit of units) {
        ttsQueue.enqueue(unit);
      }
      spokenCharOffset = nextIndex;
    };

    for await (const delta of streamDeepSeekReply(compactMessagesForRealtime(connection.messages), connection)) {
      if (isTurnCurrent && !isTurnCurrent()) {
        return;
      }
      if (!sawFirstToken) {
        sawFirstToken = true;
        timer?.mark("deepseek-first-token");
      }
      fullReply += delta;
      emitSocketJson(socket, {
        type: "bot-message",
        text: fullReply,
        isFinal: false,
      });
      drainNewSpeakableUnits();

      // 首句抢跑加强：第一批 TTS 还没起跑时不等句号，
      // 在从句标点/词边界提前切一段先送 TTS（详见 findEarlyFirstCut 注释）
      if (ttsQueue.batches === 0) {
        const pendingText = fullReply.slice(spokenCharOffset);
        const cut = findEarlyFirstCut(pendingText);
        if (cut > 0) {
          ttsQueue.enqueueNow(pendingText.slice(0, cut));
          spokenCharOffset += cut;
        }
      }
    }

    if (isTurnCurrent && !isTurnCurrent()) {
      return;
    }

    const finalText = fullReply.trim();
    if (!finalText) {
      throw new Error("DeepSeek 没有返回可用回复。");
    }

    timer?.mark("deepseek-done", { chars: finalText.length });

    emitSocketJson(socket, {
      type: "bot-message",
      text: finalText,
      isFinal: true,
    });

    connection.messages.push({ role: "assistant", content: finalText });

    const promptChars = connection.messages
      .slice(0, -1)
      .map((message) => String(message.content ?? ""))
      .join("\n");
    connection.usage.deepseekTokens += estimateDeepseekTokens(`${promptChars}\n${finalText}`);

    // 没有终止标点的尾巴由 remainder 覆盖；已攒未说的句子由 flush 兜底，不要再整段重复入队。
    const remainder = fullReply.slice(spokenCharOffset).trim();
    if (remainder) {
      ttsQueue.enqueue(remainder);
    }

    await ttsQueue.flush();
  } finally {
    fillerGuard.cancel();
  }
}

async function handleAudioTurn({ socket, connection, chunks, turnEpoch }) {
  const isTurnCurrent = () => connection.turnEpoch === turnEpoch;
  const timer = createTurnTimer("audio-turn");
  timer.mark("turn-start");

  if (chunks.length === 0) {
    return;
  }

  try {
    const transcript = await transcribeTurn(chunks, timer, connection);
    if (!isTurnCurrent()) {
      timer.finish("audio-turn-superseded-after-asr");
      return;
    }
    if (!transcript.text) {
      emitSocketJson(socket, {
        type: "realtime-hint",
        message: "这一轮没识别到清晰内容，可以再说一次。",
        level: "warning",
      });
      timer.finish("empty-transcript");
      return;
    }

    emitSocketJson(socket, {
      type: "transcript",
      text: transcript.text,
      isFinal: true,
    });

    await handleBotTurn({ socket, connection, userText: transcript.text, timer, isTurnCurrent });
    if (!isTurnCurrent()) {
      timer.finish("audio-turn-superseded-after-bot");
      return;
    }
    timer.finish("audio-turn-complete");
  } catch (error) {
    timer.finish("audio-turn-failed");
    throw error;
  }
}

function serializeProcessing(connection, task) {
  connection.processing = connection.processing.catch(() => undefined).then(task);
  return connection.processing;
}

/**
 * 反悔合并：撤掉上一轮 user 问句（及其 assistant 回复，若已生成），
 * 让合并后的完整句子重新提问。
 * 安全护栏：只有当上一条 user 内容确实是本次完整句的前缀时才回退，
 * 防止竞态下误删更早的正常轮次。
 */
function rewindLastTextTurn(connection, amendText) {
  const messages = connection.messages;
  let userIndex = messages.length - 1;
  if (userIndex >= 0 && messages[userIndex].role === "assistant") {
    userIndex -= 1;
  }
  if (userIndex < 0 || messages[userIndex].role !== "user") {
    return false;
  }
  const previousUserText = String(messages[userIndex].content ?? "").trim().toLowerCase();
  const mergedText = amendText.trim().toLowerCase();
  if (!previousUserText || !mergedText.startsWith(previousUserText)) {
    return false;
  }
  messages.splice(userIndex);
  return true;
}

const httpServer = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/health")) {
    const [whisper, cosyvoice] = await Promise.all([
      checkDependency("whisper", WHISPER_BASE_URL),
      checkDependency("cosyvoice", COSYVOICE_BASE_URL),
    ]);
    const siliconflow = siliconFlowConfigStatus(siliconflowApiKey);
    const localOk = whisper.ok || cosyvoice.ok;
    const cloudOk = siliconflow.apiKeyConfigured;
    sendJson(res, 200, {
      status: localOk || cloudOk ? (whisper.ok && cosyvoice.ok && cloudOk ? "ok" : "degraded") : "degraded",
      whisper,
      cosyvoice,
      siliconflow,
      sampleRate: OUTPUT_SAMPLE_RATE,
    });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/api/voice-backend-config")) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const context = {
      userId: requestUrl.searchParams.get("userId") || undefined,
      guestId: requestUrl.searchParams.get("guestId") || undefined,
      sessionId: requestUrl.searchParams.get("sessionId") || undefined,
    };
    const resolved = await resolveVoiceConfig(supabaseClient, context);
    sendJson(res, 200, {
      backend: resolved.backend,
      config: resolved.config,
      modelOverrides: toModelOverrides(resolved.config),
      voiceProfile: resolved.voiceProfile,
      cachedAt: resolved.cachedAt,
      sampleRate: OUTPUT_SAMPLE_RATE,
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

const wss = new WebSocketServer({
  server: httpServer,
  path: WS_PATH,
  verifyClient: ({ origin }, callback) => {
    if (isOriginAllowed(origin)) {
      callback(true);
      return;
    }
    console.warn("[selfhosted-voice] rejected connection from origin:", origin || "(missing)");
    callback(false, 403, "Origin not allowed");
  },
});

wss.on("connection", async (socket, request) => {
  const requestUrl = new URL(request.url || WS_PATH, `http://${request.headers.host || "localhost"}`);
  const connection = {
    initialized: false,
    config: null,
    messages: [],
    turnAudioChunks: [],
    turnEpoch: 0,
    processing: Promise.resolve(),
    usage: createSessionUsageTracker(),
  };

  socket.on("close", () => {
    void flushSessionUsage(connection);
  });

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      if (connection.initialized) {
        connection.turnAudioChunks.push(Buffer.from(data));
      }
      return;
    }

    let message;
    try {
      message = JSON.parse(Buffer.from(data).toString("utf8"));
    } catch {
      emitSocketJson(socket, { type: "error", message: "Invalid JSON message." });
      return;
    }

    if (message.type === "start") {
      const config = {
        sessionId: message.sessionId || requestUrl.searchParams.get("sessionId") || crypto.randomUUID(),
        userId: message.userId || requestUrl.searchParams.get("userId") || undefined,
        guestId: message.guestId || requestUrl.searchParams.get("guestId") || undefined,
        voiceType: typeof message.voiceType === "string" ? message.voiceType : undefined,
        speedRatio: typeof message.speedRatio === "number" ? message.speedRatio : undefined,
        systemPrompt: typeof message.systemPrompt === "string" ? message.systemPrompt : undefined,
      };

      const applyReady = (voiceModelConfig) => {
        connection.initialized = true;
        connection.config = config;
        connection.voiceModelConfig = voiceModelConfig;
        connection.messages = createConversationState(config);
        emitSocketJson(socket, {
          type: "ready",
          sessionId: config.sessionId,
          sampleRate: OUTPUT_SAMPLE_RATE,
        });
        // Optional TTS warmup/filler prebuild; cloud providers are skipped by default to avoid first-turn queue contention.
        void warmupTtsForConnection(connection);
      };

      const refreshSessionConfig = (clientOverrides) => {
        void resolveSessionVoiceConfig(supabaseClient, config)
          .then((resolved) => {
            if (resolved.backend === "selfhosted" && connection.initialized) {
              // 客户端显式传的 overrides 必须继续生效（例如前端会把
              // siliconflow-cosyvoice 换成低延迟 MOSS-TTSD）。此前这里整个
              // 覆盖 voiceModelConfig，导致开场白用 override 音色、刷新完成后
              // 的对话又换回后台配置音色——首句和后续音色不一致。
              connection.voiceModelConfig = mergeClientModelOverrides(
                resolved.config,
                clientOverrides,
              );
            }
          })
          .catch(() => {
            // Keep the fast-path config from modelOverrides.
          });
      };

      if (message.modelOverrides && typeof message.modelOverrides === "object") {
        applyReady(configFromModelOverrides(message.modelOverrides));
        refreshSessionConfig(message.modelOverrides);
        return;
      }

      void resolveSessionVoiceConfig(supabaseClient, config)
        .then((resolved) => {
          if (resolved.backend !== "selfhosted") {
            emitSocketJson(socket, {
              type: "error",
              message: "当前配置指定使用 Doubao，请切回 Doubao adapter 建连。",
            });
            socket.close(1008, "backend mismatch");
            return;
          }

          applyReady(resolved.config);
        })
        .catch((error) => {
          emitSocketJson(socket, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          socket.close(1011, "config resolution failed");
        });
      return;
    }

    if (!connection.initialized || !connection.config) {
      emitSocketJson(socket, { type: "error", message: "Session not initialized." });
      return;
    }

    if (message.type === "warmup-asr") {
      const provider = getAsrProvider(connection);
      if (siliconflowApiKey && isSiliconFlowAsrProvider(provider)) {
        void warmupSiliconFlowAsr(siliconflowApiKey, provider);
      }
      return;
    }

    if (message.type === "end-turn") {
      connection.turnEpoch = (connection.turnEpoch ?? 0) + 1;
      const turnEpoch = connection.turnEpoch;
      const chunks = connection.turnAudioChunks;
      connection.turnAudioChunks = [];

      void (async () => {
        try {
          await handleAudioTurn({ socket, connection, chunks, turnEpoch });
        } catch (error) {
          if (connection.turnEpoch !== turnEpoch) {
            return;
          }
          emitSocketJson(socket, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return;
    }

    if (message.type === "text-query") {
      const text = typeof message.text === "string" ? message.text.trim() : "";
      if (!text) {
        return;
      }
      const isAmend = message.amend === true;
      // 每个 text 回合有自己的 epoch：新查询到达即作废还在跑的旧回合
      //（反悔合并撤销半句回复；快速连说两句时也只回答最新一句）。
      connection.textTurnEpoch = (connection.textTurnEpoch ?? 0) + 1;
      const textTurnEpoch = connection.textTurnEpoch;
      const isTurnCurrent = () => connection.textTurnEpoch === textTurnEpoch;
      void serializeProcessing(connection, async () => {
        if (!isTurnCurrent()) {
          return;
        }
        if (isAmend) {
          rewindLastTextTurn(connection, text);
        }
        const timer = createTurnTimer(isAmend ? "text-turn-amend" : "text-turn");
        timer.mark("turn-start");
        try {
          await handleBotTurn({ socket, connection, userText: text, timer, isTurnCurrent });
          timer.finish("text-turn-complete");
        } catch (error) {
          timer.finish("text-turn-failed");
          if (!isTurnCurrent()) {
            return;
          }
          emitSocketJson(socket, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    if (message.type === "say-hello") {
      const text = typeof message.text === "string" ? message.text.trim() : "";
      if (!text) {
        return;
      }
      void serializeProcessing(connection, async () => {
        const timer = createTurnTimer("say-hello");
        timer.mark("turn-start");
        try {
          emitSocketJson(socket, {
            type: "bot-message",
            text,
            isFinal: true,
          });
          connection.messages.push({ role: "assistant", content: text });
          const pcmBatcher = createPcmSocketBatcher(socket);
          await synthesizeReplyCached(text, connection, timer, pcmBatcher.push);
          pcmBatcher.flush();
          timer.mark("audio-sent");
          timer.finish("say-hello-complete");
        } catch (error) {
          timer.finish("say-hello-failed");
          emitSocketJson(socket, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
  });

  socket.on("error", (error) => {
    console.error("[selfhosted-voice] socket error", error);
  });
});

httpServer.on("listening", () => {
  const bind = IS_CLOUD_BIND ? "0.0.0.0" : "localhost";
  console.log(`[selfhosted-voice] listening on ${bind}:${PORT}`);
  if (allowedOrigins.length > 0) {
    console.log("[selfhosted-voice] allowed origins:", allowedOrigins.join(", "));
  } else {
    console.warn("[selfhosted-voice] ALLOWED_ORIGINS not set — accepting all origins");
  }
});

httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`[selfhosted-voice] port ${PORT} is already in use.`);
    process.exitCode = 1;
    return;
  }
  console.error("[selfhosted-voice] server error", error);
});

void startupHealthCheck();
httpServer.listen(PORT, IS_CLOUD_BIND ? "0.0.0.0" : undefined);
