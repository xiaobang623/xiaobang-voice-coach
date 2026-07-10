import type {
  BotMessageEvent,
  RealtimeHintEvent,
  TranscriptEvent,
  VoiceAdapter,
  VoiceConfig,
} from "./types";

const WS_URL = import.meta.env.VITE_VOICE_PROXY_URL ?? "ws://localhost:8080";
const TTS_SAMPLE_RATE = 16000;
const CONNECT_TIMEOUT_MS = 15_000;

const enum MessageType {
  FULL_CLIENT_REQUEST = 0b0001,
  AUDIO_ONLY_REQUEST = 0b0010,
  FULL_SERVER_RESPONSE = 0b1001,
  AUDIO_ONLY_RESPONSE = 0b1011,
  ERROR_INFORMATION = 0b1111,
}

const enum MessageTypeFlag {
  CARRY_EVENT_ID = 0b0100,
}

const enum SerializationMethod {
  RAW = 0b0000,
  JSON = 0b0001,
}

const enum EventSend {
  StartConnection = 1,
  FinishConnection = 2,
  StartSession = 100,
  FinishSession = 102,
  TaskRequest = 200,
  SayHello = 300,
  EndASR = 400,
  ChatTextQuery = 501,
}

const enum EventReceive {
  ConnectionStarted = 50,
  SessionStarted = 150,
  SessionFailed = 153,
  TTSResponse = 352,
  ASRInfo = 450,
  ASRResponse = 451,
  ASREnded = 459,
  ChatResponse = 550,
  ChatEnded = 559,
}

type AdapterEvent = "transcript" | "bot-message" | "tts-audio" | "realtime-hint" | "error";

export class DoubaoVoiceAdapter implements VoiceAdapter {
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
  private botTextBuffer = "";  // accumulates streaming text chunks from event 550
  private readonly maxReconnectAttempts = 1;
  private connectPromise: Promise<void> | null = null;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((reason?: unknown) => void) | null = null;

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
        this.rejectConnect?.(new Error("语音连接超时，请检查代理服务和豆包凭证配置。"));
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
      if (this.socket.readyState === WebSocket.OPEN && this.config) {
        const frame = this.buildJsonEventPayload(EventSend.FinishSession, {});
        this.socket.send(frame);
      }
    } catch (error) {
      this.emitError(error);
    } finally {
      this.socket.close(1000, "client disconnect");
      this.socket = null;
    }
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.config) {
      // Socket not ready — silently drop this audio chunk.
      // Do NOT emit an error here: a momentary socket state change would kill the entire session.
      return;
    }

    try {
      const frame = this.buildAudioPayload(this.config.sessionId, chunk);
      this.socket.send(frame);
    } catch (error) {
      this.emitError(error);
    }
  }

  endAsr(_source: "silence" | "stop" = "silence"): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.config) {
      return;
    }

    try {
      const frame = this.buildJsonEventPayload(EventSend.EndASR, {});
      this.socket.send(frame);
    } catch (error) {
      this.emitError(error);
    }
  }

  sendTextQuery(text: string): void {
    const content = text.trim();
    if (!content) {
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.config) {
      return;
    }

    try {
      const frame = this.buildJsonEventPayload(EventSend.ChatTextQuery, { content });
      this.socket.send(frame);
    } catch (error) {
      this.emitError(error);
    }
  }

  sayHello(text: string): void {
    const content = text.trim();
    if (!content) {
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.config) {
      return;
    }

    try {
      const frame = this.buildJsonEventPayload(EventSend.SayHello, { content });
      this.socket.send(frame);
    } catch (error) {
      this.emitError(error);
    }
  }

  on(
    event: "transcript" | "bot-message" | "tts-audio" | "realtime-hint" | "error",
    handler: (payload: TranscriptEvent | BotMessageEvent | ArrayBuffer | RealtimeHintEvent | Error) => void,
  ): void {
    this.handlers[event].add(handler);
  }

  private buildProxyUrl(config: VoiceConfig): string {
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
    const socket = new WebSocket(this.buildProxyUrl(config));
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      const frame = this.buildJsonEventPayload(EventSend.StartConnection, {});
      socket.send(frame);
    };

    socket.onmessage = (event: MessageEvent<Blob | ArrayBuffer | string>) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          this.handleBinaryMessage(event.data);
          return;
        }

        void this.normalizeMessageData(event.data).then((data) => {
          this.handleBinaryMessage(data);
        });
      } catch (error) {
        this.emitError(error);
      }
    };

    socket.onerror = () => {
      const isLocalProxy =
        WS_URL.includes("localhost") || WS_URL.includes("127.0.0.1");
      this.emitError(
        new Error(
          isLocalProxy
            ? "语音代理连不上，请在另一个终端运行 npm run proxy。"
            : "Doubao realtime websocket error.",
        ),
      );
    };

    socket.onclose = (event) => {
      this.socket = null;
      if (this.isManualDisconnect) {
        return;
      }

      const retryConfig = this.config;
      const shouldRetry = this.reconnectAttempts < this.maxReconnectAttempts && !!retryConfig;
      if (shouldRetry) {
        this.reconnectAttempts += 1;
        this.emitRealtimeHint("Voice disconnected, retrying connection once.");
        this.openSocket(retryConfig);
        return;
      }

      this.rejectConnect?.(new Error("Doubao websocket closed before session started."));
      this.clearConnectTimeout();
      this.emitError(new Error("Voice disconnected."));
    };

    this.socket = socket;
  }

  private handleBinaryMessage(data: ArrayBuffer): void {
    const view = new DataView(data);
    if (view.byteLength < 4) {
      return;
    }

    const headerByte1 = view.getUint8(1);
    const headerByte2 = view.getUint8(2);
    const messageType = (headerByte1 >> 4) & 0x0f;
    // byte 2 high nibble: 0x0 = RAW binary, 0x1 = JSON
    const serializationMethod = (headerByte2 >> 4) & 0x0f;

    // Handle TTS audio frames that come as audio-only response.
    if (messageType === MessageType.AUDIO_ONLY_RESPONSE) {
      this.handleAudioOnlyTtsFrame(data, view);
      return;
    }

    // FULL_SERVER_RESPONSE with RAW serialization can carry TTS audio.
    if (messageType === MessageType.FULL_SERVER_RESPONSE && serializationMethod === SerializationMethod.RAW) {
      this.handleRawServerResponseFrame(data, view);
      return;
    }

    if (messageType === MessageType.ERROR_INFORMATION) {
      this.handleErrorFrame(data, view);
      return;
    }

    if (messageType !== MessageType.FULL_SERVER_RESPONSE) {
      return;
    }

    if (view.byteLength < 12) {
      return;
    }

    const eventId = view.getUint32(4, false);
    // bytes 8-11 are EITHER sessionLength (with session-id layout)
    // OR payloadLength (without session-id layout)
    const fieldAt8 = view.getUint32(8, false);

    let payloadLength = 0;
    let payloadStart = 0;
    const cursorWithSession = 12 + fieldAt8;

    // Layout A (with session id):
    // [header4][event4][sessionLen4][session][payloadLen4][payload]
    if (cursorWithSession + 4 <= view.byteLength) {
      payloadLength = view.getUint32(cursorWithSession, false);
      payloadStart = cursorWithSession + 4;
    } else {
      // Layout B (without session id):
      // [header4][event4][payloadLen4][payload]
      payloadLength = fieldAt8;
      payloadStart = 12;
    }

    const safePayloadLength = Math.max(
      0,
      Math.min(payloadLength, view.byteLength - payloadStart),
    );
    if (safePayloadLength <= 0) {
      return;
    }

    const payloadBytes = new Uint8Array(data, payloadStart, safePayloadLength);
    const payload = this.tryParseJson(payloadBytes);

    if (payload === null) {
      return;
    }

    if (eventId === EventReceive.ConnectionStarted) {
      const startMeta = this.buildStartSessionMeta();
      const frame = this.buildJsonEventPayload(
        EventSend.StartSession,
        startMeta,
      );
      this.socket?.send(frame);
      return;
    }

    if (eventId === EventReceive.SessionStarted) {
      this.clearConnectTimeout();
      this.reconnectAttempts = 0;
      this.resolveConnect?.();
      return;
    }

    if (eventId === EventReceive.SessionFailed) {
      this.clearConnectTimeout();
      this.rejectConnect?.(
        new Error(`Session start failed: ${JSON.stringify(payload)}`),
      );
      return;
    }

    if (eventId === EventReceive.ASRInfo) {
      return;
    }

    if (eventId === EventReceive.ChatResponse) {
      const chunk = this.extractBotText(payload);
      if (chunk && chunk.length > 0) {
        this.botTextBuffer += chunk;
        this.emit("bot-message", {
          text: this.botTextBuffer,
          isFinal: false,
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (eventId === EventReceive.ChatEnded) {
      if (this.botTextBuffer.length > 0) {
        this.emit("bot-message", {
          text: this.botTextBuffer,
          isFinal: true,
          timestamp: Date.now(),
        });
        this.botTextBuffer = "";
      }
      return;
    }

    if (eventId === EventReceive.ASREnded) {
      return;
    }

    if (eventId === EventReceive.ASRResponse) {
      const transcript = this.extractTranscript(payload);
      if (transcript) {
        this.emit("transcript", transcript);
      }
      return;
    }

  }

  private handleAudioOnlyTtsFrame(data: ArrayBuffer, view: DataView): void {
    if (view.byteLength < 12) {
      return;
    }

    const headerByte1 = view.getUint8(1);
    const hasEventId = (headerByte1 & 0x0f) === MessageTypeFlag.CARRY_EVENT_ID;

    let cursor = 4;
    let eventId: number | null = null;
    if (hasEventId) {
      eventId = view.getUint32(cursor, false);
      cursor += 4;
    }
    if (eventId !== null && eventId !== EventReceive.TTSResponse) {
      return;
    }
    if (cursor + 4 > view.byteLength) {
      return;
    }

    const field = view.getUint32(cursor, false);
    cursor += 4;

    let payloadLength = 0;
    let dataStart = 0;
    const cursorWithSession = cursor + field;
    if (cursorWithSession + 4 <= view.byteLength) {
      payloadLength = view.getUint32(cursorWithSession, false);
      dataStart = cursorWithSession + 4;
    } else {
      payloadLength = field;
      dataStart = cursor;
    }
    if (payloadLength <= 0 || dataStart + payloadLength > view.byteLength) {
      return;
    }

    this.emit("tts-audio", data.slice(dataStart, dataStart + payloadLength));
  }

  private handleRawServerResponseFrame(data: ArrayBuffer, view: DataView): void {
    if (view.byteLength < 12) {
      return;
    }

    const eventId = view.getUint32(4, false);
    if (eventId !== EventReceive.TTSResponse) {
      return;
    }

    const fieldAt8 = view.getUint32(8, false);
    let payloadLength = 0;
    let dataStart = 0;

    const cursorWithSession = 12 + fieldAt8;
    if (cursorWithSession + 4 <= view.byteLength) {
      payloadLength = view.getUint32(cursorWithSession, false);
      dataStart = cursorWithSession + 4;
    } else {
      payloadLength = fieldAt8;
      dataStart = 12;
    }

    if (payloadLength <= 0 || dataStart + payloadLength > view.byteLength) {
      return;
    }
    this.emit("tts-audio", data.slice(dataStart, dataStart + payloadLength));
  }

  private handleErrorFrame(data: ArrayBuffer, view: DataView): void {
    if (view.byteLength < 12) {
      this.emitError(new Error("Received malformed error frame."));
      return;
    }

    const errorCode = view.getUint32(4, false);
    const messageSize = view.getUint32(8, false);
    const safeLength = Math.max(0, Math.min(messageSize, view.byteLength - 12));
    const messageBytes = new Uint8Array(data, 12, safeLength);
    const message = new TextDecoder().decode(messageBytes).trim();

    this.emitError(
      new Error(
        message
          ? `Doubao error ${errorCode}: ${message}`
          : `Doubao error ${errorCode}`,
      ),
    );
  }

  private buildStartSessionMeta(): Record<string, unknown> {
    const systemRole =
      this.config?.systemPrompt?.trim() ||
      "You are a friendly English speaking coach. Keep responses natural and conversational.";

    // Explicitly request PCM output; default server output may be ogg_opus.
    const audioConfig: Record<string, unknown> = {
      format: "pcm_s16le",
      sample_rate: TTS_SAMPLE_RATE,
      channel: 1,
    };
    if (typeof this.config?.speedRatio === "number") {
      audioConfig.speed_ratio = this.config.speedRatio;
    }

    const tts: Record<string, unknown> = {
      audio_config: audioConfig,
    };
    // O2.0 dialog voices use tts.speaker (NOT audio_config.voice_type).
    if (this.config?.voiceType) {
      tts.speaker = this.config.voiceType;
    }

    return {
      dialog: {
        bot_name: "Xiaobang Coach",
        system_role: systemRole,
        extra: {
          model: this.config?.modelOverrides?.doubaoDialogModel ?? "1.2.1.1",
        },
      },
      extra: {
        // keep_alive avoids aggressive server-side idle timeout in long pauses
        input_mod: "keep_alive",
      },
      asr: {},
      tts,
    };
  }

  private buildJsonEventPayload(event: EventSend, body: Record<string, unknown>): ArrayBuffer {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const shouldIncludeSessionId =
      event === EventSend.StartSession ||
      event === EventSend.FinishSession ||
      event === EventSend.EndASR ||
      event === EventSend.SayHello ||
      event === EventSend.ChatTextQuery;
    const sessionBytes =
      shouldIncludeSessionId && this.config
        ? new TextEncoder().encode(this.config.sessionId)
        : null;
    const frame = new ArrayBuffer(
      4 + 4 + (sessionBytes ? 4 + sessionBytes.length : 0) + 4 + encoded.length,
    );
    const view = new DataView(frame);
    const bytes = new Uint8Array(frame);

    view.setUint8(0, 0x11);
    view.setUint8(1, (MessageType.FULL_CLIENT_REQUEST << 4) | MessageTypeFlag.CARRY_EVENT_ID);
    view.setUint8(2, SerializationMethod.JSON << 4);
    view.setUint8(3, 0x00);

    let cursor = 4;
    view.setUint32(cursor, event, false);
    cursor += 4;

    if (sessionBytes) {
      view.setUint32(cursor, sessionBytes.length, false);
      cursor += 4;
      bytes.set(sessionBytes, cursor);
      cursor += sessionBytes.length;
    }

    view.setUint32(cursor, encoded.length, false);
    cursor += 4;
    bytes.set(encoded, cursor);
    return frame;
  }

  private buildAudioPayload(sessionId: string, chunk: ArrayBuffer): ArrayBuffer {
    const sessionBytes = new TextEncoder().encode(sessionId);
    const audioBytes = new Uint8Array(chunk);
    const frame = new ArrayBuffer(4 + 4 + 4 + sessionBytes.length + 4 + audioBytes.length);
    const view = new DataView(frame);
    const bytes = new Uint8Array(frame);

    view.setUint8(0, 0x11);
    view.setUint8(1, (MessageType.AUDIO_ONLY_REQUEST << 4) | MessageTypeFlag.CARRY_EVENT_ID);
    view.setUint8(2, SerializationMethod.RAW << 4);
    view.setUint8(3, 0x00);

    let cursor = 4;
    view.setUint32(cursor, EventSend.TaskRequest, false);
    cursor += 4;
    view.setUint32(cursor, sessionBytes.length, false);
    cursor += 4;
    bytes.set(sessionBytes, cursor);
    cursor += sessionBytes.length;
    view.setUint32(cursor, audioBytes.length, false);
    cursor += 4;
    bytes.set(audioBytes, cursor);
    return frame;
  }

  // Extract bot text from DialogueResponse (eventId 450)
  private extractBotText(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;

    // ByteDance dialogue API: { utterances: [{ text: "...", definite: true }] }
    if (Array.isArray(p.utterances) && p.utterances.length > 0) {
      const last = p.utterances[p.utterances.length - 1] as { text?: string };
      if (last.text) return last.text;
    }

    // Fallback: direct text or content field
    if (typeof p.text === "string" && p.text) return p.text;
    if (typeof p.content === "string" && p.content) return p.content;

    return null;
  }

  private extractTranscript(payload: unknown): TranscriptEvent | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const resultItems = (payload as { results?: Array<{ text?: string; is_interim?: boolean }> }).results;
    if (!Array.isArray(resultItems) || resultItems.length === 0) {
      return null;
    }

    const last = resultItems[resultItems.length - 1];
    if (!last?.text) {
      return null;
    }

    return {
      text: last.text,
      isFinal: !last.is_interim,
      timestamp: Date.now(),
    };
  }

  private async normalizeMessageData(data: Blob | ArrayBuffer | string): Promise<ArrayBuffer> {
    if (typeof data === "string") {
      return new TextEncoder().encode(data).buffer;
    }

    if (data instanceof Blob) {
      return data.arrayBuffer();
    }

    return data;
  }

  private tryParseJson(payload: Uint8Array): unknown {
    if (payload.length === 0) {
      return null;
    }

    try {
      return JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return null;
    }
  }

  private emitRealtimeHint(message: string): void {
    this.emit("realtime-hint", { message, level: "warning" });
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
