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
