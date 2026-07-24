import { getAdminSupabase } from "./_lib/admin-supabase.js";
import { setJsonCors, readJsonBody, json } from "./_lib/http.js";

/**
 * Speaking-funnel analytics events (开口漏斗埋点).
 * Fire-and-forget from the client (src/core/analytics.ts) — this endpoint
 * validates against a whitelist and writes to app_events via service role.
 */
const ALLOWED_EVENTS = new Set([
  "app_open",
  "enter_session",
  "ready_click",
  "first_utterance",
  "session_complete",
  "session_abandon",
  "voice_error",
  "quota_hit",
  "correction_view",
  "repractice_complete",
  "growth_view",
  "memory_delete",
  "report_view",
  "repractice_start",
]);

const MAX_PROP_KEY_LENGTH = 40;
const MAX_PROP_STRING_LENGTH = 120;
const MAX_PROPS_JSON_BYTES = 2048;

/**
 * Only keep small scalar props (numbers / booleans / short strings).
 * Never store free text — transcripts must not end up in the events table.
 */
function sanitizeProps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_PROP_KEY_LENGTH) {
      continue;
    }
    if (value === null || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= MAX_PROP_STRING_LENGTH) {
      out[key] = value;
    }
  }
  try {
    if (JSON.stringify(out).length > MAX_PROPS_JSON_BYTES) {
      return {};
    }
  } catch {
    return {};
  }
  return out;
}

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

    const eventName = typeof body.eventName === "string" ? body.eventName : "";
    if (!ALLOWED_EVENTS.has(eventName)) {
      json(res, 400, { success: false, error: "Unsupported eventName" });
      return;
    }

    const userId = typeof body.userId === "string" && body.userId ? body.userId : null;
    const guestId = typeof body.guestId === "string" && body.guestId ? body.guestId : null;
    if (!userId && !guestId) {
      json(res, 400, { success: false, error: "userId or guestId is required" });
      return;
    }

    const row = {
      event_name: eventName,
      user_id: userId,
      guest_id: userId ? null : guestId,
      session_id: typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null,
      props: sanitizeProps(body.props),
    };

    const supabase = getAdminSupabase();
    const { error } = await supabase.from("app_events").insert(row);
    if (error) {
      console.warn("[app_events] insert failed:", error.message, { eventName, userId, guestId });
      json(res, 500, { success: false, error: "Failed to log event" });
      return;
    }

    json(res, 200, { success: true });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log event",
    });
  }
}
