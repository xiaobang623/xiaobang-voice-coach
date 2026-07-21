import {
  DIRECTIONS_SYSTEM_PROMPT,
  buildDirectionsUserPrompt,
  postProcessDirections,
} from "../directions-post-process.js";
import { readJsonBody, setJsonCors } from "./_lib/http.js";
import { extractDeepseekUsage, logTokenUsage } from "./_lib/token-cost.js";

/**
 * One-shot AI opening-direction generation for a chosen topic/task. Fired the
 * moment the user picks a topic card (see src/core/directions.ts), while the
 * connecting transition is happening — never blocks the opening guide card.
 * Failure here is expected to be silent: the frontend falls back to the static
 * pickDirections() pool and never surfaces an error to the user.
 */
export default async function handler(req, res) {
  setJsonCors(res, "POST, OPTIONS");

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

  let input;
  try {
    input = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (!input || typeof input !== "object") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (typeof input.title !== "string" || !input.title.trim()) {
    res.status(400).json({ error: "title is required" });
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

    let raw;
    try {
      raw = JSON.parse(content);
    } catch {
      res.status(502).json({ error: "Model response was not valid JSON" });
      return;
    }

    const directions = postProcessDirections(raw);
    if (!directions) {
      res.status(502).json({ error: "Model response had too few usable directions" });
      return;
    }

    res.status(200).json({ directions });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Direction generation failed",
    });
  }
}
