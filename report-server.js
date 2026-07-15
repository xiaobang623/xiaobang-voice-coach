import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_PORT = 8090;
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

import { SYSTEM_PROMPT, cleanTranscriptForReport, postProcessReport } from "./report-post-process.js";
import { MEMORY_SYSTEM_PROMPT, postProcessMemory } from "./memory-post-process.js";
import {
  DIRECTIONS_SYSTEM_PROMPT,
  buildDirectionsUserPrompt,
  postProcessDirections,
} from "./directions-post-process.js";

const envLocal = parseEnvLocalFile();
const apiKey = process.env.DEEPSEEK_API_KEY ?? envLocal.DEEPSEEK_API_KEY;

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.url === "/extract-memory") {
    if (!apiKey) {
      sendJson(res, 500, { error: "DEEPSEEK_API_KEY is not configured in .env.local" });
      return;
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let input;
    try {
      input = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    if (!input.transcript?.trim()) {
      sendJson(res, 400, { error: "transcript is required" });
      return;
    }

    const previousBlock = input.previousSummary
      ? `Previous profile:\n${JSON.stringify(input.previousSummary, null, 2)}\n\n`
      : "";
    const reportBlock = input.report
      ? `Latest report:\n${JSON.stringify(input.report, null, 2)}\n\n`
      : "";

    try {
      const deepseekResponse = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: MEMORY_SYSTEM_PROMPT },
            {
              role: "user",
              content: `${previousBlock}${reportBlock}Transcript:\n${input.transcript}`,
            },
          ],
        }),
      });

      if (!deepseekResponse.ok) {
        const detail = await deepseekResponse.text();
        sendJson(res, 502, { error: "DeepSeek request failed", detail });
        return;
      }

      const completion = await deepseekResponse.json();
      const content = completion?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        sendJson(res, 502, { error: "Empty model response" });
        return;
      }

      const raw = JSON.parse(content);
      sendJson(
        res,
        200,
        postProcessMemory(raw, {
          report: input.report,
          previousSummary: input.previousSummary,
          ownerKey: input.userId ?? input.guestId ?? "memory",
        }),
      );
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Memory extraction failed",
      });
    }
    return;
  }

  if (req.url === "/generate-directions") {
    if (!apiKey) {
      sendJson(res, 500, { error: "DEEPSEEK_API_KEY is not configured in .env.local" });
      return;
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let input;
    try {
      input = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    if (!input.title?.trim()) {
      sendJson(res, 400, { error: "title is required" });
      return;
    }

    try {
      const deepseekResponse = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          temperature: 0.9,
          max_tokens: 400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: DIRECTIONS_SYSTEM_PROMPT },
            { role: "user", content: buildDirectionsUserPrompt(input) },
          ],
        }),
      });

      if (!deepseekResponse.ok) {
        const detail = await deepseekResponse.text();
        sendJson(res, 502, { error: "DeepSeek request failed", detail });
        return;
      }

      const completion = await deepseekResponse.json();
      const content = completion?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        sendJson(res, 502, { error: "Empty model response" });
        return;
      }

      let raw;
      try {
        raw = JSON.parse(content);
      } catch {
        sendJson(res, 502, { error: "Model response was not valid JSON" });
        return;
      }

      const directions = postProcessDirections(raw);
      if (!directions) {
        sendJson(res, 502, { error: "Model response had too few usable directions" });
        return;
      }

      sendJson(res, 200, { directions });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Direction generation failed",
      });
    }
    return;
  }

  if (req.url !== "/generate-report") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (!apiKey) {
    sendJson(res, 500, { error: "DEEPSEEK_API_KEY is not configured in .env.local" });
    return;
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  let input;
  try {
    input = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!input.transcript?.trim()) {
    sendJson(res, 400, { error: "transcript is required" });
    return;
  }

  try {
    const cleanedTranscript = cleanTranscriptForReport(input.transcript);
    const transcriptForModel = cleanedTranscript.trim() || input.transcript;
    const taskGoalsBlock =
      Array.isArray(input.taskGoals) && input.taskGoals.length > 0
        ? `\n\nTask goals to judge:\n${input.taskGoals.map((g) => `- [${g.id}] ${g.desc}`).join("\n")}`
        : "";

    const deepseekResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `sessionId: ${input.sessionId}\ndurationSeconds: ${input.durationSeconds}${taskGoalsBlock}\n\nTranscript (lightly cleaned for obvious ASR noise):\n${transcriptForModel}`,
          },
        ],
      }),
    });

    if (!deepseekResponse.ok) {
      const detail = await deepseekResponse.text();
      sendJson(res, 502, { error: "DeepSeek request failed", detail });
      return;
    }

    const completion = await deepseekResponse.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      sendJson(res, 502, { error: "Empty model response" });
      return;
    }

    const raw = JSON.parse(content);
    const report = postProcessReport(raw, input);

    sendJson(res, 200, report);
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Report generation failed",
    });
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`[report-server] port ${LOCAL_PORT} is already in use.`);
    process.exitCode = 1;
    return;
  }
  console.error("[report-server] server error", error);
});

server.listen(LOCAL_PORT, () => {
  console.log(`[report-server] listening on http://localhost:${LOCAL_PORT}`);
});
