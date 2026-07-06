import { logTokenUsage } from "./_lib/token-cost.js";
import { setJsonCors, readJsonBody, json } from "./_lib/http.js";

export default async function handler(req, res) {
  setJsonCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      json(res, 400, { success: false, error: "Invalid JSON body" });
      return;
    }

    const userId = typeof body.userId === "string" ? body.userId : null;
    const guestId = typeof body.guestId === "string" ? body.guestId : null;
    const apiProvider = body.apiProvider;
    const modelName = typeof body.modelName === "string" ? body.modelName : "";

    if (!userId && !guestId) {
      json(res, 400, { success: false, error: "userId or guestId is required" });
      return;
    }

    if (apiProvider !== "deepseek" && apiProvider !== "doubao") {
      json(res, 400, { success: false, error: "Unsupported apiProvider" });
      return;
    }

    if (!modelName) {
      json(res, 400, { success: false, error: "modelName is required" });
      return;
    }

    const tokensUsed = Number(body.tokensUsed ?? 0);
    const durationSeconds = body.durationSeconds == null ? null : Number(body.durationSeconds);

    if (apiProvider === "deepseek" && (!Number.isFinite(tokensUsed) || tokensUsed <= 0)) {
      json(res, 400, { success: false, error: "tokensUsed is required for deepseek" });
      return;
    }

    if (apiProvider === "doubao" && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
      json(res, 400, { success: false, error: "durationSeconds is required for doubao" });
      return;
    }

    await logTokenUsage({
      userId,
      guestId,
      apiProvider,
      modelName,
      tokensUsed: Number.isFinite(tokensUsed) ? tokensUsed : 0,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
    });

    json(res, 200, { success: true });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log usage",
    });
  }
}
