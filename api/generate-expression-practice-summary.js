import {
  EXPRESSION_PRACTICE_SUMMARY_SYSTEM_PROMPT,
  buildExpressionPracticeSummaryUserPrompt,
  postProcessExpressionPracticeSummary,
} from "../expression-practice-summary-post-process.js";
import { readJsonBody, setJsonCors } from "./_lib/http.js";
import { extractDeepseekUsage, logTokenUsage } from "./_lib/token-cost.js";

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

  const input = await readJsonBody(req);
  if (!input || typeof input !== "object") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (!Array.isArray(input.targetExpressions) || input.targetExpressions.length === 0) {
    res.status(400).json({ error: "targetExpressions is required" });
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
        temperature: 0.25,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXPRESSION_PRACTICE_SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: buildExpressionPracticeSummaryUserPrompt(input) },
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
    res.status(200).json(postProcessExpressionPracticeSummary(raw, input));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Expression practice summary failed",
    });
  }
}
