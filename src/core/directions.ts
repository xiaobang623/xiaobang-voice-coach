import type { MemorySummary, TalkDirection } from "../types";
import { formatMemoryBlock } from "../config/session";

export interface FetchAiDirectionsInput {
  title: string;
  description?: string;
  promptSeed?: string;
  userMemory?: MemorySummary | null;
  userId?: string;
  guestId?: string;
  sessionId?: string;
}

/**
 * Fetch AI-generated opening talk directions for a topic/task.
 *
 * NEVER throws — any failure (network, timeout, non-2xx, bad JSON, too few
 * usable items) resolves to `null`. This is a fire-and-forget prefetch: the
 * caller (SessionOpeningGuide) silently falls back to the static
 * pickDirections() pool, so the user never sees an error or a stalled UI.
 */
export async function fetchAiDirections(input: FetchAiDirectionsInput): Promise<TalkDirection[] | null> {
  try {
    const userMemoryBlock = formatMemoryBlock(input.userMemory ?? null) || undefined;

    const response = await fetch("/api/generate-directions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        promptSeed: input.promptSeed,
        userMemoryBlock,
        userId: input.userId,
        guestId: input.guestId,
        sessionId: input.sessionId,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { directions?: TalkDirection[] };
    if (!Array.isArray(payload.directions)) {
      return null;
    }

    const valid = payload.directions.filter(
      (direction): direction is TalkDirection =>
        Boolean(direction) && typeof direction.zh === "string" && direction.zh.trim().length > 0,
    );

    return valid.length >= 3 ? valid : null;
  } catch {
    return null;
  }
}
