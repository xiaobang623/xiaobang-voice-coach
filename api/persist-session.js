import { persistSessionReportAdmin } from "./_lib/persist-session.js";

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

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  const input = await readJsonBody(req);
  if (!input || typeof input !== "object") {
    res.status(400).json({ success: false, error: "Invalid JSON body" });
    return;
  }

  const guestId = typeof input.guestId === "string" ? input.guestId.trim() : "";
  if (!guestId) {
    res.status(400).json({ success: false, error: "guestId is required" });
    return;
  }

  if (!input.sessionId || typeof input.sessionId !== "string") {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  if (!input.report || typeof input.report !== "object") {
    res.status(400).json({ success: false, error: "report is required" });
    return;
  }

  try {
    await persistSessionReportAdmin({
      sessionId: input.sessionId,
      guestId,
      topic: typeof input.topic === "string" ? input.topic : null,
      transcript: typeof input.transcript === "string" ? input.transcript : "",
      durationSeconds:
        typeof input.durationSeconds === "number" ? input.durationSeconds : null,
      report: input.report,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to persist session",
    });
  }
}
