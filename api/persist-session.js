import { readJsonBody, setJsonCors } from "./_lib/http.js";
import { persistSessionReportAdmin } from "./_lib/persist-session.js";

export default async function handler(req, res) {
  setJsonCors(res, "POST, OPTIONS");

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
      userSpeakingSeconds:
        typeof input.userSpeakingSeconds === "number" ? input.userSpeakingSeconds : null,
      userTurns: typeof input.userTurns === "number" ? input.userTurns : null,
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
