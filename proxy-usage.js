import {
  createEmptyDoubaoUsageTotals,
  extractDoubaoUsagePayload,
  mergeDoubaoUsage,
  sumDoubaoUsageTokens,
} from "./api/_lib/doubao-usage.js";

const MessageType = {
  FULL_SERVER_RESPONSE: 0b1001,
};

const SerializationMethod = {
  JSON: 0b0001,
};

export const EventReceive = {
  UsageResponse: 154,
};

export function parseUsageContext(requestUrl) {
  try {
    const url = new URL(requestUrl ?? "/", "http://localhost");
    const userId = url.searchParams.get("userId");
    const guestId = url.searchParams.get("guestId");
    const sessionId = url.searchParams.get("sessionId");
    return {
      userId: userId || null,
      guestId: guestId || null,
      sessionId: sessionId || null,
    };
  } catch {
    return { userId: null, guestId: null, sessionId: null };
  }
}

export function parseJsonServerEvent(data, isBinary) {
  if (!isBinary) {
    return null;
  }

  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.length < 12) {
    return null;
  }

  const messageType = (bytes[1] >> 4) & 0x0f;
  const serializationMethod = (bytes[2] >> 4) & 0x0f;
  if (messageType !== MessageType.FULL_SERVER_RESPONSE) {
    return null;
  }
  if (serializationMethod !== SerializationMethod.JSON) {
    return null;
  }

  const eventId = bytes.readUInt32BE(4);
  const fieldAt8 = bytes.readUInt32BE(8);

  let payloadLength = 0;
  let payloadStart = 0;
  const cursorWithSession = 12 + fieldAt8;
  if (cursorWithSession + 4 <= bytes.length) {
    payloadLength = bytes.readUInt32BE(cursorWithSession);
    payloadStart = cursorWithSession + 4;
  } else {
    payloadLength = fieldAt8;
    payloadStart = 12;
  }

  const safePayloadLength = Math.max(0, Math.min(payloadLength, bytes.length - payloadStart));
  if (safePayloadLength <= 0) {
    return null;
  }

  try {
    const payload = JSON.parse(bytes.slice(payloadStart, payloadStart + safePayloadLength).toString("utf8"));
    return { eventId, payload };
  } catch {
    return null;
  }
}

export function createUsageTracker(context) {
  const totals = createEmptyDoubaoUsageTotals();
  let logged = false;

  return {
    recordFrame(data, isBinary) {
      const parsed = parseJsonServerEvent(data, isBinary);
      if (!parsed || parsed.eventId !== EventReceive.UsageResponse) {
        return;
      }

      const usage = extractDoubaoUsagePayload(parsed.payload);
      if (!usage) {
        return;
      }

      Object.assign(totals, mergeDoubaoUsage(totals, usage));
    },

    async flush({ durationSeconds = null } = {}) {
      if (logged) {
        return;
      }

      const tokensUsed = sumDoubaoUsageTokens(totals);
      const hasActor = Boolean(context.userId || context.guestId);
      if (!hasActor) {
        return;
      }

      if (tokensUsed <= 0 && (!durationSeconds || durationSeconds <= 0)) {
        return;
      }

      const baseUrl = process.env.USAGE_LOG_BASE_URL ?? "https://xiaobang-voice-coach.vercel.app";
      const body = {
        userId: context.userId,
        guestId: context.guestId,
        sessionId: context.sessionId,
        apiProvider: "doubao",
        modelName: "volc.speech.dialog",
        tokensUsed: tokensUsed > 0 ? tokensUsed : 0,
        durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
      };

      logged = true;

      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/log-usage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const detail = await response.text();
          console.warn("[proxy] usage log failed:", response.status, detail);
          logged = false;
        }
      } catch (error) {
        logged = false;
        console.warn("[proxy] usage log failed:", error instanceof Error ? error.message : error);
      }
    },
  };
}
