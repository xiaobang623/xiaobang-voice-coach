import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createUsageTracker, parseUsageContext } from "./proxy-usage.js";
import { verifyVoiceToken } from "./api/_lib/voice-token.js";

const PORT = Number(process.env.PORT) || 8080;
const TARGET_URL = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
const ENV_LOCAL_PATH = resolve(process.cwd(), ".env.local");

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

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();

const voiceTokenSecret = process.env.VOICE_TOKEN_SECRET ?? "";

function isOriginAllowed(origin) {
  if (!origin) {
    return allowedOrigins.length === 0;
  }
  if (allowedOrigins.length === 0) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

/**
 * 校验连接鉴权 token（堵「谁拿到 proxy 地址就能白嫖烧钱」的洞）。
 *
 * - 未配置 VOICE_TOKEN_SECRET → fail-open 放行（灰度期：先部署代码、后设密钥，
 *   避免部署顺序把正常用户锁在门外）。设了密钥即强制校验。
 * - 校验：签名 + 未过期 + token 里的身份必须和 query 上的 userId/guestId 一致，
 *   防止攻击者拿别人 token 或伪造身份。
 * 返回 { ok, reason }。
 */
function verifyConnectionAuth(requestUrl) {
  if (!voiceTokenSecret) {
    return { ok: true, reason: "auth-disabled" };
  }

  let params;
  try {
    params = new URL(requestUrl ?? "/", "http://localhost").searchParams;
  } catch {
    return { ok: false, reason: "bad-url" };
  }

  const token = params.get("vt");
  if (!token) {
    return { ok: false, reason: "missing-token" };
  }

  const result = verifyVoiceToken(token, voiceTokenSecret);
  if (!result.valid) {
    return { ok: false, reason: result.reason };
  }

  const { actor, id } = result.claims;
  const queryUserId = params.get("userId");
  const queryGuestId = params.get("guestId");
  const claimedId = actor === "user" ? queryUserId : queryGuestId;
  if (!claimedId || claimedId !== id) {
    return { ok: false, reason: "identity-mismatch" };
  }

  return { ok: true, reason: "ok" };
}

function rewriteStartSessionFrame(data, isBinary) {
  if (!isBinary) return null;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.length < 12) return null;

  const messageType = (bytes[1] >> 4) & 0x0f;
  const hasEventId = (bytes[1] & 0x0f) === 0x04;
  if (messageType !== 1 || !hasEventId) return null;

  const eventId = bytes.readUInt32BE(4);
  if (eventId !== 100) return null;

  const sessionLen = bytes.readUInt32BE(8);
  const sessionStart = 12;
  const sessionEnd = sessionStart + sessionLen;
  if (sessionEnd + 4 > bytes.length) return null;

  const payloadLen = bytes.readUInt32BE(sessionEnd);
  const payloadStart = sessionEnd + 4;
  const payloadEnd = payloadStart + payloadLen;
  if (payloadEnd > bytes.length) return null;

  let payload;
  try {
    payload = JSON.parse(bytes.slice(payloadStart, payloadEnd).toString("utf8"));
  } catch {
    return null;
  }

  const normalized = payload && typeof payload === "object" ? payload : {};
  const extra =
    normalized.extra && typeof normalized.extra === "object"
      ? { ...normalized.extra }
      : {};

  // Read voice from tts.speaker (O2.0 dialog) or legacy audio_config.voice_type.
  const incomingTts =
    normalized.tts && typeof normalized.tts === "object" ? normalized.tts : {};
  const incomingAudioConfig =
    incomingTts.audio_config && typeof incomingTts.audio_config === "object"
      ? incomingTts.audio_config
      : {};

  const speaker =
    incomingTts.speaker ??
    incomingAudioConfig.voice_type ??
    "zh_female_vv_jupiter_bigtts";

  // Force PCM container (playback depends on it); honor frontend speed when set.
  const audioConfig = {
    format: "pcm_s16le",
    sample_rate: 16000,
    channel: 1,
  };
  if (incomingAudioConfig.speed_ratio != null) {
    audioConfig.speed_ratio = incomingAudioConfig.speed_ratio;
  }

  const nextPayload = {
    ...normalized,
    extra: {
      ...extra,
      input_mod: "keep_alive",
    },
    tts: {
      speaker,
      audio_config: audioConfig,
    },
  };

  const nextPayloadBytes = Buffer.from(JSON.stringify(nextPayload), "utf8");
  const out = Buffer.alloc(4 + 4 + 4 + sessionLen + 4 + nextPayloadBytes.length);
  bytes.copy(out, 0, 0, 4); // preserve protocol header bytes
  out.writeUInt32BE(eventId, 4);
  out.writeUInt32BE(sessionLen, 8);
  bytes.copy(out, 12, sessionStart, sessionEnd); // keep same session id bytes
  out.writeUInt32BE(nextPayloadBytes.length, 12 + sessionLen);
  nextPayloadBytes.copy(out, 12 + sessionLen + 4);
  return {
    frame: out,
    payload: nextPayload,
  };
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info, callback) => {
    const origin = info.origin;
    if (!isOriginAllowed(origin)) {
      console.warn("[proxy] rejected connection from origin:", origin || "(missing)");
      callback(false, 403, "Origin not allowed");
      return;
    }

    const auth = verifyConnectionAuth(info.req?.url);
    if (!auth.ok) {
      console.warn("[proxy] rejected connection, auth failed:", auth.reason);
      callback(false, 401, "Voice token invalid");
      return;
    }

    callback(true);
  },
});

httpServer.on("listening", () => {
  const bind = process.env.PORT ? "0.0.0.0" : "localhost";
  console.log(`[proxy] listening on ${bind}:${PORT}`);
  if (allowedOrigins.length > 0) {
    console.log("[proxy] allowed origins:", allowedOrigins.join(", "));
  } else {
    console.warn("[proxy] ALLOWED_ORIGINS not set — accepting all origins");
  }
  if (voiceTokenSecret) {
    console.log("[proxy] voice token auth: ENABLED (rejecting connections without a valid token)");
  } else {
    console.warn(
      "[proxy] VOICE_TOKEN_SECRET not set — voice token auth DISABLED (anyone with the URL can burn cost). Set it before public launch.",
    );
  }
});

httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(
      `[proxy] port ${PORT} is already in use. An existing proxy instance is likely running.`,
    );
    process.exitCode = 1;
    return;
  }
  console.error("[proxy] server error", error);
});

wss.on("connection", (clientSocket, request) => {
  const usageContext = parseUsageContext(request?.url);
  const usageTracker = createUsageTracker(usageContext);
  const connectedAt = Date.now();
  let usageFlushed = false;

  const flushUsage = () => {
    if (usageFlushed) {
      return;
    }
    usageFlushed = true;
    const durationSeconds = Math.max(1, Math.floor((Date.now() - connectedAt) / 1000));
    void usageTracker.flush({ durationSeconds });
  };

  const appId =
    process.env.DOUBAO_APP_ID ??
    process.env.VITE_DOUBAO_APP_ID ??
    envLocal.DOUBAO_APP_ID ??
    envLocal.VITE_DOUBAO_APP_ID;
  const accessToken =
    process.env.DOUBAO_ACCESS_TOKEN ??
    envLocal.DOUBAO_ACCESS_TOKEN;
  const accessKey =
    process.env.DOUBAO_ACCESS_KEY ??
    process.env.VITE_DOUBAO_ACCESS_KEY ??
    envLocal.DOUBAO_ACCESS_KEY ??
    envLocal.VITE_DOUBAO_ACCESS_KEY;
  const resolvedAccessKey = accessToken || accessKey;

  if (!appId || !resolvedAccessKey) {
    console.error("[proxy] missing DOUBAO_APP_ID and/or DOUBAO_ACCESS_KEY (DOUBAO_ACCESS_TOKEN fallback also supported)");
    clientSocket.close(1011, "Proxy credentials missing");
    return;
  }

  // Buffer messages received before upstream is ready
  const messageQueue = [];

  const upstreamSocket = new WebSocket(TARGET_URL, {
    headers: {
      "X-Api-App-ID": appId,
      "X-Api-Access-Key": resolvedAccessKey,
      "X-Api-Resource-Id": "volc.speech.dialog",
      "X-Api-App-Key": "PlgvMymc7f3tQnJ6",
    },
  });

  const upstreamConnectTimer = setTimeout(() => {
    if (upstreamSocket.readyState === WebSocket.CONNECTING) {
      console.error("[proxy] upstream connect timeout");
      upstreamSocket.terminate();
      if (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING) {
        clientSocket.close(1011, "Upstream connect timeout");
      }
    }
  }, 12_000);

  upstreamSocket.on("open", () => {
    clearTimeout(upstreamConnectTimer);
    // Flush any messages buffered while upstream was connecting
    for (const { data, isBinary } of messageQueue) {
      upstreamSocket.send(data, { binary: isBinary });
    }
    messageQueue.length = 0;
  });

  upstreamSocket.on("unexpected-response", (_request, response) => {
    clearTimeout(upstreamConnectTimer);
    const chunks = [];
    response.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    response.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      console.error("[proxy] upstream unexpected response", {
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        headers: response.headers,
        body,
      });
      if (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING) {
        clientSocket.close(1011, "Upstream auth failed");
      }
    });
  });

  clientSocket.on("message", (data, isBinary) => {
    const rewritten = rewriteStartSessionFrame(data, isBinary);
    if (rewritten) {
      const ac = rewritten.payload?.tts ?? {};
      console.log(
        `[proxy] start-session tts injected: speaker=${ac.speaker ?? "(missing)"} speed_ratio=${
          ac.audio_config?.speed_ratio ?? "(server default)"
        }`,
      );
    }

    const outgoingData = rewritten ? rewritten.frame : data;
    if (upstreamSocket.readyState === WebSocket.OPEN) {
      upstreamSocket.send(outgoingData, { binary: isBinary });
    } else if (upstreamSocket.readyState === WebSocket.CONNECTING) {
      // Queue messages until upstream is ready
      messageQueue.push({ data: outgoingData, isBinary });
    }
  });

  upstreamSocket.on("message", (data, isBinary) => {
    usageTracker.recordFrame(data, isBinary);
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(data, { binary: isBinary });
    }
  });

  clientSocket.on("close", () => {
    flushUsage();
    if (
      upstreamSocket.readyState === WebSocket.OPEN ||
      upstreamSocket.readyState === WebSocket.CONNECTING
    ) {
      upstreamSocket.close();
    }
  });

  upstreamSocket.on("close", () => {
    flushUsage();
    if (
      clientSocket.readyState === WebSocket.OPEN ||
      clientSocket.readyState === WebSocket.CONNECTING
    ) {
      clientSocket.close();
    }
  });

  clientSocket.on("error", (error) => {
    console.error("[proxy] client socket error", error);
    if (
      upstreamSocket.readyState === WebSocket.OPEN ||
      upstreamSocket.readyState === WebSocket.CONNECTING
    ) {
      upstreamSocket.close();
    }
  });

  upstreamSocket.on("error", (error) => {
    clearTimeout(upstreamConnectTimer);
    console.error("[proxy] upstream socket error", error);
    if (
      clientSocket.readyState === WebSocket.OPEN ||
      clientSocket.readyState === WebSocket.CONNECTING
    ) {
      clientSocket.close(1011, "Upstream connection failed");
    }
  });
});

httpServer.listen(PORT, process.env.PORT ? "0.0.0.0" : undefined);
