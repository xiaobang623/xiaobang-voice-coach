import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserPlatformNativeAsr } from "../adapters/asr/platformNative";
import { DoubaoVoiceAdapter } from "../adapters/voice/doubao";
import { SelfHostedVoiceAdapter } from "../adapters/voice/selfhosted";
import type { BotMessageEvent, TranscriptEvent, VoiceAdapter, VoiceModelOverrides } from "../adapters/voice/types";
import { TtsPcmPlayer, type TtsPlayerTuning } from "./ttsPcmPlayer";

export type VoiceSessionStatus = "connecting" | "active" | "ended";

/** Per-session personalization passed into `start()`. */
export interface VoiceStartOptions {
  sessionId?: string;
  userId?: string | null;
  guestId?: string | null;
  voiceType?: string;
  speedRatio?: number;
  systemPrompt?: string;
  /** Spoken by the Coach immediately after the live link is ready. */
  initialGreeting?: string;
  /** Dev typing-test mode: connect without opening the microphone. */
  typingTestMode?: boolean;
  /**
   * Prepare-mode: connect the live backend first, but keep user audio muted
   * until the UI explicitly calls enableInput().
   */
  waitForUserReady?: boolean;
}

export interface VoiceSessionMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  isFinal: boolean;
  timestamp: number;
  /** Shown while the user is speaking, before cloud ASR returns text. */
  isListeningDraft?: boolean;
}

export interface UseVoiceSessionResult {
  status: VoiceSessionStatus;
  messages: VoiceSessionMessage[];
  errorMessage: string | null;
  hint: string | null;
  startedAt: number | null;
  /** When the current conversation thread began (survives reconnects). */
  conversationStartedAt: number | null;
  /** Resolved voice backend for the active or last session. */
  activeBackend: VoiceBackend | null;
  /** Resolved ASR provider for the active or last session. */
  activeAsrProvider: ActiveAsrProvider;
  /** Approximate seconds the learner actually spoke English in this conversation. */
  userSpeakingSeconds: number;
  /** Number of final learner turns in this conversation. */
  userTurns: number;
  /** Read the freshest speaking stats at end-of-session time without waiting for a render. */
  getSpeakingStats: () => { userSpeakingSeconds: number; userTurns: number };
  start: (options?: VoiceStartOptions) => Promise<void>;
  /** Prepare-mode: allow the user's microphone/ASR input to start flowing. */
  enableInput: () => void;
  /** Dev typing-test: send text instead of speaking (ChatTextQuery). */
  sendTextQuery: (text: string) => void;
  /** End the live voice link but keep on-screen messages. */
  stop: () => void;
  /** Wipe messages and reset — only when leaving the chat view. */
  clearConversation: () => void;
}

const TTS_SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 0.01;
/** Barge-in while bot audio is playing must be louder and sustained — one echo/noise frame used to wipe the whole buffered reply. */
const BARGE_IN_RMS_THRESHOLD = 0.02;
/** ~250ms at 4096-sample ScriptProcessor frames (48kHz). */
const BARGE_IN_MIN_FRAMES = 3;
const SILENCE_END_ASR_MS = 800;
/** Ignore ultra-short noise bursts before ending a turn. */
const MIN_SPEECH_MS = 280;
/** Show the listening bubble only after sustained speech — avoids noise false triggers. */
const MIN_LISTENING_DRAFT_MS = 520;

type VoiceBackend = "doubao" | "selfhosted";
type ActiveAsrProvider = string | null;

const PLATFORM_NATIVE_ASR_PROVIDER = "platform-native-asr";
const PLATFORM_NATIVE_ASR_AUDIO_FALLBACK_PROVIDER = "siliconflow-sensevoice";

function estimateSpeakingSecondsFromText(text: string): number {
  const wordCount = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  if (wordCount === 0) {
    return 0;
  }
  // Fallback口径：英文口语按约 2 words/sec 估算（词数 ÷ 2 ≈ 说话秒数）。
  return Math.max(1, Math.round(wordCount / 2));
}

function normalizeSpeechText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isSameOpeningText(eventText: string, openingText: string): boolean {
  const event = normalizeSpeechText(eventText);
  const opening = normalizeSpeechText(openingText);
  return (
    event.length > 0 &&
    opening.length > 0 &&
    (event === opening || event.startsWith(opening) || opening.startsWith(event))
  );
}

/** Selfhosted TTS (SiliconFlow/CosyVoice) streams in bursts with gaps up to ~0.9s — needs far more buffer than Doubao. */
const TTS_TUNING: Record<VoiceBackend, TtsPlayerTuning> = {
  doubao: { primeMs: 220, targetAheadMs: 320 },
  selfhosted: { primeMs: 600, targetAheadMs: 1200 },
};

export interface ResolvedVoiceConfig {
  backend: VoiceBackend;
  modelOverrides: VoiceModelOverrides;
}

interface VoiceConfigApiResponse {
  backend?: VoiceBackend;
  modelOverrides?: VoiceModelOverrides;
  config?: {
    doubao?: { dialogModel?: string };
    selfhosted?: {
      asrProvider?: string;
      platformNativeAsrLocale?: string;
      ttsProvider?: string;
      siliconflowTtsVoice?: string;
      whisperModel?: string;
      deepseekModel?: string;
      cosyvoiceModelKey?: string;
    };
  };
}

function createVoiceAdapter(backend: VoiceBackend): VoiceAdapter {
  return backend === "selfhosted" ? new SelfHostedVoiceAdapter() : new DoubaoVoiceAdapter();
}

async function resolveVoiceConfig(options?: VoiceStartOptions): Promise<ResolvedVoiceConfig> {
  const query = new URLSearchParams();
  if (options?.userId) {
    query.set("userId", options.userId);
  }
  if (options?.guestId) {
    query.set("guestId", options.guestId);
  }
  if (options?.sessionId) {
    query.set("sessionId", options.sessionId);
  }

  const endpoint = `/api/voice-backend-config${query.size > 0 ? `?${query.toString()}` : ""}`;

  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { backend: "doubao", modelOverrides: {} };
    }
    const text = await response.text();
    if (!text.trim()) {
      return { backend: "doubao", modelOverrides: {} };
    }
    const payload = JSON.parse(text) as VoiceConfigApiResponse;
    const backend = payload.backend === "selfhosted" ? "selfhosted" : "doubao";
    const modelOverrides: VoiceModelOverrides =
      payload.modelOverrides ??
      ({
        doubaoDialogModel: payload.config?.doubao?.dialogModel,
        asrProvider: payload.config?.selfhosted?.asrProvider,
        platformNativeAsrLocale: payload.config?.selfhosted?.platformNativeAsrLocale,
        ttsProvider: payload.config?.selfhosted?.ttsProvider,
        siliconflowTtsVoice: payload.config?.selfhosted?.siliconflowTtsVoice,
        whisperModel: payload.config?.selfhosted?.whisperModel,
        deepseekModel: payload.config?.selfhosted?.deepseekModel,
        cosyvoiceModelKey: payload.config?.selfhosted?.cosyvoiceModelKey,
      } satisfies VoiceModelOverrides);
    return { backend, modelOverrides };
  } catch {
    return { backend: "doubao", modelOverrides: {} };
  }
}

function downsampleTo16k(input: Float32Array, sampleRate: number): Int16Array {
  if (sampleRate <= 16000) {
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return pcm;
  }

  const ratio = sampleRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.round((outputIndex + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = inputIndex; i < nextInputIndex && i < input.length; i += 1) {
      accum += input[i];
      count += 1;
    }

    const average = count === 0 ? 0 : accum / count;
    const sample = Math.max(-1, Math.min(1, average));
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}

export function useVoiceSession(): UseVoiceSessionResult {
  const [status, setStatus] = useState<VoiceSessionStatus>("ended");
  const [messages, setMessages] = useState<VoiceSessionMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [conversationStartedAt, setConversationStartedAt] = useState<number | null>(null);
  const [activeBackend, setActiveBackend] = useState<VoiceBackend | null>(null);
  const [activeAsrProvider, setActiveAsrProvider] = useState<ActiveAsrProvider>(null);
  const [userSpeakingAudioSeconds, setUserSpeakingAudioSeconds] = useState(0);

  const hintTimerRef = useRef<number | null>(null);
  const statusRef = useRef<VoiceSessionStatus>("ended");
  const inputEnabledRef = useRef(true);
  const adapterRef = useRef<VoiceAdapter | null>(null);
  const platformNativeAsrRef = useRef<BrowserPlatformNativeAsr | null>(null);
  const activeUserMessageIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const ttsContextRef = useRef<AudioContext | null>(null);
  const ttsPlayerRef = useRef<TtsPcmPlayer | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const firstVoiceAtRef = useRef<number>(0);
  const inSpeechRef = useRef<boolean>(false);
  const endAsrSentForSilenceRef = useRef<boolean>(false);
  const hasVoiceSinceEndAsrRef = useRef<boolean>(false);
  const botRespondingRef = useRef<boolean>(false);
  const coachOutputActiveRef = useRef<boolean>(false);
  const bargeInVoicedFramesRef = useRef<number>(0);
  const bargeInHeldChunksRef = useRef<ArrayBuffer[]>([]);
  const tryEndAsrRef = useRef<(() => void) | null>(null);
  const listeningDraftIdRef = useRef<string | null>(null);
  const ensureListeningDraftRef = useRef<() => void>(() => {});
  const clearListeningDraftRef = useRef<() => void>(() => {});
  const openingMessageIdRef = useRef<string | null>(null);
  const openingTextRef = useRef<string | null>(null);
  const openingSuppressUntilRef = useRef<number>(0);
  const speakingAudioSecondsRef = useRef<number>(0);
  const publishedSpeakingAudioSecondsRef = useRef<number>(0);

  const estimatedSpeakingSeconds = useMemo(() => {
    const userText = messages
      .filter((message) => message.role === "user" && message.isFinal && message.text.trim())
      .map((message) => message.text)
      .join(" ");
    return estimateSpeakingSecondsFromText(userText);
  }, [messages]);

  const userTurns = useMemo(
    () =>
      messages.filter(
        (message) => message.role === "user" && message.isFinal && message.text.trim().length > 0,
      ).length,
    [messages],
  );

  const userSpeakingSeconds =
    userSpeakingAudioSeconds > 0 ? userSpeakingAudioSeconds : estimatedSpeakingSeconds;

  const publishSpeakingAudioSeconds = useCallback(() => {
    const nextSeconds = Math.round(speakingAudioSecondsRef.current);
    if (nextSeconds === publishedSpeakingAudioSecondsRef.current) {
      return;
    }
    publishedSpeakingAudioSecondsRef.current = nextSeconds;
    setUserSpeakingAudioSeconds(nextSeconds);
  }, []);

  const resetSpeakingStats = useCallback(() => {
    speakingAudioSecondsRef.current = 0;
    publishedSpeakingAudioSecondsRef.current = 0;
    setUserSpeakingAudioSeconds(0);
  }, []);

  const getSpeakingStats = useCallback(
    () => {
      const audioSeconds = Math.round(speakingAudioSecondsRef.current);
      return {
        // Primary口径：复用现有客户端 ASR/RMS 活跃语音帧累计秒数；不是精确 VAD。
        // 当走平台原生 ASR 或打字测试等拿不到音频帧时，退回到用户最终消息词数 ÷ 2 估算。
        userSpeakingSeconds: audioSeconds > 0 ? audioSeconds : estimatedSpeakingSeconds,
        userTurns,
      };
    },
    [estimatedSpeakingSeconds, userTurns],
  );

  const clearListeningDraft = useCallback(() => {
    const draftId = listeningDraftIdRef.current;
    if (!draftId) {
      activeUserMessageIdRef.current = null;
      return;
    }
    listeningDraftIdRef.current = null;
    activeUserMessageIdRef.current = null;
    setMessages((previous) => previous.filter((message) => message.id !== draftId));
  }, []);

  const ensureListeningDraft = useCallback(() => {
    if (listeningDraftIdRef.current) {
      return;
    }
    const id = crypto.randomUUID();
    listeningDraftIdRef.current = id;
    setMessages((previous) => [
      ...previous,
      {
        id,
        role: "user" as const,
        text: "",
        isFinal: false,
        timestamp: Date.now(),
        isListeningDraft: true,
      },
    ]);
  }, []);

  ensureListeningDraftRef.current = ensureListeningDraft;
  clearListeningDraftRef.current = clearListeningDraft;

  const teardownMic = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    processorNodeRef.current?.disconnect();
    processorNodeRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const teardownPlatformNativeAsr = useCallback(() => {
    platformNativeAsrRef.current?.stop();
    platformNativeAsrRef.current = null;
  }, []);

  const teardownConnection = useCallback(() => {
    if (hasVoiceSinceEndAsrRef.current) {
      adapterRef.current?.endAsr("stop");
    }
    ttsPlayerRef.current?.reset();
    teardownPlatformNativeAsr();
    teardownMic();
    adapterRef.current?.disconnect();
    adapterRef.current = null;
    statusRef.current = "ended";
    lastVoiceAtRef.current = 0;
    firstVoiceAtRef.current = 0;
    inSpeechRef.current = false;
    endAsrSentForSilenceRef.current = false;
    hasVoiceSinceEndAsrRef.current = false;
    botRespondingRef.current = false;
    tryEndAsrRef.current = null;
    clearListeningDraft();
    activeUserMessageIdRef.current = null;
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    setHint(null);
    setStartedAt(null);
    setActiveBackend(null);
    inputEnabledRef.current = true;
    setActiveAsrProvider(null);
    setStatus("ended");
  }, [teardownMic, teardownPlatformNativeAsr, clearListeningDraft]);

  const teardownAll = useCallback(() => {
    teardownConnection();
    if (ttsContextRef.current) {
      void ttsContextRef.current.close();
      ttsContextRef.current = null;
    }
    ttsPlayerRef.current = null;
  }, [teardownConnection]);

  const showHint = useCallback((message: string) => {
    setHint(message);
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
    }
    hintTimerRef.current = window.setTimeout(() => {
      setHint(null);
      hintTimerRef.current = null;
    }, 3000);
  }, []);

  const stop = useCallback(() => {
    teardownConnection();
  }, [teardownConnection]);

  const clearConversation = useCallback(() => {
    listeningDraftIdRef.current = null;
    activeUserMessageIdRef.current = null;
    openingMessageIdRef.current = null;
    openingTextRef.current = null;
    openingSuppressUntilRef.current = 0;
    teardownAll();
    setMessages([]);
    resetSpeakingStats();
    setErrorMessage(null);
    setConversationStartedAt(null);
  }, [teardownAll, resetSpeakingStats]);

  const ensureTtsPlayer = useCallback(() => {
    if (!ttsContextRef.current) {
      ttsContextRef.current = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
    }
    if (!ttsPlayerRef.current) {
      const player = new TtsPcmPlayer(ttsContextRef.current, TTS_SAMPLE_RATE);
      player.setOnIdle(() => {
        coachOutputActiveRef.current = false;
        botRespondingRef.current = false;
        tryEndAsrRef.current?.();
        platformNativeAsrRef.current?.resumeAfterPlayback();
      });
      ttsPlayerRef.current = player;
    }
    return ttsPlayerRef.current;
  }, []);

  const playTtsChunk = useCallback(
    (audioData: ArrayBuffer) => {
      try {
        coachOutputActiveRef.current = true;
        platformNativeAsrRef.current?.pauseForPlayback();
        ensureTtsPlayer().enqueue(audioData);
        void ttsContextRef.current?.resume();
      } catch {
        setErrorMessage("语音播放出了点问题，可以刷新页面再试。");
      }
    },
    [ensureTtsPlayer],
  );

  const onTranscript = useCallback((event: TranscriptEvent) => {
    setMessages((previous) => {
      const message: VoiceSessionMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: event.text,
        isFinal: event.isFinal,
        timestamp: event.timestamp,
        isListeningDraft: false,
      };

      const draftId = listeningDraftIdRef.current;
      if (draftId) {
        listeningDraftIdRef.current = null;
        activeUserMessageIdRef.current = draftId;
        const draftIdx = previous.findIndex((entry) => entry.id === draftId);
        if (draftIdx >= 0) {
          const next = [...previous];
          next[draftIdx] = { ...message, id: draftId };
          return next;
        }
      }

      const activeUserMessageId = activeUserMessageIdRef.current;
      if (activeUserMessageId) {
        const activeIdx = previous.findIndex((entry) => entry.id === activeUserMessageId);
        if (activeIdx >= 0 && previous[activeIdx].role === "user") {
          const hasBotAfterActive = previous
            .slice(activeIdx + 1)
            .some((entry) => entry.role === "bot");
          if (hasBotAfterActive) {
            activeUserMessageIdRef.current = null;
          } else {
            const next = [...previous];
            next[activeIdx] = {
              ...previous[activeIdx],
              text: event.text,
              isFinal: previous[activeIdx].isFinal || event.isFinal,
              timestamp: event.timestamp,
              isListeningDraft: event.text.trim().length === 0 ? previous[activeIdx].isListeningDraft : false,
            };
            return next;
          }
        }
      }

      if (previous.length === 0) {
        if (event.isFinal) {
          activeUserMessageIdRef.current = message.id;
        }
        return [message];
      }

      const last = previous[previous.length - 1];
      if (!last || last.role !== "user") {
        if (event.isFinal) {
          activeUserMessageIdRef.current = message.id;
        }
        return [...previous, message];
      }

      const normalizedLast = normalizeSpeechText(last.text);
      const normalizedNext = normalizeSpeechText(event.text);
      const isDuplicateOrContinuation =
        normalizedLast.length > 0 &&
        normalizedNext.length > 0 &&
        (normalizedLast === normalizedNext ||
          normalizedLast.startsWith(normalizedNext) ||
          normalizedNext.startsWith(normalizedLast));

      if (isDuplicateOrContinuation) {
        const next = [...previous];
        next[next.length - 1] = {
          ...last,
          text: event.text,
          isFinal: last.isFinal || event.isFinal,
          timestamp: event.timestamp,
          isListeningDraft: event.text.trim().length === 0 ? last.isListeningDraft : false,
        };
        if (event.isFinal) {
          botRespondingRef.current = true;
          ttsPlayerRef.current?.reset();
        }
        activeUserMessageIdRef.current = last.id;
        return next;
      }

      if (!last.isFinal && !event.isFinal) {
        const next = [...previous];
        next[next.length - 1] = {
          ...last,
          text: event.text,
          timestamp: event.timestamp,
          isListeningDraft: event.text.trim().length === 0 ? last.isListeningDraft : false,
        };
        activeUserMessageIdRef.current = last.id;
        return next;
      }

      if (!last.isFinal && event.isFinal) {
        // User finished speaking — clear any stale bot audio before the next reply.
        botRespondingRef.current = true;
        ttsPlayerRef.current?.reset();
        const next = [...previous];
        next[next.length - 1] = { ...message, id: last.id, isListeningDraft: false };
        activeUserMessageIdRef.current = last.id;
        return next;
      }

      if (event.isFinal) {
        botRespondingRef.current = true;
        ttsPlayerRef.current?.reset();
        activeUserMessageIdRef.current = message.id;
      }

      return [...previous, message];
    });
  }, []);

  const onBotMessage = useCallback((event: BotMessageEvent) => {
    coachOutputActiveRef.current = true;
    activeUserMessageIdRef.current = null;
    platformNativeAsrRef.current?.pauseForPlayback();

    const openingText = openingTextRef.current;
    if (
      openingText &&
      Date.now() <= openingSuppressUntilRef.current &&
      isSameOpeningText(event.text, openingText)
    ) {
      // `SayHello` is displayed optimistically so the user sees the guide
      // immediately. Some backends also echo the same text as a bot-message;
      // suppress that duplicate while still letting the TTS audio play.
      if (event.isFinal) {
        openingTextRef.current = null;
        openingMessageIdRef.current = null;
        openingSuppressUntilRef.current = 0;
        botRespondingRef.current = false;
      }
      return;
    }

    if (event.isFinal) {
      botRespondingRef.current = false;
      queueMicrotask(() => {
        tryEndAsrRef.current?.();
      });
    }

    setMessages((previous) => {
      const last = previous[previous.length - 1];

      if (last && last.role === "bot" && !last.isFinal) {
        // Ignore out-of-order partials that would roll back streamed text.
        if (!event.isFinal && event.text.length < last.text.length) {
          return previous;
        }
        return [
          ...previous.slice(0, -1),
          { ...last, text: event.text, isFinal: event.isFinal, timestamp: event.timestamp },
        ];
      }

      if (last && last.role === "bot" && last.isFinal && !event.isFinal) {
        return [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: "bot" as const,
            text: event.text,
            isFinal: event.isFinal,
            timestamp: event.timestamp,
          },
        ];
      }

      return [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: "bot" as const,
          text: event.text,
          isFinal: event.isFinal,
          timestamp: event.timestamp,
        },
      ];
    });
  }, []);

  const sayInitialGreeting = useCallback((text?: string) => {
    const content = text?.trim();
    if (!content || !adapterRef.current) {
      return;
    }

    const id = crypto.randomUUID();
    openingMessageIdRef.current = id;
    openingTextRef.current = content;
    openingSuppressUntilRef.current = Date.now() + 10_000;
    botRespondingRef.current = true;
    coachOutputActiveRef.current = true;
    activeUserMessageIdRef.current = null;
    platformNativeAsrRef.current?.pauseForPlayback();

    setMessages((previous) => [
      ...previous,
      {
        id,
        role: "bot" as const,
        text: content,
        isFinal: true,
        timestamp: Date.now(),
      },
    ]);

    adapterRef.current.sayHello(content);
  }, []);

  const startPlatformNativeAsr = useCallback((locale?: string) => {
    const asr = new BrowserPlatformNativeAsr(
      {
        onSpeechStart: () => {
          if (coachOutputActiveRef.current) {
            return;
          }
          ttsPlayerRef.current?.reset();
          botRespondingRef.current = false;
          ensureListeningDraftRef.current();
        },
        onPartial: (text) => {
          if (coachOutputActiveRef.current) {
            return;
          }
          onTranscript({
            text,
            isFinal: false,
            timestamp: Date.now(),
          });
        },
        onFinal: (text) => {
          const content = text.trim();
          if (!content || !adapterRef.current || coachOutputActiveRef.current) {
            return;
          }
          onTranscript({
            text: content,
            isFinal: true,
            timestamp: Date.now(),
          });
          adapterRef.current.sendTextQuery(content);
        },
        onAmend: (fullText) => {
          const content = fullText.trim();
          if (!content || !adapterRef.current || coachOutputActiveRef.current) {
            return;
          }
          // 反悔合并：用户提交后马上接着说——丢弃对半句的回复气泡和音频，
          // 用户气泡恢复成完整长句，整句重新提问。
          ttsPlayerRef.current?.reset();
          botRespondingRef.current = true;
          const activeUserMessageId = activeUserMessageIdRef.current;
          if (activeUserMessageId) {
            setMessages((previous) => {
              const activeIdx = previous.findIndex((entry) => entry.id === activeUserMessageId);
              if (activeIdx < 0) {
                return previous;
              }
              const rest = previous.slice(activeIdx + 1).filter((entry) => entry.role !== "bot");
              if (rest.length === previous.length - activeIdx - 1) {
                return previous;
              }
              return [...previous.slice(0, activeIdx + 1), ...rest];
            });
          }
          onTranscript({
            text: content,
            isFinal: true,
            timestamp: Date.now(),
          });
          const adapter = adapterRef.current;
          if (adapter.amendTextQuery) {
            adapter.amendTextQuery(content);
          } else {
            adapter.sendTextQuery(content);
          }
        },
        onError: (error) => {
          showHint(error.message);
        },
      },
      { locale },
    );

    const started = asr.start();
    if (!started) {
      return false;
    }
    platformNativeAsrRef.current = asr;
    return true;
  }, [onTranscript, showHint]);


  const enableInput = useCallback(() => {
    inputEnabledRef.current = true;
    platformNativeAsrRef.current?.resumeAfterPlayback();
  }, []);

  const start = useCallback(async (options?: VoiceStartOptions) => {
    if (statusRef.current === "connecting" || statusRef.current === "active") {
      return;
    }

    const skipMic = options?.typingTestMode === true;
    inputEnabledRef.current = options?.waitForUserReady === true ? false : true;

    setErrorMessage(null);
    statusRef.current = "connecting";
    setStatus("connecting");

    try {
      ensureTtsPlayer();
      ttsPlayerRef.current?.reset();

      const resolved = await resolveVoiceConfig(options);
      // Voice/model rule: do not silently swap TTS providers or voices.
      // Use the admin-resolved model config as the global default; if the user
      // selected a supported voice, `options.voiceType` overrides only voice id.
      const effectiveModelOverrides = resolved.modelOverrides;
      ttsPlayerRef.current?.setTuning(TTS_TUNING[resolved.backend]);
      setActiveBackend(resolved.backend);
      const configuredAsrProvider = effectiveModelOverrides.asrProvider ?? null;
      const shouldUsePlatformNativeAsr =
        !skipMic &&
        resolved.backend === "selfhosted" &&
        configuredAsrProvider === PLATFORM_NATIVE_ASR_PROVIDER;
      setActiveAsrProvider(configuredAsrProvider);
      const adapter = createVoiceAdapter(resolved.backend);
      adapterRef.current = adapter;

      // Use the app-level session id so usage logs, reports, and admin session list stay aligned.
      const adapterSessionId = options?.sessionId ?? crypto.randomUUID();

      adapter.on("transcript", (payload) => {
        onTranscript(payload as TranscriptEvent);
      });

      adapter.on("bot-message", (payload) => {
        onBotMessage(payload as BotMessageEvent);
      });

      adapter.on("tts-audio", (payload) => {
        playTtsChunk(payload as ArrayBuffer);
      });

      adapter.on("realtime-hint", (payload) => {
        const hintMessage = (payload as { message: string }).message;
        showHint(hintMessage);
        if (hintMessage.includes("没识别到")) {
          clearListeningDraft();
        }
      });

      adapter.on("error", (payload) => {
        const error = payload as Error;
        const isIdleTimeout = error.message.includes("DialogAudioIdleTimeout");
        setErrorMessage(
          isIdleTimeout
            ? "好久没听到声音，语音先暂停啦。再点一下麦克风就能继续聊～"
            : error.message || "语音连接出了点问题，再试一次吧。",
        );
        teardownConnection();
      });

      await adapter.connect({
        sessionId: adapterSessionId,
        token: "",
        userId: options?.userId ?? undefined,
        guestId: options?.guestId ?? undefined,
        voiceType: options?.voiceType,
        speedRatio: options?.speedRatio,
        systemPrompt: options?.systemPrompt,
        modelOverrides: shouldUsePlatformNativeAsr
          ? {
              ...effectiveModelOverrides,
              // Text-query + TTS still need a valid selfhosted backend config.
              // If the browser cannot run platform-native ASR, the normal audio
              // path can fall back to this cloud ASR instead of an unknown key.
              asrProvider: PLATFORM_NATIVE_ASR_AUDIO_FALLBACK_PROVIDER,
            }
          : effectiveModelOverrides,
      });

      if (shouldUsePlatformNativeAsr) {
        const started = startPlatformNativeAsr(effectiveModelOverrides.platformNativeAsrLocale);
        if (started && options?.waitForUserReady === true) {
          platformNativeAsrRef.current?.pauseForPlayback();
        }
        if (!started) {
          setActiveAsrProvider(PLATFORM_NATIVE_ASR_AUDIO_FALLBACK_PROVIDER);
          showHint("当前浏览器不支持平台原生 ASR，已回退到云端 ASR。");
        }
      }

      if (!skipMic && platformNativeAsrRef.current === null) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;

        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.start(250);
        mediaRecorderRef.current = mediaRecorder;

        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        sourceNodeRef.current = source;

        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorNodeRef.current = processor;

        const tryEndAsr = () => {
          if (statusRef.current !== "active" || !adapterRef.current) {
            return;
          }
          // Block only while waiting for bot reply and user has not started a new utterance.
          // Do NOT block on ttsPlayer.isActive() — that prevented barge-in and delayed ASR for seconds.
          if (botRespondingRef.current && !hasVoiceSinceEndAsrRef.current) {
            return;
          }
          if (
            !hasVoiceSinceEndAsrRef.current ||
            endAsrSentForSilenceRef.current ||
            inSpeechRef.current
          ) {
            return;
          }

          const now = performance.now();
          const silenceDuration = now - lastVoiceAtRef.current;
          const speechDuration = lastVoiceAtRef.current - firstVoiceAtRef.current;

          if (silenceDuration >= SILENCE_END_ASR_MS && speechDuration >= MIN_SPEECH_MS) {
            botRespondingRef.current = true;
            adapterRef.current.endAsr("silence");
            endAsrSentForSilenceRef.current = true;
            hasVoiceSinceEndAsrRef.current = false;
          }
        };
        tryEndAsrRef.current = tryEndAsr;

        processor.onaudioprocess = (audioEvent) => {
          if (statusRef.current !== "active" || !adapterRef.current) {
            return;
          }

          if (!inputEnabledRef.current) {
            inSpeechRef.current = false;
            firstVoiceAtRef.current = 0;
            lastVoiceAtRef.current = performance.now();
            endAsrSentForSilenceRef.current = false;
            hasVoiceSinceEndAsrRef.current = false;
            bargeInVoicedFramesRef.current = 0;
            bargeInHeldChunksRef.current = [];
            return;
          }

          const input = audioEvent.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < input.length; i += 1) {
            sumSquares += input[i] * input[i];
          }
          const rms = Math.sqrt(sumSquares / input.length);
          const now = performance.now();
          const wasInSpeech = inSpeechRef.current;
          const isVoiceActive = rms > SILENCE_RMS_THRESHOLD;

          // While bot audio is playing/buffered, ignore echo-level input entirely; only louder,
          // sustained voice counts as barge-in. Held frames are forwarded on confirmation so the
          // start of a real interruption is not lost to the ASR.
          if (ttsPlayerRef.current?.isActive()) {
            if (rms > BARGE_IN_RMS_THRESHOLD) {
              const held = downsampleTo16k(input, audioEvent.inputBuffer.sampleRate);
              bargeInHeldChunksRef.current.push(
                held.buffer.slice(held.byteOffset, held.byteOffset + held.byteLength) as ArrayBuffer,
              );
              bargeInVoicedFramesRef.current += 1;
              if (bargeInVoicedFramesRef.current < BARGE_IN_MIN_FRAMES) {
                return;
              }
              ttsPlayerRef.current.reset();
              bargeInHeldChunksRef.current.pop();
              for (const heldChunk of bargeInHeldChunksRef.current) {
                adapterRef.current.sendAudio(heldChunk);
              }
            } else {
              bargeInVoicedFramesRef.current = 0;
              bargeInHeldChunksRef.current = [];
              return;
            }
          }
          if (bargeInVoicedFramesRef.current > 0) {
            bargeInVoicedFramesRef.current = 0;
            bargeInHeldChunksRef.current = [];
          }

          if (!isVoiceActive) {
            if (wasInSpeech && listeningDraftIdRef.current) {
              const speechDuration = now - firstVoiceAtRef.current;
              if (speechDuration < MIN_LISTENING_DRAFT_MS) {
                clearListeningDraftRef.current();
              }
            }
            inSpeechRef.current = false;
            tryEndAsr();
            return;
          }

          if (!wasInSpeech) {
            firstVoiceAtRef.current = now;
            botRespondingRef.current = false;
            endAsrSentForSilenceRef.current = false;
          }
          inSpeechRef.current = true;
          lastVoiceAtRef.current = now;
          endAsrSentForSilenceRef.current = false;
          speakingAudioSecondsRef.current += input.length / audioEvent.inputBuffer.sampleRate;
          publishSpeakingAudioSeconds();

          if (
            !listeningDraftIdRef.current &&
            now - firstVoiceAtRef.current >= MIN_LISTENING_DRAFT_MS
          ) {
            ensureListeningDraftRef.current();
          }

          const pcm = downsampleTo16k(input, audioEvent.inputBuffer.sampleRate);
          const chunk = pcm.buffer.slice(
            pcm.byteOffset,
            pcm.byteOffset + pcm.byteLength,
          ) as ArrayBuffer;
          adapterRef.current.sendAudio(chunk);
          hasVoiceSinceEndAsrRef.current = true;
        };

        const silent = audioContext.createGain();
        silent.gain.value = 0;
        gainNodeRef.current = silent;

        source.connect(processor);
        processor.connect(silent);
        silent.connect(audioContext.destination);

        lastVoiceAtRef.current = performance.now();
        firstVoiceAtRef.current = 0;
        inSpeechRef.current = false;
        endAsrSentForSilenceRef.current = false;
        hasVoiceSinceEndAsrRef.current = false;
        botRespondingRef.current = false;
        bargeInVoicedFramesRef.current = 0;
        bargeInHeldChunksRef.current = [];
      }

      statusRef.current = "active";
      const now = Date.now();
      setStartedAt(now);
      setConversationStartedAt((prev) => prev ?? now);
      setStatus("active");
      sayInitialGreeting(options?.initialGreeting);
    } catch (error) {
      teardownConnection();
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setErrorMessage("麦克风权限没开，请在浏览器地址栏左侧允许麦克风访问。");
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    ensureTtsPlayer,
    onTranscript,
    onBotMessage,
    playTtsChunk,
    showHint,
    sayInitialGreeting,
    startPlatformNativeAsr,
    teardownConnection,
    clearListeningDraft,
    publishSpeakingAudioSeconds,
  ]);

  const sendTextQuery = useCallback((text: string) => {
    const content = text.trim();
    if (!content || statusRef.current !== "active" || !adapterRef.current) {
      return;
    }

    setMessages((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        text: content,
        isFinal: true,
        timestamp: Date.now(),
      },
    ]);

    adapterRef.current.sendTextQuery(content);
    botRespondingRef.current = true;
    ttsPlayerRef.current?.reset();
    activeUserMessageIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      teardownAll();
    };
  }, [teardownAll]);

  return {
    status,
    messages,
    errorMessage,
    hint,
    startedAt,
    conversationStartedAt,
    activeBackend,
    activeAsrProvider,
    userSpeakingSeconds,
    userTurns,
    getSpeakingStats,
    start,
    enableInput,
    sendTextQuery,
    stop,
    clearConversation,
  };
}
