import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportJSON, SessionSettings } from "../types";
import type { UseVoiceSessionResult } from "../hooks/useVoiceSession";
import { SPEED_OPTIONS, VOICE_OPTIONS } from "../config/session";
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

function EyeIcon({ className }: { className?: string }) {
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
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
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
      <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6.5 0 10 7 10 7a13.4 13.4 0 0 1-2.4 3.1" />
      <path d="M6.6 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

interface VoicePickerProps {
  value: string;
  disabled: boolean;
  onChange: (voiceType: string) => void;
}

function VoicePicker({ value, disabled, onChange }: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = VOICE_OPTIONS.find((option) => option.id === value) ?? VOICE_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="音色"
        title={disabled ? "对话进行中暂不可改，请先暂停" : undefined}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-[#7C6B5D] transition hover:bg-[#F5EDE4]/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F0E6DA] text-sm">
          {selected.emoji}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{selected.label}</span>
        {selected.verified === false ? (
          <span className="shrink-0 rounded-full bg-[#F5EDE4] px-1.5 py-0.5 text-[10px] text-[#A89B8C]">
            未验证
          </span>
        ) : null}
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-[#B5A997] transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && !disabled ? (
        <ul
          role="listbox"
          aria-label="音色"
          className="absolute top-[calc(100%+6px)] left-0 z-50 w-52 overflow-hidden rounded-2xl border border-[#EDE3D6]/80 bg-[#FFFCF8] py-1 shadow-[0_12px_40px_rgba(124,107,93,0.14)]"
        >
          {VOICE_OPTIONS.map((option) => {
            const active = option.id === value;
            return (
              <li key={option.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition ${
                    active ? "bg-[#F5EDE4] text-[#3D3D3D]" : "text-[#7C6B5D] hover:bg-[#FAF4EC]"
                  }`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F0E6DA] text-sm">
                    {option.emoji}
                  </span>
                  <span className="flex-1 font-medium">{option.label}</span>
                  {option.verified === false ? (
                    <span className="text-[10px] text-[#B5A997]">未验证</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function SessionStatusDot({ status }: { status: "idle" | "connecting" | "live" | "paused" }) {
  const tone =
    status === "live"
      ? "bg-[#C4998A] shadow-[0_0_0_3px_rgba(196,153,138,0.25)]"
      : status === "connecting"
        ? "bg-[#D4B896] animate-pulse"
        : status === "paused"
          ? "bg-[#B5A997]"
          : "bg-[#D4C4B5]";

  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />;
}

export interface VoiceSessionProps {
  voice: UseVoiceSessionResult;
  settings: SessionSettings;
  sessionLabel: string;
  voiceType: string;
  onVoiceChange: (voiceType: string) => void;
  speedRatio: number;
  onSpeedChange: (ratio: number) => void;
  report: ReportJSON | null;
  reportLoading: boolean;
  reportError: string | null;
  wordCount: number;
  sentenceCount: number;
  onEndAndReport: () => void;
}

export function VoiceSession({
  voice,
  settings,
  sessionLabel,
  voiceType,
  onVoiceChange,
  speedRatio,
  onSpeedChange,
  report,
  reportLoading,
  reportError,
  wordCount,
  sentenceCount,
  onEndAndReport,
}: VoiceSessionProps) {
  const { status, messages, errorMessage, hint, startedAt, start, stop, sendTextQuery } = voice;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [typingTestMode, setTypingTestMode] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());

  const revealMessage = useCallback((id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleStart = useCallback(() => {
    void start({
      voiceType: settings.voiceType,
      speedRatio: settings.speedRatio,
      systemPrompt: settings.systemPrompt,
      typingTestMode: import.meta.env.DEV && typingTestMode,
    });
  }, [start, settings, typingTestMode]);

  const handleSendText = useCallback(() => {
    const text = draftText.trim();
    if (!text) {
      return;
    }
    sendTextQuery(text);
    setDraftText("");
  }, [draftText, sendTextQuery]);

  const isActive = status === "active" || status === "connecting";
  const sessionLocked = isActive;
  const hasHistory = messages.length > 0;
  const canGenerateReport = hasHistory && !report && !reportLoading;

  const statusTone: "idle" | "connecting" | "live" | "paused" =
    status === "connecting"
      ? "connecting"
      : status === "active"
        ? "live"
        : hasHistory
          ? "paused"
          : "idle";

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
      return `对话中 · ${formatElapsed(startedAt, now)}`;
    }
    if (hasHistory && report) {
      return "复盘好了 · 想继续聊就点麦克风";
    }
    if (hasHistory) {
      return "已暂停 · 点麦克风继续，或结束生成复盘";
    }
    return "准备好了，点麦克风开始";
  })();

  const emptyHint = isActive
    ? typingTestMode
      ? "打字测试模式 · 在底部输入英文发送"
      : "说点什么吧，我听着呢"
    : hasHistory
      ? typingTestMode
        ? "点下方麦克风继续，或用打字测试"
        : "点下方麦克风继续聊"
      : typingTestMode
        ? "开启打字测试后，点麦克风开始（无需开口）"
        : "像和朋友打电话一样，自然开口就好";

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="relative z-20 mt-4 rounded-2xl border border-[#EDE3D6]/70 bg-[#FFFCF8]/80 shadow-[0_8px_30px_rgba(124,107,93,0.06)] backdrop-blur-sm">
        <div className="flex items-stretch divide-x divide-[#EDE3D6]/80">
          <VoicePicker
            value={voiceType}
            disabled={sessionLocked}
            onChange={onVoiceChange}
          />

          <div
            className={`flex shrink-0 items-center gap-2 px-3 py-2 ${sessionLocked ? "opacity-50" : ""}`}
            title={sessionLocked ? "对话进行中暂不可改，请先暂停" : undefined}
          >
            <span className="hidden text-[10px] tracking-wide text-[#B5A997] uppercase sm:inline">
              语速
            </span>
            <div className="inline-flex rounded-full bg-[#F5EDE4]/70 p-0.5">
              {SPEED_OPTIONS.map((speed) => {
                const active = speed.ratio === speedRatio;
                return (
                  <button
                    key={speed.id}
                    type="button"
                    disabled={sessionLocked}
                    onClick={() => onSpeedChange(speed.ratio)}
                    aria-pressed={active}
                    aria-label={`语速 ${speed.label}`}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed ${
                      active
                        ? "bg-white text-[#5C4F44] shadow-sm"
                        : "text-[#8A7B6A] hover:text-[#5C4F44] disabled:hover:text-[#8A7B6A]"
                    }`}
                  >
                    {speed.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSubtitle((current) => !current)}
            aria-pressed={!showSubtitle}
            title={showSubtitle ? "关掉字幕，纯听力练习" : "打开字幕"}
            className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-[#7C6B5D] transition hover:bg-[#F5EDE4]/60"
          >
            {showSubtitle ? (
              <EyeIcon className="h-3.5 w-3.5 text-[#9A8B7C]" />
            ) : (
              <EyeOffIcon className="h-3.5 w-3.5 text-[#9A8B7C]" />
            )}
            <span className="hidden sm:inline">{showSubtitle ? "字幕" : "纯听"}</span>
          </button>

          {import.meta.env.DEV ? (
            <button
              type="button"
              onClick={() => setTypingTestMode((current) => !current)}
              aria-pressed={typingTestMode}
              disabled={sessionLocked}
              title={
                sessionLocked
                  ? "对话进行中暂不可切换，请先暂停"
                  : typingTestMode
                    ? "关闭打字测试"
                    : "开启打字测试（免麦克风）"
              }
              className={`inline-flex shrink-0 items-center gap-1 px-3 py-2 text-[11px] font-medium transition hover:bg-[#F5EDE4]/60 disabled:cursor-not-allowed disabled:opacity-50 ${
                typingTestMode ? "text-[#5C4F44] bg-[#F5EDE4]/50" : "text-[#7C6B5D]"
              }`}
            >
              <span aria-hidden="true">⌨️</span>
              <span className="hidden sm:inline">打字测试</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[#EDE3D6]/60 bg-gradient-to-b from-[#FFFDF9] via-[#FBF6F0] to-[#F3EBE2] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
        <div
          className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[#E8D5C4]/25 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute right-0 bottom-24 h-36 w-36 rounded-full bg-[#D4C4B5]/15 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative z-10 flex items-center gap-2.5 border-b border-[#EDE3D6]/50 px-4 py-3">
          <SessionStatusDot status={statusTone} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[#5C4F44]">{sessionLabel}</p>
            <p className="truncate text-xs text-[#A89B8C]">{statusLine}</p>
          </div>
        </div>

        {errorMessage ? (
          <div className="relative z-10 mx-4 mt-3 rounded-2xl bg-[#F3E0DB]/90 px-4 py-3 text-sm text-[#8C5A4F] shadow-sm">
            {errorMessage}
          </div>
        ) : null}

        <div ref={listRef} className="relative z-10 flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex min-h-[min(52vh,420px)] flex-col items-center justify-center px-6 text-center">
              <div className="relative">
                {isActive ? (
                  <>
                    <span className="session-ripple absolute inset-0 rounded-full border border-[#C4998A]/30" />
                    <span
                      className="session-ripple absolute inset-0 rounded-full border border-[#C4998A]/20"
                      style={{ animationDelay: "0.8s" }}
                    />
                  </>
                ) : (
                  <span className="session-breathe absolute -inset-3 rounded-full bg-[#E8D5C4]/30" />
                )}
                <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#FFF9F3] to-[#E8D5C4] text-4xl shadow-[0_12px_32px_rgba(124,107,93,0.12),inset_0_1px_0_rgba(255,255,255,0.8)]">
                  🧑‍🏫
                </div>
              </div>
              <p className="mt-8 text-base font-medium text-[#5C4F44]">{emptyHint}</p>
              {!showSubtitle ? (
                <p className="mt-2 max-w-xs text-xs leading-relaxed text-[#B5A997]">
                  字幕已关 · 点气泡可看单句
                </p>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-3.5 pb-2">
              {messages.map((message) =>
                message.role === "user" ? (
                  <li key={message.id} className="flex justify-end">
                    <div className="max-w-[82%] rounded-[20px] rounded-br-md bg-[#E8D5C4]/95 px-4 py-2.5 shadow-[0_4px_16px_rgba(124,107,93,0.08)]">
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
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F0E6DA]/90 text-base shadow-sm ring-1 ring-white/60">
                      🧑‍🏫
                    </span>
                    {showSubtitle || revealedIds.has(message.id) ? (
                      <div className="max-w-[82%] rounded-[20px] rounded-bl-md border border-[#EDE3D6]/50 bg-[#FFFCF8]/95 px-4 py-2.5 shadow-[0_4px_16px_rgba(124,107,93,0.06)] backdrop-blur-sm">
                        <p className="text-[15px] leading-relaxed text-[#3D3D3D]">{message.text}</p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => revealMessage(message.id)}
                        title="点一下看这句"
                        className="flex max-w-[82%] items-center gap-2 rounded-[20px] rounded-bl-md border border-dashed border-[#D4C4B5]/80 bg-[#FFFCF8]/70 px-4 py-2.5 text-left shadow-sm transition hover:border-[#C4998A]/50 hover:bg-[#FFF9F3]"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F0E6DA] text-xs">
                          🔊
                        </span>
                        <span className="text-[14px] italic leading-relaxed text-[#A89B8C]">
                          {message.isFinal ? "听完啦 · 点开看这句" : "正在说…"}
                        </span>
                      </button>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}

          {reportLoading ? (
            <p className="mt-6 text-center text-sm text-[#A89B8C]">正在整理今天的复盘…</p>
          ) : null}

          {reportError ? (
            <div className="mt-6 rounded-2xl bg-[#F3E0DB]/90 px-5 py-3 text-sm text-[#8C5A4F] shadow-sm">
              {reportError}
            </div>
          ) : null}

          {report ? (
            <div className="mt-4">
              <ReportView report={report} wordCount={wordCount} sentenceCount={sentenceCount} />
            </div>
          ) : null}
        </div>

        <div className="relative z-10 h-7 px-4">
          {hint ? (
            <p className="animate-pulse text-center text-xs text-[#A89B8C]">{hint}</p>
          ) : null}
        </div>

        <div className="relative z-10 border-t border-[#EDE3D6]/50 bg-[#FFFCF8]/70 px-4 py-5 backdrop-blur-sm">
          {import.meta.env.DEV && typingTestMode && isActive ? (
            <form
              className="mb-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                handleSendText();
              }}
            >
              <input
                type="text"
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                placeholder="Type English here to test voice & topic…"
                disabled={status === "connecting"}
                className="min-w-0 flex-1 rounded-full border border-[#E0D2C4] bg-white/90 px-4 py-2.5 text-sm text-[#3D3D3D] placeholder:text-[#B5A997] focus:border-[#C4998A]/60 focus:outline-none focus:ring-2 focus:ring-[#C4998A]/20 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={status === "connecting" || !draftText.trim()}
                className="shrink-0 rounded-full bg-[#7C6B5D] px-4 py-2.5 text-xs font-medium text-[#FAF8F3] shadow-sm transition hover:bg-[#6A5A4E] disabled:cursor-not-allowed disabled:opacity-60"
              >
                发送
              </button>
            </form>
          ) : null}

          {isActive ? (
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => stop()}
                disabled={status === "connecting" || reportLoading}
                className="inline-flex items-center gap-2 rounded-full border border-[#E0D2C4] bg-white/80 px-4 py-2 text-xs font-medium text-[#7C6B5D] shadow-sm transition hover:bg-[#FAF4EC] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PauseIcon className="h-3.5 w-3.5" />
                暂停
              </button>
              {canGenerateReport ? (
                <button
                  type="button"
                  onClick={onEndAndReport}
                  disabled={reportLoading}
                  className="rounded-full bg-[#7C6B5D] px-4 py-2 text-xs font-medium text-[#FAF8F3] shadow-sm transition hover:bg-[#6A5A4E] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  结束并复盘
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            {isActive ? (
              <div
                className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center"
                aria-hidden="true"
              >
                <span className="session-ripple absolute inset-0 rounded-full bg-[#C4998A]/20" />
                <span
                  className="session-ripple absolute inset-0 rounded-full bg-[#C4998A]/15"
                  style={{ animationDelay: "0.9s" }}
                />
                <div className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-[#D4A99A] to-[#C4998A] text-[#FFF9F3] shadow-[0_12px_28px_rgba(196,153,138,0.35)]">
                  <MicIcon className="h-8 w-8" />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={reportLoading}
                aria-label={hasHistory ? "继续对话" : "开始对话"}
                className="group relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-[#8A7B6A] to-[#6E5F52] text-[#FAF8F3] shadow-[0_12px_28px_rgba(110,95,82,0.28)] transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute inset-0 rounded-full bg-white/10 opacity-0 transition group-hover:opacity-100" />
                <MicIcon className="relative h-8 w-8" />
              </button>
            )}

            <p className="text-[11px] tracking-wide text-[#B5A997]">
              {isActive
                ? typingTestMode
                  ? "打字测试 · 底部输入发送"
                  : "麦克风开着 · 随时开口"
                : hasHistory
                  ? "轻触继续对话"
                  : "轻触开始"}
            </p>

            {!isActive && canGenerateReport ? (
              <button
                type="button"
                onClick={onEndAndReport}
                disabled={reportLoading}
                className="mt-1 rounded-full border border-[#E0D2C4] bg-white/70 px-5 py-2.5 text-xs font-medium text-[#7C6B5D] shadow-sm transition hover:bg-[#FAF4EC] disabled:cursor-not-allowed disabled:opacity-60"
              >
                结束本次对话并生成复盘
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
