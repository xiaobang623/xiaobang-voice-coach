import { SYSTEM_PROMPT, postProcessReport } from "../report-post-process.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "DEEPSEEK_API_KEY is not configured" },
      { status: 500, headers: corsHeaders },
    );
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  if (!input.transcript?.trim()) {
    return Response.json({ error: "transcript is required" }, { status: 400, headers: corsHeaders });
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
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `sessionId: ${input.sessionId}\ndurationSeconds: ${input.durationSeconds}\n\nTranscript:\n${input.transcript}`,
          },
        ],
      }),
    });

    if (!deepseekResponse.ok) {
      const detail = await deepseekResponse.text();
      return Response.json(
        { error: "DeepSeek request failed", detail },
        { status: 502, headers: corsHeaders },
      );
    }

    const completion = await deepseekResponse.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return Response.json({ error: "Empty model response" }, { status: 502, headers: corsHeaders });
    }

    const raw = JSON.parse(content);
    const report = postProcessReport(raw, input);
    return Response.json(report, { status: 200, headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Report generation failed" },
      { status: 500, headers: corsHeaders },
    );
  }
}
