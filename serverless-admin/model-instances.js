import { requireAdmin } from "../api/_lib/admin-auth.js";
import { setJsonCors, json } from "../api/_lib/http.js";
import { listInstanceKeys, parseModelInstances } from "../api/_lib/voice-config.js";
import { resolveSiliconFlowApiKey, siliconFlowConfigStatus } from "../api/_lib/siliconflow-voice.js";

async function fetchHealth(url) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    return { ok: true, detail: "ok", payload };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function handler(req, res) {
  setJsonCors(res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const admin = await requireAdmin(req, res);
  if (!admin) {
    return;
  }

  try {
    const registry = parseModelInstances();
    const keys = listInstanceKeys(registry);

    const whisper = await Promise.all(
      Object.entries(registry.whisper ?? {}).map(async ([key, url]) => ({
        key,
        url,
        ...(await fetchHealth(url)),
      })),
    );

    const cosyvoice = await Promise.all(
      Object.entries(registry.cosyvoice ?? {}).map(async ([key, url]) => ({
        key,
        url,
        ...(await fetchHealth(url)),
      })),
    );

    const siliconflow = siliconFlowConfigStatus(resolveSiliconFlowApiKey());

    json(res, 200, {
      success: true,
      data: {
        keys,
        whisper,
        cosyvoice,
        siliconflow,
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load model instances",
    });
  }
}
