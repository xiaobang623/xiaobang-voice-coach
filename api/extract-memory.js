import { MEMORY_SYSTEM_PROMPT, postProcessMemory } from "../memory-post-process.js";
import { extractDeepseekUsage, logTokenUsage } from "./_lib/token-cost.js";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function compactMemoryForPrompt(summary) {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  return {
    userLevel: summary.userLevel,
    topics: Array.isArray(summary.topics) ? summary.topics : [],
    frequentMistakes: Array.isArray(summary.frequentMistakes) ? summary.frequentMistakes : [],
    coachNotes: summary.coachNotes ?? summary.notes ?? "",
    updatedAt: summary.updatedAt,
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "DEEPSEEK_API_KEY is not configured" });
    return;
  }

  const input = await readJsonBody(req);
  if (!input || typeof input !== "object") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (!input.transcript?.trim()) {
    res.status(400).json({ error: "transcript is required" });
    return;
  }

  const compactPreviousSummary = compactMemoryForPrompt(input.previousSummary);
  const previousBlock = compactPreviousSummary
    ? `Previous profile:\n${JSON.stringify(compactPreviousSummary, null, 2)}\n\n`
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
      res.status(502).json({ error: "DeepSeek request failed", detail });
      return;
    }

    const completion = await deepseekResponse.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      res.status(502).json({ error: "Empty model response" });
      return;
    }

    const tokensUsed = extractDeepseekUsage(completion);
    if (input.userId || input.guestId) {
      await logTokenUsage({
        userId: input.userId ?? null,
        guestId: input.guestId ?? null,
        apiProvider: "deepseek",
        modelName: "deepseek-chat",
        tokensUsed,
        sessionId: input.sessionId ?? null,
      });
    }

    const raw = JSON.parse(content);
    res.status(200).json(
      postProcessMemory(raw, {
        report: input.report,
        previousSummary: input.previousSummary,
        ownerKey: input.userId ?? input.guestId ?? "memory",
      }),
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Memory extraction failed",
    });
  }
}
