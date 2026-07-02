import { useEffect, useRef, useState } from "react";
import type { ReportJSON } from "../types";
import type { UseVoiceSessionResult } from "../hooks/useVoiceSession";
import { ReportView } from "./ReportView";

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export interface VoiceSessionProps {
  voice: UseVoiceSessionResult;
  report: ReportJSON | null;
  reportLoading: boolean;
  reportError: string | null;
  wordCount: number;
  sentenceCount: number;
  onEndAndReport: () => void;
}

export function VoiceSession({
  voice,
  report,
  reportLoading,
  reportError,
  wordCount,
  sentenceCount,
  onEndAndReport,
}: VoiceSessionProps) {
  const { status, messages, errorMessage, hint, startedAt, start, stop } = voice;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const isActive = status === "active" || status === "connecting";
  const hasHistory = messages.length > 0;
  const canGenerateReport = hasHistory && !report && !reportLoading;

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, report]);

  useEffect(() => {
    if (status !== "active") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const statusLine = (() => {
    if (status === "connecting") {
      return "正在接通，稍等一下…";
    }
    if (status === "active" && startedAt) {
      return `还在聊天呢… · ${formatElapsed(startedAt, now)}`;
    }
    if (hasHistory && report) {
      return "复盘好了 · 想继续聊就点麦克风";
    }
    if (hasHistory) {
      return "已暂停 · 点麦克风继续聊，或结束生成复盘";
    }
    return "准备好了就开始吧";
  })();

  return (
    <section className="flex min-h-[calc(100vh-8rem)] flex-col">
      <p className="mb-3 text-center text-sm text-[#A89B8C]">{statusLine}</p>

      {errorMessage ? (
        <div className="mb-4 rounded-2xl bg-[#F3E0DB] px-5 py-3 text-sm text-[#8C5A4F] shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      <div ref={listRef} className="flex-1 overflow-y-auto px-1 py-2">
        {messages.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm text-[#B5A997]">
              {isActive ? "说点什么吧，我听着呢 ☕" : "点下面的麦克风，聊一会儿英语吧"}
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((message) =>
              message.role === "user" ? (
                <li key={message.id} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-md bg-[#E8D5C4] px-4 py-2.5 shadow-sm">
                    <p
                      className={`text-[15px] leading-relaxed ${
                        message.isFinal ? "text-[#3D3D3D]" : "text-[#8A7B6A] italic"
                      }`}
                    >
                      {message.text}
                    </p>
                  </div>
                </li>
              ) : (
                <li key={message.id} className="flex items-start justify-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F0E6DA] text-base shadow-sm">
                    🧑‍🏫
                  </span>
                  <div className="max-w-[75%] rounded-2xl rounded-bl-md bg-[#FFF9F3] px-4 py-2.5 shadow-sm">
                    <p className="text-[15px] leading-relaxed text-[#3D3D3D]">{message.text}</p>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        {reportLoading ? (
          <p className="mt-6 text-center text-sm text-[#A89B8C]">正在整理今天的复盘…</p>
        ) : null}

        {reportError ? (
          <div className="mt-6 rounded-2xl bg-[#F3E0DB] px-5 py-3 text-sm text-[#8C5A4F] shadow-sm">
            {reportError}
          </div>
        ) : null}

        {report ? (
          <div className="mt-4">
            <ReportView report={report} wordCount={wordCount} sentenceCount={sentenceCount} />
          </div>
        ) : null}
      </div>

      <div className="h-8 px-1">
        {hint ? (
          <p className="animate-pulse text-center text-xs text-[#A89B8C]">{hint}</p>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-4 pb-6 pt-2">
        {isActive ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => stop()}
              disabled={status === "connecting" || reportLoading}
              className="inline-flex items-center gap-2 rounded-full border border-[#C4998A] bg-[#FFF9F3] px-5 py-2.5 text-sm font-medium text-[#7C6B5D] shadow-sm transition hover:bg-[#F5EDE4] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PauseIcon className="h-4 w-4" />
              暂停对话
            </button>
            {canGenerateReport ? (
              <button
                type="button"
                onClick={onEndAndReport}
                disabled={reportLoading}
                className="rounded-full bg-[#7C6B5D] px-5 py-2.5 text-sm font-medium text-[#FAF8F3] shadow-sm transition hover:bg-[#6A5A4E] disabled:cursor-not-allowed disabled:opacity-60"
              >
                结束并生成复盘
              </button>
            ) : null}
          </div>
        ) : null}

        {isActive ? (
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full bg-[#C4998A] text-[#FFF9F3] shadow-lg"
            aria-hidden="true"
          >
            <span className="relative flex h-20 w-20 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#C4998A]/30" />
              <MicIcon className="relative h-9 w-9" />
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={reportLoading}
            aria-label={hasHistory ? "继续对话" : "开始对话"}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-[#7C6B5D] text-[#FAF8F3] shadow-lg transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MicIcon className="h-9 w-9" />
          </button>
        )}

        <p className="text-xs text-[#B5A997]">
          {isActive
            ? "麦克风开着呢，随时可以说"
            : hasHistory
              ? "点麦克风继续聊"
              : "点麦克风开始"}
        </p>

        {!isActive && canGenerateReport ? (
          <button
            type="button"
            onClick={onEndAndReport}
            disabled={reportLoading}
            className="rounded-full bg-[#7C6B5D] px-6 py-3 text-sm font-medium text-[#FAF8F3] shadow-md transition hover:bg-[#6A5A4E] disabled:cursor-not-allowed disabled:opacity-60"
          >
            结束本次对话并生成复盘
          </button>
        ) : null}
      </div>
    </section>
  );
}
