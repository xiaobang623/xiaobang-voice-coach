import { getGuestId } from "./guestId";

/**
 * Speaking-funnel analytics (开口漏斗埋点).
 *
 * Design rules:
 * - Fire-and-forget: failures are swallowed; analytics must NEVER break the app.
 * - No free text in props (numbers / booleans / short enums only) — transcripts
 *   must not leak into the events table. The server re-sanitizes anyway.
 * - `trackEventOnce` guards against React StrictMode double effects and
 *   re-renders firing the same funnel step twice.
 */

export type AppEventName =
  | "app_open"
  | "enter_session"
  | "ready_click"
  | "first_utterance"
  | "session_complete"
  | "session_abandon"
  | "voice_error"
  | "quota_hit"
  | "report_view"
  | "repractice_start";

export interface TrackEventInput {
  userId?: string | null;
  guestId?: string | null;
  sessionId?: string | null;
  props?: Record<string, string | number | boolean | null>;
}

export type TrackEventProps = Record<string, string | number | boolean | null>;

interface AnalyticsContext {
  userId?: string | null;
  guestId?: string | null;
  sessionId?: string | null;
}

const firedKeys = new Set<string>();
let currentContext: AnalyticsContext = {};

export function setAnalyticsContext(context: AnalyticsContext): void {
  currentContext = { ...currentContext, ...context };
}

function isTrackEventInput(value: TrackEventInput | TrackEventProps): value is TrackEventInput {
  return (
    Object.prototype.hasOwnProperty.call(value, "userId") ||
    Object.prototype.hasOwnProperty.call(value, "guestId") ||
    Object.prototype.hasOwnProperty.call(value, "sessionId") ||
    Object.prototype.hasOwnProperty.call(value, "props")
  );
}

export function trackEvent(name: AppEventName, props?: TrackEventProps): void;
export function trackEvent(name: AppEventName, input?: TrackEventInput): void;
export function trackEvent(
  name: AppEventName,
  inputOrProps: TrackEventInput | TrackEventProps = {},
): void {
  try {
    const legacyInput = isTrackEventInput(inputOrProps) ? inputOrProps : null;
    const props = legacyInput ? (legacyInput.props ?? {}) : inputOrProps;
    const userId = legacyInput?.userId ?? currentContext.userId ?? null;
    const guestId = userId
      ? null
      : (legacyInput?.guestId ?? currentContext.guestId ?? getGuestId());
    if (!userId && !guestId) {
      return;
    }

    void fetch("/api/log-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive lets the request survive page transitions/unloads.
      keepalive: true,
      body: JSON.stringify({
        eventName: name,
        userId,
        guestId,
        sessionId: legacyInput?.sessionId ?? currentContext.sessionId ?? null,
        props,
      }),
    }).catch(() => {
      /* analytics is best-effort */
    });
  } catch {
    /* analytics must never throw into the app */
  }
}

/**
 * Fire an event at most once per page load for the given key.
 * Use a session-scoped key (e.g. `ready_click:${sessionId}`) so a new
 * practice session can log the same step again.
 */
export function trackEventOnce(key: string, name: AppEventName, input: TrackEventInput = {}): void {
  if (firedKeys.has(key)) {
    return;
  }
  firedKeys.add(key);
  trackEvent(name, input);
}
