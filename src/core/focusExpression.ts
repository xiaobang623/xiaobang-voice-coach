import type { MemorySummary, TrackedExpression, UserMemory } from "../types";

type MemoryInput = MemorySummary | UserMemory | null | undefined;

function getSummary(memory: MemoryInput): MemorySummary | null {
  if (!memory) {
    return null;
  }
  return "summary" in memory ? memory.summary : memory;
}

function dueTime(expression: TrackedExpression): number {
  // Earlier = more due. Missing nextReviewAt means "due now" → treat as 0.
  const next = expression.nextReviewAt ? new Date(expression.nextReviewAt).getTime() : 0;
  return Number.isFinite(next) ? next : 0;
}

/**
 * Pick THE single expression to carry into the current conversation as a soft
 * reuse target — the counterpart of the report's focusNextTime. We take the
 * most-due non-mastered tracked expression so the learner keeps reusing what
 * they were told to bring back, closing the learn → reuse loop.
 *
 * Returns null when there's nothing worth planting (guest with no memory, or
 * everything already mastered).
 */
export function pickFocusExpression(memory: MemoryInput): TrackedExpression | null {
  const summary = getSummary(memory);
  if (!summary || !Array.isArray(summary.trackedExpressions)) {
    return null;
  }

  const candidates = summary.trackedExpressions
    .filter((expression) => expression.status !== "mastered")
    .filter((expression) => expression.targetText.trim().length > 0);

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const diff = dueTime(left) - dueTime(right);
    if (diff !== 0) {
      return diff;
    }
    // Tie-break: the one seen longer ago is more worth resurfacing.
    return new Date(left.lastSeenAt).getTime() - new Date(right.lastSeenAt).getTime();
  })[0];
}
