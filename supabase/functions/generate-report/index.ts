import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  cleanTranscriptForReport,
  postProcessReport,
  SYSTEM_PROMPT,
} from "../_shared/reportPostProcess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateReportBody {
  sessionId: string;
  transcript: string;
  durationSeconds: number;
  taskGoals?: Array<{ id: string; desc: string }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: GenerateReportBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.transcript?.trim()) {
    return new Response(JSON.stringify({ error: "transcript is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const cleanedTranscript = cleanTranscriptForReport(body.transcript);
  const transcriptForModel = cleanedTranscript.trim() || body.transcript;
  const taskGoalsBlock =
    Array.isArray(body.taskGoals) && body.taskGoals.length > 0
      ? `\n\nTask goals to judge:\n${body.taskGoals.map((g) => `- [${g.id}] ${g.desc}`).join("\n")}`
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
          content: `sessionId: ${body.sessionId}\ndurationSeconds: ${body.durationSeconds}${taskGoalsBlock}\n\nTranscript (lightly cleaned for obvious ASR noise):\n${transcriptForModel}`,
        },
      ],
    }),
  });

  if (!deepseekResponse.ok) {
    const detail = await deepseekResponse.text();
    return new Response(JSON.stringify({ error: "DeepSeek request failed", detail }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const completion = await deepseekResponse.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return new Response(JSON.stringify({ error: "Empty model response" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content);
  } catch {
    return new Response(JSON.stringify({ error: "Model returned non-JSON content" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const report = postProcessReport(raw, {
    sessionId: body.sessionId,
    durationSeconds: body.durationSeconds,
    taskGoals: body.taskGoals,
  });

  return new Response(JSON.stringify(report), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
