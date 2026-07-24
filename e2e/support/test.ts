import { test as base, expect, type Page, type Route } from "@playwright/test";
import { readFixture } from "./fixtures";

const REGISTERED_USER_ID = "registered-user-1";
const STORAGE_KEY = "sb-127-auth-token";

function isExpectedBrowserNoise(text: string): boolean {
  return [
    "favicon.ico",
    "apple-mobile-web-app-capable",
    "ResizeObserver loop completed",
    "Voice disconnected, retrying connection once.",
  ].some((part) => text.includes(part));
}

export const test = base.extend<{ assertNoBrowserErrors: void }>({
  assertNoBrowserErrors: [async ({ page }, use) => {
    const errors: string[] = [];

    page.on("console", (message) => {
      if (message.type() !== "error") {
        return;
      }
      const text = message.text();
      if (!isExpectedBrowserNoise(text)) {
        errors.push(`[console] ${text}`);
      }
    });

    page.on("pageerror", (error) => {
      const text = error.message || String(error);
      if (!isExpectedBrowserNoise(text)) {
        errors.push(`[pageerror] ${text}`);
      }
    });

    await use();

    expect(errors, "unexpected browser console/runtime errors").toEqual([]);
  }, { auto: true }],
});

export { expect };

export function buildSession(user: "guest" | "registered" = "guest") {
  const isGuest = user === "guest";
  const id = isGuest ? "anonymous-user-1" : REGISTERED_USER_ID;
  const email = isGuest ? undefined : "yafei@example.com";
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  return {
    access_token: `${user}-access-token`,
    refresh_token: `${user}-refresh-token`,
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email,
      phone: "",
      app_metadata: {},
      user_metadata: {},
      identities: isGuest
        ? []
        : [
            {
              id,
              user_id: id,
              identity_data: { email },
              provider: "email",
              created_at: "2026-07-24T09:00:00.000Z",
              updated_at: "2026-07-24T09:00:00.000Z",
            },
          ],
      is_anonymous: isGuest,
      created_at: "2026-07-24T09:00:00.000Z",
      updated_at: "2026-07-24T09:00:00.000Z",
    },
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function setupCoreApiMocks(page: Page) {
  await page.route("**/api/check-quota", (route) =>
    fulfillJson(route, { success: true, allowed: true, used: 0, limit: 3, remaining: 3 }),
  );

  await page.route("**/api/issue-voice-token", (route) =>
    fulfillJson(route, {
      success: true,
      allowed: true,
      token: "e2e-voice-token",
      used: 0,
      limit: 3,
      remaining: 3,
      actor: "guest",
    }),
  );

  await page.route("**/api/log-event", (route) => fulfillJson(route, { success: true }));
  await page.route("**/api/persist-session", (route) => fulfillJson(route, { success: true }));
  await page.route("**/api/generate-directions", (route) =>
    fulfillJson(route, {
      directions: [
        { zh: "今天最想分享的一件事", en: "One thing I want to share today is..." },
        { zh: "今天有点卡住的瞬间", en: "One tricky moment today was..." },
        { zh: "今晚怎么放松", en: "Tonight, I plan to..." },
      ],
    }),
  );

  await page.route("**/api/voice-backend-config**", (route) =>
    fulfillJson(route, {
      backend: "selfhosted",
      config: {
        backend: "selfhosted",
        selfhosted: {
          asrProvider: "siliconflow-sensevoice",
          ttsProvider: "siliconflow-cosyvoice",
          siliconflowTtsVoice: "diana",
        },
      },
      voiceProfile: {
        provider: "siliconflow-cosyvoice",
        defaultVoice: "diana",
        voices: [
          { id: "diana", label: "Diana" },
          { id: "benjamin", label: "Benjamin" },
        ],
      },
    }),
  );
}

export async function setupSupabaseMocks(page: Page) {
  await page.route("**/e2e-supabase/auth/v1/signup", async (route) => {
    const post = route.request().postDataJSON() as Record<string, unknown> | null;
    const isEmailSignup = typeof post?.email === "string";
    await fulfillJson(route, buildSession(isEmailSignup ? "registered" : "guest"));
  });

  await page.route("**/e2e-supabase/auth/v1/token**", (route) =>
    fulfillJson(route, buildSession("registered")),
  );

  await page.route("**/e2e-supabase/auth/v1/logout**", (route) =>
    fulfillJson(route, {}),
  );

  await page.route("**/e2e-supabase/auth/v1/user**", (route) => {
    const auth = route.request().headers().authorization ?? "";
    const registered = auth.includes("registered-access-token");
    return fulfillJson(route, buildSession(registered ? "registered" : "guest").user);
  });

  await page.route("**/e2e-supabase/rest/v1/profiles**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return fulfillJson(route, { nickname: "雅菲", preferences: {} });
    }
    return fulfillJson(route, [{ id: REGISTERED_USER_ID }], 201);
  });

  await page.route("**/e2e-supabase/rest/v1/sessions**", (route) => {
    if (route.request().method() !== "GET") {
      return fulfillJson(route, [], 201);
    }
    return fulfillJson(route, [
      {
        created_at: "2026-07-23T10:30:00.000Z",
        duration_seconds: 240,
        user_speaking_seconds: 90,
        topic: "food",
      },
      {
        created_at: "2026-07-24T10:30:00.000Z",
        duration_seconds: 180,
        user_speaking_seconds: 60,
        topic: "daily",
      },
    ]);
  });

  await page.route("**/e2e-supabase/rest/v1/reports**", (route) => {
    const readyReport = readFixture<Record<string, unknown>>("report-ready.json");
    if (route.request().method() !== "GET") {
      return fulfillJson(route, [], 201);
    }
    const url = route.request().url();
    if (url.includes("payload")) {
      return fulfillJson(route, { payload: readyReport });
    }
    return fulfillJson(route, [
      {
        created_at: "2026-07-24T10:30:00.000Z",
        session_id: "hist-1",
        summary: {
          sessionId: "hist-1",
          createdAt: "2026-07-24T10:30:00.000Z",
          userLevel: "intermediate",
          correctionCount: 1,
          corrections: [
            {
              original: "I very like coffee",
              corrected: "I really like coffee",
              type: "collocation",
              count: 1,
            },
          ],
        },
        sessions: { topic: "daily", duration_seconds: 180, user_speaking_seconds: 60, user_turns: 4 },
      },
    ]);
  });

  await page.route("**/e2e-supabase/rest/v1/memory**", (route) => {
    const growth = readFixture<{ memory: unknown; trackedExpressions: unknown[] }>("growth-data.json");
    if (route.request().method() !== "GET") {
      return fulfillJson(route, [], 201);
    }
    return fulfillJson(route, {
      summary: {
        ...(growth.memory as { summary: Record<string, unknown> }).summary,
        trackedExpressions: growth.trackedExpressions,
      },
      entries: (growth.memory as { entries: unknown[] }).entries,
    });
  });
}

export async function setupAdminApiMocks(page: Page) {
  const admin = readFixture<Record<string, unknown>>("admin-data.json");
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/login")) {
      return fulfillJson(route, { success: true, token: "e2e-admin", role: "admin", username: "e2e-admin" });
    }
    if (path.endsWith("/auth/logout")) {
      return fulfillJson(route, { success: true });
    }
    if (path.endsWith("/me")) {
      return fulfillJson(route, { success: true, data: admin.me });
    }
    if (path.endsWith("/dashboard-summary")) {
      return fulfillJson(route, { success: true, data: admin.summary });
    }
    if (path.endsWith("/funnel-summary")) {
      return fulfillJson(route, { success: true, data: admin.funnel });
    }
    if (path.endsWith("/users")) {
      return fulfillJson(route, { success: true, data: admin.users, pagination: { page: 1, limit: 20, total: 1 } });
    }
    if (path.endsWith("/sessions")) {
      return fulfillJson(route, { success: true, data: admin.sessions, pagination: { page: 1, limit: 20, total: 1 } });
    }
    if (path.endsWith("/token-summary")) {
      return fulfillJson(route, { success: true, data: admin.tokenSummary });
    }
    if (path.endsWith("/voice-config")) {
      return fulfillJson(route, { success: true, data: admin.voiceConfig });
    }
    if (path.endsWith("/model-instances")) {
      return fulfillJson(route, { success: true, data: admin.modelInstances });
    }
    return fulfillJson(route, { success: true, data: null });
  });
}

export async function setupAppMocks(page: Page) {
  await setupCoreApiMocks(page);
  await setupSupabaseMocks(page);
  await mockSelfHostedVoiceSocket(page);
}

export async function gotoApp(page: Page, path = "/") {
  await setupAppMocks(page);
  await page.goto(path);
  await expect(page.getByText("准备好开口了吗")).toBeVisible();
}

export async function seedRegisteredUser(page: Page) {
  const growthData = readFixture<unknown>("growth-data.json");
  await page.addInitScript(({ storageKey, session, cache }) => {
    for (const key of storageKey) {
      window.localStorage.setItem(key, JSON.stringify(session));
    }
    window.localStorage.setItem(
      "xiaobang-growth-cache",
      JSON.stringify({ userId: session.user.id, fetchedAt: Date.now(), data: cache }),
    );
  }, { storageKey: [STORAGE_KEY, "sb-127.0.0.1-auth-token", "sb-localhost-auth-token"], session: buildSession("registered"), cache: growthData });
}

export async function mockSelfHostedVoiceSocket(page: Page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const voiceSockets: Array<{ emitMessage: (payload: unknown, delay: number) => void; readyState: number }> = [];
    (window as unknown as { __e2eEmitVoiceTurn?: () => void }).__e2eEmitVoiceTurn = () => {
      for (const socket of voiceSockets) {
        if (socket.readyState !== 1) continue;
        socket.emitMessage({ type: "transcript", text: "Today has been pretty busy.", isFinal: true }, 0);
        socket.emitMessage({ type: "bot-message", text: "Mock coach reply: tell me one more detail.", isFinal: false }, 20);
        socket.emitMessage({ type: "bot-message", text: "Mock coach reply: tell me one more detail.", isFinal: true }, 40);
      }
    };
    class E2EVoiceWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      CONNECTING = 0;
      OPEN = 1;
      CLOSING = 2;
      CLOSED = 3;
      url: string;
      readyState = 0;
      binaryType = "blob";
      protocol = "";
      extensions = "";
      bufferedAmount = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      private listeners: Record<string, Array<(event: Event) => void>> = {};

      constructor(url: string | URL) {
        this.url = String(url);
        if (!this.url.includes("localhost:8081/ws")) {
          return new NativeWebSocket(url) as unknown as E2EVoiceWebSocket;
        }
        voiceSockets.push(this);
        window.setTimeout(() => {
          this.readyState = E2EVoiceWebSocket.OPEN;
          const event = new Event("open");
          this.onopen?.(event);
          this.dispatch("open", event);
        }, 10);
      }

      addEventListener(type: string, listener: (event: Event) => void) {
        this.listeners[type] = this.listeners[type] ?? [];
        this.listeners[type].push(listener);
      }

      removeEventListener(type: string, listener: (event: Event) => void) {
        this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener);
      }

      dispatch(type: string, event: Event) {
        for (const listener of this.listeners[type] ?? []) {
          listener(event);
        }
      }

      send(data: string | ArrayBuffer | Blob | ArrayBufferView) {
        if (typeof data !== "string") {
          return;
        }
        let payload: { type?: string; text?: string } = {};
        try {
          payload = JSON.parse(data) as { type?: string; text?: string };
        } catch {
          return;
        }
        if (payload.type === "start") {
          this.emitMessage({ type: "ready" }, 20);
          return;
        }
        if (payload.type === "text-query") {
          const reply = "Mock coach reply: tell me one more detail.";
          this.emitMessage({ type: "bot-message", text: reply, isFinal: false }, 20);
          this.emitMessage({ type: "bot-message", text: reply, isFinal: true }, 40);
          return;
        }
      }

      emitMessage(payload: unknown, delay: number) {
        window.setTimeout(() => {
          if (this.readyState !== E2EVoiceWebSocket.OPEN) {
            return;
          }
          const event = new MessageEvent("message", { data: JSON.stringify(payload) });
          this.onmessage?.(event);
          this.dispatch("message", event);
        }, delay);
      }

      close(code = 1000, reason = "") {
        this.readyState = E2EVoiceWebSocket.CLOSED;
        const event = new CloseEvent("close", { code, reason, wasClean: true });
        this.onclose?.(event);
        this.dispatch("close", event);
      }

      dispatchEvent(event: Event) {
        this.dispatch(event.type, event);
        return true;
      }
    }
    window.WebSocket = E2EVoiceWebSocket as unknown as typeof WebSocket;
  });
}

export async function startMockedTypingConversation(page: Page) {
  await page.getByRole("button", { name: "今天过得怎么样" }).click();
  await expect(page.getByText("开口准备")).toBeVisible();
  await expect(page.getByRole("button", { name: "我准备好了" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "我准备好了" }).click();
  await expect(page.getByText("麦克风开着 · 随时开口")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    (window as unknown as { __e2eEmitVoiceTurn?: () => void }).__e2eEmitVoiceTurn?.();
  });
  await expect(page.getByText("Today has been pretty busy.")).toBeVisible();
  await expect(page.getByText(/Mock coach reply/)).toBeVisible();
}
