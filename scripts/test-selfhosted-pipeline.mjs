#!/usr/bin/env node
/**
 * 无麦克风测试自建语音链路：
 *   1. Whisper / CosyVoice / backend 健康检查
 *   2. CosyVoice 直接合成一句
 *   3. WebSocket text-query 跑完整 DeepSeek + TTS 链路
 *
 * 用法（先启动三个服务）:
 *   ./start_whisper.sh
 *   ./start_cosyvoice.sh
 *   node backend/server.js
 *   npm run test:selfhosted
 */

import WebSocket from "ws";

const WHISPER_URL = process.env.WHISPER_BASE_URL ?? "http://127.0.0.1:8000";
const COSYVOICE_URL = process.env.COSYVOICE_BASE_URL ?? "http://127.0.0.1:8001";
const BACKEND_HTTP = process.env.SELFHOSTED_HTTP_URL ?? "http://127.0.0.1:8081";
const WS_URL = process.env.SELFHOSTED_WS_URL ?? "ws://127.0.0.1:8081/ws";
const TEST_TEXT = process.env.TEST_TEXT ?? "Hi! Nice to meet you. How was your day?";

function msSince(start) {
  return `${Date.now() - start}ms`;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  return response.json();
}

async function checkHealth(name, url) {
  const start = Date.now();
  const payload = await fetchJson(`${url}/health`);
  console.log(`✓ ${name} (${msSince(start)})`, JSON.stringify(payload));
  return payload;
}

async function testCosyVoiceDirect() {
  const start = Date.now();
  const form = new FormData();
  form.append("text", "Hello from the pipeline test.");
  form.append("mode", "sft");
  form.append("stream", "true");
  form.append("output_format", "pcm");
  form.append("speed", "0.85");

  const response = await fetch(`${COSYVOICE_URL}/synthesize`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`CosyVoice synthesize failed: ${detail || response.status}`);
  }

  const chunks = [];
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value?.byteLength) {
      chunks.push(value.byteLength);
    }
  }

  const totalBytes = chunks.reduce((sum, n) => sum + n, 0);
  console.log(
    `✓ CosyVoice direct synthesize (${msSince(start)}) chunks=${chunks.length} bytes=${totalBytes}`,
  );
}

function testTextQuery() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const marks = [];
    const mark = (stage) => {
      marks.push({ stage, ms: Date.now() - start });
      console.log(`  [ws] ${stage} +${marks.at(-1).ms}ms`);
    };

    const socket = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket test timed out after 120s"));
    }, 120_000);

    let audioBytes = 0;

    socket.on("open", () => {
      mark("connected");
      socket.send(
        JSON.stringify({
          type: "start",
          sessionId: `test-${Date.now()}`,
          systemPrompt: "Reply in one short English sentence.",
        }),
      );
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        audioBytes += data.byteLength;
        if (audioBytes === data.byteLength) {
          mark("first-audio-chunk");
        }
        return;
      }

      let payload;
      try {
        payload = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }

      if (payload.type === "ready") {
        mark("ready");
        socket.send(JSON.stringify({ type: "text-query", text: TEST_TEXT }));
        return;
      }

      if (payload.type === "bot-message" && payload.isFinal) {
        mark("bot-message-final");
        return;
      }

      if (payload.type === "error") {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(payload.message ?? "websocket error"));
      }
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      mark("closed");
      console.log(
        `✓ WebSocket text-query (${msSince(start)}) audioBytes=${audioBytes}`,
      );
      console.log(
        "  timeline:",
        marks.map((m) => `${m.stage}@${m.ms}ms`).join(" → "),
      );
      resolve();
    });

    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  console.log("=== Self-hosted pipeline smoke test ===\n");

  await checkHealth("Whisper", WHISPER_URL);
  await checkHealth("CosyVoice", COSYVOICE_URL);
  await checkHealth("Backend", BACKEND_HTTP);

  console.log("");
  await testCosyVoiceDirect();

  console.log("");
  console.log(`WebSocket text-query: "${TEST_TEXT}"`);
  await testTextQuery();

  console.log("\nAll checks passed.");
}

main().catch((error) => {
  console.error("\n✗ Test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
