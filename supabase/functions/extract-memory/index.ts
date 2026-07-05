import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { MEMORY_SYSTEM_PROMPT, postProcessMemory } from "../_shared/memoryPostProcess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractMemoryBody {
  transcript: string;
  report?: Record<string, unknown>;
  previousSummary?: Record<string, unknown> | null;
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

  let body: ExtractMemoryBody;
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

  const previousBlock = body.previousSummary
    ? `Previous profile:\n${JSON.stringify(body.previousSummary, null, 2)}\n\n`
    : "";
  const reportBlock = body.report ? `Latest report:\n${JSON.stringify(body.report, null, 2)}\n\n` : "";

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
          content: `${previousBlock}${reportBlock}Transcript:\n${body.transcript}`,
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

  const memory = postProcessMemory(raw);

  return new Response(JSON.stringify(memory), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
