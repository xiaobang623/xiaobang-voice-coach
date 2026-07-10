import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
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

const PORT = Number(process.env.SELFHOSTED_VOICE_PORT || 8081);
const WS_PATH = "/ws";
const ENV_LOCAL_PATH = resolve(process.cwd(), ".env.local");
const WHISPER_BASE_URL = process.env.WHISPER_BASE_URL ?? "http://127.0.0.1:8000";
const COSYVOICE_BASE_URL = process.env.COSYVOICE_BASE_URL ?? "http://127.0.0.1:8001";
const OUTPUT_SAMPLE_RATE = 16000;
const DEFAULT_COSYVOICE_SPEED = 0.85;
const DEFAULT_SILICONFLOW_SPEED = 0.85;
const HEALTH_CHECK_TTL_MS = 10_000;
const modelInstances = parseModelInstances();
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_COACH_PROMPT = [
  "You are Xiaobang Coach, a warm English speaking partner.",
  "Reply like a real live conversation, not a lesson or written explanation.",
  "Prefer one short spoken sentence under 15 words; use two only when necessary.",
  "Ask at most one simple question, and avoid long clauses or over-explaining.",
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

  const synthPromise = synthesizeReply(text, connection, timer, onChunk)
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

function createStreamingTtsQueue({ socket, connection, timer, isTurnCurrent }) {
  const pcmBatcher = createPcmSocketBatcher(socket);
  let sendChain = Promise.resolve();
  let started = false;
  let pendingTtsText = "";

  const shouldSpeakBuffered = (text, force) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    if (force) {
      return true;
    }
    // 每个 TTS 请求有 1~3s 固定首包成本，短回复逐句请求会在句间留出遮不住的空窗；
    // 整条回复攒成一次请求（回复很短，DeepSeek 全文只比首句晚几百 ms），超长才分段。
    return trimmed.length >= 160;
  };

  const startUnitStream = (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

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

  return { enqueue, flush, get started() { return started; } };
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
  return connection?.voiceModelConfig?.selfhosted?.asrProvider ?? "siliconflow-sensevoice";
}

function getTtsProvider(connection) {
  return connection?.voiceModelConfig?.selfhosted?.ttsProvider ?? "local-cosyvoice";
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
      max_tokens: 80,
      messages,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`DeepSeek 对话失败: ${detail || response.status}`);
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
  // UI 语速来自豆包预设；本地 CosyVoice 同数值听起来更快，换算后压一档。
  return Math.min(0.95, Math.max(0.75, speedRatio * 0.85));
}

function mapSiliconFlowSpeed(speedRatio) {
  if (typeof speedRatio !== "number" || !Number.isFinite(speedRatio)) {
    return DEFAULT_SILICONFLOW_SPEED;
  }
  // UI 语速预设面向豆包；SiliconFlow 同数值偏快，换算后整体压一档。
  return Math.min(1.1, Math.max(0.7, speedRatio * 0.82));
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

async function synthesizeWholeReplyToSocket({ socket, connection, timer, isTurnCurrent, text }) {
  const pcmBatcher = createPcmSocketBatcher(socket);
  timer?.mark("tts-whole-reply", { provider: "local-cosyvoice", chars: text.length });

  await synthesizeReply(text, connection, timer, (chunk) => {
    if (isTurnCurrent && !isTurnCurrent()) {
      return;
    }
    pcmBatcher.push(chunk);
  });

  if (isTurnCurrent && !isTurnCurrent()) {
    return;
  }
  pcmBatcher.flush();
  timer?.mark("audio-sent");
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
  let fullReply = "";
  let sawFirstToken = false;
  const ttsProvider = getTtsProvider(connection);
  const shouldStreamTtsDuringGeneration = ttsProvider !== "local-cosyvoice";
  let spokenCharOffset = 0;
  const ttsQueue = shouldStreamTtsDuringGeneration
    ? createStreamingTtsQueue({ socket, connection, timer, isTurnCurrent })
    : null;

  const drainNewSpeakableUnits = () => {
    if (!ttsQueue) {
      return;
    }
    const { units, nextIndex } = drainSpeakableUnits(fullReply, spokenCharOffset);
    for (const unit of units) {
      ttsQueue.enqueue(unit);
    }
    spokenCharOffset = nextIndex;
  };

  for await (const delta of streamDeepSeekReply(connection.messages, connection)) {
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

  if (!ttsQueue) {
    // Local CosyVoice has a noticeable fixed first-packet cost per request.
    // For short live-coach replies, one full-reply synthesis is smoother than
    // sentence-level prefetching, which can create audible gaps between chunks.
    await synthesizeWholeReplyToSocket({ socket, connection, timer, isTurnCurrent, text: finalText });
    return;
  }

  // 没有终止标点的尾巴由 remainder 覆盖；已攒未说的句子由 flush 兜底，不要再整段重复入队。
  const remainder = fullReply.slice(spokenCharOffset).trim();
  if (remainder) {
    ttsQueue.enqueue(remainder);
  }

  await ttsQueue.flush();
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

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

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
      };

      const refreshSessionConfig = () => {
        void resolveSessionVoiceConfig(supabaseClient, config)
          .then((resolved) => {
            if (resolved.backend === "selfhosted" && connection.initialized) {
              connection.voiceModelConfig = resolved.config;
            }
          })
          .catch(() => {
            // Keep the fast-path config from modelOverrides.
          });
      };

      if (message.modelOverrides && typeof message.modelOverrides === "object") {
        applyReady(configFromModelOverrides(message.modelOverrides));
        refreshSessionConfig();
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
      void serializeProcessing(connection, async () => {
        const timer = createTurnTimer("text-turn");
        timer.mark("turn-start");
        try {
          await handleBotTurn({ socket, connection, userText: text, timer });
          timer.finish("text-turn-complete");
        } catch (error) {
          timer.finish("text-turn-failed");
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
          await synthesizeReply(text, connection, timer, pcmBatcher.push);
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
  const bind = process.env.SELFHOSTED_VOICE_PORT ? "0.0.0.0" : "localhost";
  console.log(`[selfhosted-voice] listening on ${bind}:${PORT}`);
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
httpServer.listen(PORT, process.env.SELFHOSTED_VOICE_PORT ? "0.0.0.0" : undefined);
