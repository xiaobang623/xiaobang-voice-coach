import type {
  BotMessageEvent,
  RealtimeHintEvent,
  TranscriptEvent,
  VoiceAdapter,
  VoiceConfig,
} from "./types";

const WS_URL = import.meta.env.VITE_SELFHOSTED_VOICE_URL ?? "ws://localhost:8081/ws";
const CONNECT_TIMEOUT_MS = 15_000;

type AdapterEvent = "transcript" | "bot-message" | "tts-audio" | "realtime-hint" | "error";

export class SelfHostedVoiceAdapter implements VoiceAdapter {
  private socket: WebSocket | null = null;
  private config: VoiceConfig | null = null;
  private readonly handlers: Record<
    AdapterEvent,
    Set<(payload: TranscriptEvent | BotMessageEvent | ArrayBuffer | RealtimeHintEvent | Error) => void>
  > = {
    transcript: new Set(),
    "bot-message": new Set(),
    "tts-audio": new Set(),
    "realtime-hint": new Set(),
    error: new Set(),
  };
  private isManualDisconnect = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 1;
  private connectPromise: Promise<void> | null = null;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((reason?: unknown) => void) | null = null;
  /** Keeps JSON control frames in socket arrival order (Blob path only). */
  private jsonMessageQueue: Promise<void> = Promise.resolve();

  private clearConnectTimeout(): void {
    if (this.connectTimeoutId !== null) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
  }

  async connect(config: VoiceConfig): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.config = config;
    this.isManualDisconnect = false;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
      this.connectTimeoutId = setTimeout(() => {
        this.rejectConnect?.(new Error("自建语音服务连接超时，请检查 backend/server.js 是否已启动。"));
        this.clearConnectTimeout();
        this.isManualDisconnect = true;
        this.socket?.close();
        this.socket = null;
      }, CONNECT_TIMEOUT_MS);
      this.openSocket(config);
    });

    try {
      await this.connectPromise;
    } finally {
      this.clearConnectTimeout();
      this.connectPromise = null;
      this.resolveConnect = null;
      this.rejectConnect = null;
    }
  }

  disconnect(): void {
    this.isManualDisconnect = true;
    this.reconnectAttempts = 0;

    if (!this.socket) {
      return;
    }

    try {
      this.socket.close(1000, "client disconnect");
    } finally {
      this.socket = null;
    }
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(chunk);
    } catch (error) {
      this.emitError(error);
    }
  }

  endAsr(source: "silence" | "stop" = "silence"): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(JSON.stringify({ type: "end-turn", source }));
    } catch (error) {
      this.emitError(error);
    }
  }

  sendTextQuery(text: string): void {
    const content = text.trim();
    if (!content || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(JSON.stringify({ type: "text-query", text: content }));
    } catch (error) {
      this.emitError(error);
    }
  }

  sayHello(text: string): void {
    const content = text.trim();
    if (!content || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.socket.send(JSON.stringify({ type: "say-hello", text: content }));
    } catch (error) {
      this.emitError(error);
    }
  }

  on(
    event: AdapterEvent,
    handler: (payload: TranscriptEvent | BotMessageEvent | ArrayBuffer | RealtimeHintEvent | Error) => void,
  ): void {
    this.handlers[event].add(handler);
  }

  private buildSocketUrl(config: VoiceConfig): string {
    try {
      const url = new URL(WS_URL);
      if (config.userId) {
        url.searchParams.set("userId", config.userId);
      }
      if (config.guestId) {
        url.searchParams.set("guestId", config.guestId);
      }
      if (config.sessionId) {
        url.searchParams.set("sessionId", config.sessionId);
      }
      return url.toString();
    } catch {
      return WS_URL;
    }
  }

  private openSocket(config: VoiceConfig): void {
    const socket = new WebSocket(this.buildSocketUrl(config));
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "start",
          sessionId: config.sessionId,
          userId: config.userId,
          guestId: config.guestId,
          voiceType: config.voiceType,
          speedRatio: config.speedRatio,
          systemPrompt: config.systemPrompt,
          modelOverrides: config.modelOverrides,
        }),
      );
    };

    socket.onmessage = (event: MessageEvent<ArrayBuffer | Blob | string>) => {
      if (event.data instanceof ArrayBuffer) {
        this.emit("tts-audio", event.data);
        return;
      }

      if (typeof event.data === "string") {
        try {
          this.dispatchSocketPayload(event.data);
        } catch (error) {
          this.emitError(error);
        }
        return;
      }

      const blobData = event.data;
      this.jsonMessageQueue = this.jsonMessageQueue
        .then(async () => {
          const data = await this.normalizeMessageData(blobData);
          this.dispatchSocketPayload(new TextDecoder().decode(data));
        })
        .catch((error) => {
          this.emitError(error);
        });
    };

    socket.onerror = () => {
      const isLocalServer = WS_URL.includes("localhost") || WS_URL.includes("127.0.0.1");
      this.emitError(
        new Error(
          isLocalServer
            ? "自建语音服务连不上，请在另一个终端运行 node backend/server.js。"
            : "Self-hosted voice websocket error.",
        ),
      );
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.isManualDisconnect) {
        return;
      }

      const retryConfig = this.config;
      const shouldRetry = this.reconnectAttempts < this.maxReconnectAttempts && !!retryConfig;
      if (shouldRetry) {
        this.reconnectAttempts += 1;
        this.emit("realtime-hint", {
          message: "Voice disconnected, retrying connection once.",
          level: "warning",
        });
        this.openSocket(retryConfig);
        return;
      }

      this.rejectConnect?.(new Error("Self-hosted websocket closed before session started."));
      this.clearConnectTimeout();
      this.emitError(new Error("Voice disconnected."));
    };

    this.socket = socket;
  }

  private async normalizeMessageData(data: Blob | ArrayBuffer): Promise<ArrayBuffer> {
    if (data instanceof Blob) {
      return data.arrayBuffer();
    }
    return data;
  }

  private dispatchSocketPayload(raw: string): void {
    const payload = JSON.parse(raw) as {
      type?: string;
      text?: string;
      isFinal?: boolean;
      message?: string;
      level?: "info" | "warning";
    };

    if (payload.type === "ready") {
      this.clearConnectTimeout();
      this.reconnectAttempts = 0;
      this.resolveConnect?.();
      return;
    }

    if (payload.type === "transcript" && typeof payload.text === "string") {
      this.emit("transcript", {
        text: payload.text,
        isFinal: payload.isFinal !== false,
        timestamp: Date.now(),
      });
      return;
    }

    if (payload.type === "bot-message" && typeof payload.text === "string") {
      this.emit("bot-message", {
        text: payload.text,
        isFinal: payload.isFinal === true,
        timestamp: Date.now(),
      });
      return;
    }

    if (payload.type === "realtime-hint" && typeof payload.message === "string") {
      this.emit("realtime-hint", {
        message: payload.message,
        level: payload.level ?? "warning",
      });
      return;
    }

    if (payload.type === "error" && typeof payload.message === "string") {
      throw new Error(payload.message);
    }
  }

  private emitError(error: unknown): void {
    this.emit("error", error instanceof Error ? error : new Error(String(error)));
  }

  private emit(
    event: AdapterEvent,
    payload: TranscriptEvent | BotMessageEvent | ArrayBuffer | RealtimeHintEvent | Error,
  ): void {
    this.handlers[event].forEach((handler) => {
      handler(payload);
    });
  }
}
