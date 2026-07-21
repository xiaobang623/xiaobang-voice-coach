import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { MEMORY_SYSTEM_PROMPT, postProcessMemory } from "../_shared/memoryPostProcess.ts";

// Supabase Edge Function is the backup extraction path.
// It stays in sync with the primary Vercel api/extract-memory.js memory-v2 shape:
// request includes previousSummary / previousEntries / sessionId, response is { summary, entries }.
// Keep VITE_USE_SUPABASE_FUNCTIONS=false unless intentionally testing the backup path.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractMemoryBody {
  transcript: string;
  report?: Record<string, unknown>;
  previousSummary?: Record<string, unknown> | null;
  previousEntries?: Record<string, unknown>[] | null;
  sessionId?: string;
  userId?: string;
  guestId?: string;
}

function compactMemoryForPrompt(summary: Record<string, unknown> | null | undefined) {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  return {
    userLevel: summary.userLevel,
    topics: Array.isArray(summary.topics) ? summary.topics : [],
    frequentMistakes: Array.isArray(summary.frequentMistakes) ? summary.frequentMistakes : [],
    personalFacts: Array.isArray(summary.personalFacts) ? summary.personalFacts : [],
    coachNotes: summary.coachNotes ?? summary.notes ?? "",
    updatedAt: summary.updatedAt,
  };
}

function compactEntriesForPrompt(entries: Record<string, unknown>[] | null | undefined) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => ({
      sessionId: entry?.sessionId,
      topic: entry?.topic ?? "",
      highlights: entry?.highlights ?? "",
      mistakes: entry?.mistakes ?? "",
      storyNotes: entry?.storyNotes ?? "",
      createdAt: entry?.createdAt,
    }))
    .filter((entry) => entry.sessionId || entry.topic || entry.storyNotes)
    .slice(-20);
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

  const compactPreviousSummary = compactMemoryForPrompt(body.previousSummary);
  const compactPreviousEntries = compactEntriesForPrompt(body.previousEntries);
  const archiveCandidate =
    compactPreviousEntries.length >= 20 ? compactPreviousEntries[0] : null;
  const previousBlock = compactPreviousSummary
    ? `Previous profile:\n${JSON.stringify(compactPreviousSummary, null, 2)}\n\n`
    : "";
  const entriesBlock =
    compactPreviousEntries.length > 0
      ? `Recent memory entries (oldest to newest):\n${JSON.stringify(compactPreviousEntries, null, 2)}\n\n`
      : "";
  const archiveBlock = archiveCandidate
    ? `Entry likely to be archived after adding this session:\n${JSON.stringify(archiveCandidate, null, 2)}\n\n`
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
          content: `${previousBlock}${entriesBlock}${archiveBlock}${reportBlock}Session ID: ${body.sessionId ?? ""}\nTranscript:\n${body.transcript}`,
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

  const memory = postProcessMemory(raw, {
    report: body.report,
    previousSummary: body.previousSummary,
    previousEntries: body.previousEntries,
    sessionId: body.sessionId,
    ownerKey: body.userId ?? body.guestId ?? "memory",
  });

  return new Response(JSON.stringify(memory), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
