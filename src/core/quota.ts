import { getGuestId } from "./guestId";

/**
 * C3 成本/滥用护栏 · 前端查询封装。
 *
 * fail-open 原则：接口失败 / 超时 / 返回异常时一律返回 null，
 * 调用方把 null 当"放行"处理——护栏故障绝不能挡住正常用户开口。
 */
export interface GuestQuotaStatus {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

export interface VoiceTokenResult {
  allowed: boolean;
  /** Signed proxy-auth token; null when quota exceeded or when the server has no secret configured. */
  token: string | null;
  used: number;
  limit: number | null;
  remaining: number | null;
  actor: "user" | "guest";
}

/**
 * 连语音代理前换一个短时鉴权 token（同时再查一次额度）。
 *
 * fail-open：接口失败/超时/异常时返回 { allowed: true, token: null }——
 * 拿不到 token 不是「拒绝用户」，而是交给 proxy 决定（proxy 未配密钥时照常放行；
 * 配了密钥且我们后端挂了时整个 app 本就不可用，proxy 拒连可接受）。
 */
export async function issueVoiceToken(params: {
  userId?: string | null;
  guestId?: string | null;
  anonUserId?: string | null;
  sessionId?: string | null;
}): Promise<VoiceTokenResult> {
  const failOpen: VoiceTokenResult = {
    allowed: true,
    token: null,
    used: 0,
    limit: null,
    remaining: null,
    actor: params.userId ? "user" : "guest",
  };
  try {
    const response = await fetch("/api/issue-voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.userId ?? null,
        guestId: params.guestId ?? getGuestId(),
        anonUserId: params.anonUserId ?? null,
        sessionId: params.sessionId ?? null,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return failOpen;
    }
    const data = (await response.json()) as Partial<VoiceTokenResult> & { success?: boolean };
    if (!data?.success || typeof data.allowed !== "boolean") {
      return failOpen;
    }
    return {
      allowed: data.allowed,
      token: typeof data.token === "string" ? data.token : null,
      used: typeof data.used === "number" ? data.used : 0,
      limit: typeof data.limit === "number" ? data.limit : null,
      remaining: typeof data.remaining === "number" ? data.remaining : null,
      actor: data.actor === "user" ? "user" : "guest",
    };
  } catch {
    return failOpen;
  }
}

export async function fetchGuestQuota(
  guestId?: string | null,
  anonUserId?: string | null,
): Promise<GuestQuotaStatus | null> {
  try {
    const response = await fetch("/api/check-quota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestId: guestId ?? getGuestId(),
        // 匿名 auth 游客的埋点按匿名 uid 记录，一并传给后端做双 id 计数
        anonUserId: anonUserId ?? null,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Partial<GuestQuotaStatus> & { success?: boolean };
    if (!data?.success || typeof data.allowed !== "boolean") {
      return null;
    }

    return {
      allowed: data.allowed,
      used: typeof data.used === "number" ? data.used : 0,
      limit: typeof data.limit === "number" ? data.limit : 3,
      remaining: typeof data.remaining === "number" ? data.remaining : 0,
    };
  } catch {
    return null;
  }
}
