import { useCallback, useRef, useState } from "react";
import type { MemorySummary, TalkDirection } from "../types";
import { fetchAiDirections } from "../core/directions";

export interface OpeningDirectionsTarget {
  /** topic id or task id — used to key the result and de-dupe requests. */
  topicId: string;
  title: string;
  description?: string;
  promptSeed?: string;
}

export interface OpeningDirectionsActor {
  userId?: string;
  guestId?: string;
  sessionId?: string;
}

/**
 * Session-scoped AI opening-direction prefetch.
 *
 * `prefetch` is called the moment the user picks a topic/task card — while the
 * "connecting" transition is happening — so the result (if any) is usually
 * ready by the time SessionOpeningGuide mounts. At most one request fires per
 * topic selection: re-entrant calls for the same topicId (e.g. a reconnect)
 * are ignored, and `reset()` (called on exiting the chat) clears the guard so
 * the next topic pick can fetch again.
 */
export function useOpeningDirections() {
  const [result, setResult] = useState<{ topicId: string; directions: TalkDirection[] } | null>(null);
  const requestedTopicIdRef = useRef<string | null>(null);

  const prefetch = useCallback(
    (
      target: OpeningDirectionsTarget | null,
      userMemory: MemorySummary | null,
      actor: OpeningDirectionsActor,
    ) => {
      if (!target || requestedTopicIdRef.current === target.topicId) {
        return;
      }
      requestedTopicIdRef.current = target.topicId;

      void (async () => {
        const directions = await fetchAiDirections({
          title: target.title,
          description: target.description,
          promptSeed: target.promptSeed,
          userMemory,
          ...actor,
        });
        if (directions) {
          setResult({ topicId: target.topicId, directions });
        }
      })();
    },
    [],
  );

  const reset = useCallback(() => {
    requestedTopicIdRef.current = null;
    setResult(null);
  }, []);

  const directionsFor = useCallback(
    (topicId: string | null): TalkDirection[] | null => {
      if (!result || !topicId || result.topicId !== topicId) {
        return null;
      }
      return result.directions;
    },
    [result],
  );

  return { prefetch, reset, directionsFor };
}
