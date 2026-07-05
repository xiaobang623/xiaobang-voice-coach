import { useCallback, useEffect, useRef, useState } from "react";
import { DoubaoVoiceAdapter } from "../adapters/voice/doubao";
import type { BotMessageEvent, TranscriptEvent } from "../adapters/voice/types";
import { TtsPcmPlayer } from "./ttsPcmPlayer";

export type VoiceSessionStatus = "connecting" | "active" | "ended";

/** Per-session personalization passed into `start()`. */
export interface VoiceStartOptions {
  voiceType?: string;
  speedRatio?: number;
  systemPrompt?: string;
  /** Dev typing-test mode: connect without opening the microphone. */
  typingTestMode?: boolean;
}

export interface VoiceSessionMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface UseVoiceSessionResult {
  status: VoiceSessionStatus;
  messages: VoiceSessionMessage[];
  errorMessage: string | null;
  hint: string | null;
  startedAt: number | null;
  /** When the current conversation thread began (survives reconnects). */
  conversationStartedAt: number | null;
  start: (options?: VoiceStartOptions) => Promise<void>;
  /** Dev typing-test: send text instead of speaking (ChatTextQuery). */
  sendTextQuery: (text: string) => void;
  /** End the live voice link but keep on-screen messages. */
  stop: () => void;
  /** Wipe messages and reset — only when leaving the chat view. */
  clearConversation: () => void;
}

const TTS_SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 0.01;
const SILENCE_END_ASR_MS = 1200;

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

  const hintTimerRef = useRef<number | null>(null);
  const statusRef = useRef<VoiceSessionStatus>("ended");
  const adapterRef = useRef<DoubaoVoiceAdapter | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const ttsContextRef = useRef<AudioContext | null>(null);
  const ttsPlayerRef = useRef<TtsPcmPlayer | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const endAsrSentForSilenceRef = useRef<boolean>(false);
  const hasVoiceSinceEndAsrRef = useRef<boolean>(false);

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

  const teardownConnection = useCallback(() => {
    if (hasVoiceSinceEndAsrRef.current) {
      adapterRef.current?.endAsr("stop");
    }
    teardownMic();
    adapterRef.current?.disconnect();
    adapterRef.current = null;
    statusRef.current = "ended";
    lastVoiceAtRef.current = 0;
    endAsrSentForSilenceRef.current = false;
    hasVoiceSinceEndAsrRef.current = false;
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    setHint(null);
    setStartedAt(null);
    setStatus("ended");
  }, [teardownMic]);

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
    teardownAll();
    setMessages([]);
    setErrorMessage(null);
    setConversationStartedAt(null);
  }, [teardownAll]);

  const ensureTtsPlayer = useCallback(() => {
    if (!ttsContextRef.current) {
      ttsContextRef.current = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
    }
    if (!ttsPlayerRef.current) {
      ttsPlayerRef.current = new TtsPcmPlayer(ttsContextRef.current, TTS_SAMPLE_RATE);
    }
    return ttsPlayerRef.current;
  }, []);

  const playTtsChunk = useCallback(
    (audioData: ArrayBuffer) => {
      try {
        ensureTtsPlayer().enqueue(audioData);
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
      };

      if (previous.length === 0) {
        return [message];
      }

      const lastUserIdx = [...previous].reverse().findIndex((m) => m.role === "user");
      if (lastUserIdx === -1) {
        return [...previous, message];
      }
      const realIdx = previous.length - 1 - lastUserIdx;
      const last = previous[realIdx];

      if (!last.isFinal && !event.isFinal) {
        const next = [...previous];
        next[realIdx] = { ...last, text: event.text, timestamp: event.timestamp };
        return next;
      }

      if (!last.isFinal && event.isFinal) {
        // User finished speaking — clear any stale bot audio before the next reply.
        ttsPlayerRef.current?.reset();
        const next = [...previous];
        next[realIdx] = { ...message, id: last.id };
        return next;
      }

      if (event.isFinal) {
        ttsPlayerRef.current?.reset();
      }

      return [...previous, message];
    });
  }, []);

  const onBotMessage = useCallback((event: BotMessageEvent) => {
    setMessages((previous) => {
      const last = previous[previous.length - 1];

      if (last && last.role === "bot" && !last.isFinal) {
        return [
          ...previous.slice(0, -1),
          { ...last, text: event.text, isFinal: event.isFinal, timestamp: event.timestamp },
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

  const start = useCallback(async (options?: VoiceStartOptions) => {
    if (statusRef.current === "connecting" || statusRef.current === "active") {
      return;
    }

    const skipMic = options?.typingTestMode === true;

    setErrorMessage(null);
    statusRef.current = "connecting";
    setStatus("connecting");

    try {
      ensureTtsPlayer();

      const adapter = new DoubaoVoiceAdapter();
      adapterRef.current = adapter;

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
        showHint((payload as { message: string }).message);
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
        sessionId: crypto.randomUUID(),
        token: "",
        voiceType: options?.voiceType,
        speedRatio: options?.speedRatio,
        systemPrompt: options?.systemPrompt,
      });

      if (!skipMic) {
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
        processor.onaudioprocess = (audioEvent) => {
          if (statusRef.current !== "active" || !adapterRef.current) {
            return;
          }

          const input = audioEvent.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < input.length; i += 1) {
            sumSquares += input[i] * input[i];
          }
          const rms = Math.sqrt(sumSquares / input.length);
          const now = performance.now();
          const isVoiceActive = rms > SILENCE_RMS_THRESHOLD;

          if (!isVoiceActive) {
            const silenceDuration = now - lastVoiceAtRef.current;
            if (
              hasVoiceSinceEndAsrRef.current &&
              !endAsrSentForSilenceRef.current &&
              silenceDuration >= SILENCE_END_ASR_MS
            ) {
              adapterRef.current.endAsr("silence");
              endAsrSentForSilenceRef.current = true;
              hasVoiceSinceEndAsrRef.current = false;
            }
            return;
          }

          lastVoiceAtRef.current = now;
          endAsrSentForSilenceRef.current = false;

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
        endAsrSentForSilenceRef.current = false;
        hasVoiceSinceEndAsrRef.current = false;
      }

      statusRef.current = "active";
      const now = Date.now();
      setStartedAt(now);
      setConversationStartedAt((prev) => prev ?? now);
      setStatus("active");
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
    teardownConnection,
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
    ttsPlayerRef.current?.reset();
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
    start,
    sendTextQuery,
    stop,
    clearConversation,
  };
}
