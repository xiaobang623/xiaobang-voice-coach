import { getGuestId } from "./guestId";

export interface LogApiUsageInput {
  userId?: string | null;
  guestId?: string | null;
  sessionId?: string | null;
  apiProvider: "deepseek" | "doubao";
  modelName: string;
  tokensUsed?: number;
  durationSeconds?: number;
}

export function resolveUsageActor(input: { userId?: string | null; guestId?: string | null }) {
  if (input.userId) {
    return { userId: input.userId, guestId: null as string | null };
  }
  return { userId: null, guestId: input.guestId ?? getGuestId() };
}

export async function logApiUsage(input: LogApiUsageInput): Promise<void> {
  const actor = resolveUsageActor(input);
  if (!actor.userId && !actor.guestId) {
    return;
  }

  try {
    const response = await fetch("/api/log-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: actor.userId,
        guestId: actor.guestId,
        sessionId: input.sessionId ?? null,
        apiProvider: input.apiProvider,
        modelName: input.modelName,
        tokensUsed: input.tokensUsed ?? 0,
        durationSeconds: input.durationSeconds ?? null,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn("[usage] log failed:", detail || response.status);
    }
  } catch (error) {
    console.warn("[usage] log failed:", error instanceof Error ? error.message : error);
  }
}
