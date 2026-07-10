import { getAdminSupabase } from "./_lib/admin-supabase.js";
import { setJsonCors, json } from "./_lib/http.js";
import {
  buildVoiceProfile,
  DEFAULT_VOICE_CONFIG,
  resolveVoiceConfig,
  toModelOverrides,
} from "./_lib/voice-config.js";

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

  const context = {
    userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
    guestId: typeof req.query.guestId === "string" ? req.query.guestId : undefined,
    sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
  };

  try {
    const supabase = getAdminSupabase();
    const resolved = await resolveVoiceConfig(supabase, context);
    json(res, 200, {
      backend: resolved.backend,
      config: resolved.config,
      modelOverrides: toModelOverrides(resolved.config),
      voiceProfile: resolved.voiceProfile,
      cachedAt: resolved.cachedAt,
    });
  } catch (error) {
    console.warn("[voice-backend-config] fallback to defaults:", error);
    const voiceProfile = await buildVoiceProfile(DEFAULT_VOICE_CONFIG);
    json(res, 200, {
      backend: DEFAULT_VOICE_CONFIG.backend,
      config: DEFAULT_VOICE_CONFIG,
      modelOverrides: toModelOverrides(DEFAULT_VOICE_CONFIG),
      voiceProfile,
      cachedAt: Date.now(),
      fallback: true,
    });
  }
}
