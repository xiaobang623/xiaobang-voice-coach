import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportJSON, SessionSettings } from "../types";
import type { UseVoiceSessionResult } from "../hooks/useVoiceSession";
import { SPEED_OPTIONS, VOICE_OPTIONS } from "../config/session";
import { ReportView } from "./ReportView";
import { TopicBridge } from "./TopicBridge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { SlidersIcon } from "./ui/icons";
import { VoiceAvatar } from "./ui/VoiceAvatar";
import type { TopicOption } from "../types";

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
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-text-secondary transition hover:bg-bg-warm/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <VoiceAvatar voiceId={value} label={selected.label} />
        <span className="min-w-0 flex-1 truncate font-medium">{selected.label}</span>
        {selected.verified === false ? (
          <span className="shrink-0 rounded-full bg-bg-warm px-1.5 py-0.5 text-[10px] text-text-muted">
            未验证
          </span>
        ) : null}
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && !disabled ? (
        <ul
          role="listbox"
          aria-label="音色"
          className="absolute top-[calc(100%+6px)] left-0 z-50 w-52 overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised py-1 shadow-elevated"
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
                    active ? "bg-accent-soft/60 text-text" : "text-text-secondary hover:bg-surface"
                  }`}
                >
                  <VoiceAvatar voiceId={option.id} label={option.label} size="sm" />
                  <span className="flex-1 font-medium">{option.label}</span>
                  {option.verified === false ? (
                    <span className="text-[10px] text-text-muted">未验证</span>
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
      ? "bg-accent shadow-[0_0_0_3px_rgba(184,132,110,0.25)]"
      : status === "connecting"
        ? "bg-accent-muted animate-pulse"
        : status === "paused"
          ? "bg-text-muted"
          : "bg-border";

  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />;
}

function CoachAvatar({ active }: { active: boolean }) {
  return (
    <div className="relative">
      {active ? (
        <>
          <span className="session-ripple absolute inset-0 rounded-full border border-accent/30" />
          <span
            className="session-ripple absolute inset-0 rounded-full border border-accent/20"
            style={{ animationDelay: "0.8s" }}
          />
        </>
      ) : (
        <span className="session-breathe absolute -inset-3 rounded-full bg-accent-soft/40" />
      )}
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-surface to-accent-soft shadow-elevated ring-4 ring-surface-raised/80">
        <svg
          className="h-9 w-9 text-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
        </svg>
      </div>
    </div>
  );
}

export interface VoiceSessionProps {
  voice: UseVoiceSessionResult;
  settings: SessionSettings;
  sessionLabel: string;
  activeTopic?: TopicOption | null;
  appSessionId: string;
  usageUserId?: string | null;
  usageGuestId?: string | null;
  voiceType: string;
  onVoiceChange: (voiceType: string) => void;
  speedRatio: number;
  onSpeedChange: (ratio: number) => void;
  showSubtitle: boolean;
  onShowSubtitleChange: (show: boolean) => void;
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
  activeTopic,
  appSessionId,
  usageUserId,
  usageGuestId,
  voiceType,
  onVoiceChange,
  speedRatio,
  onSpeedChange,
  showSubtitle,
  onShowSubtitleChange,
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
  const [typingTestMode, setTypingTestMode] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
  const [controlsOpen, setControlsOpen] = useState(false);

  const revealMessage = useCallback((id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const handleStart = useCallback(() => {
    void start({
      sessionId: appSessionId,
      userId: usageUserId,
      guestId: usageGuestId,
      voiceType: settings.voiceType,
      speedRatio: settings.speedRatio,
      systemPrompt: settings.systemPrompt,
      typingTestMode: import.meta.env.DEV && typingTestMode,
    });
  }, [start, appSessionId, usageUserId, usageGuestId, settings, typingTestMode]);

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

  const emptyHint = (() => {
    if (isActive) {
      return typingTestMode
        ? "打字测试模式 · 在底部输入英文发送"
        : activeTopic
          ? "说点什么吧，从这个话题接着聊"
          : "说点什么吧，我听着呢";
    }
    if (hasHistory) {
      return typingTestMode
        ? "点下方麦克风继续，或用打字测试"
        : "点下方麦克风继续聊";
    }
    if (typingTestMode) {
      return "开启打字测试后，点麦克风开始（无需开口）";
    }
    if (activeTopic) {
      return "点麦克风，小榜会从这个话题跟你开口";
    }
    return "点麦克风，随便聊点什么都行";
  })();

  const showTopicBridge = activeTopic && messages.length === 0 && !report;

  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <section className="animate-fade-up flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="relative z-20 mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <SessionStatusDot status={statusTone} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{sessionLabel}</p>
            <p className="truncate text-xs text-text-muted">{statusLine}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
              className={`flex h-10 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                typingTestMode
                  ? "border-accent bg-accent-soft/50 text-accent"
                  : "border-border-subtle bg-surface-raised text-text-secondary shadow-card hover:text-accent"
              }`}
            >
              <span aria-hidden="true">⌨️</span>
              <span className="hidden sm:inline">打字测试</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setControlsOpen((open) => !open)}
            aria-expanded={controlsOpen}
            aria-label="练习设置"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
              controlsOpen
                ? "border-accent bg-accent-soft/50 text-accent"
                : "border-border-subtle bg-surface-raised text-text-secondary shadow-card hover:text-accent"
            }`}
          >
            <SlidersIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {controlsOpen ? (
        <Card variant="elevated" className="relative z-20 mt-3 overflow-hidden">
          <div className="flex flex-col divide-y divide-border-subtle sm:flex-row sm:items-stretch sm:divide-x sm:divide-y-0">
            <VoicePicker
              value={voiceType}
              disabled={sessionLocked}
              onChange={onVoiceChange}
            />

            <div
              className={`flex shrink-0 items-center gap-2 px-3 py-2.5 ${sessionLocked ? "opacity-50" : ""}`}
              title={sessionLocked ? "对话进行中暂不可改，请先暂停" : undefined}
            >
              <span className="hidden text-[10px] font-medium tracking-wide text-text-muted uppercase sm:inline">
                语速
              </span>
              <div className="inline-flex rounded-full bg-bg-warm p-0.5">
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
                          ? "bg-surface-raised text-text shadow-card"
                          : "text-text-muted hover:text-text-secondary disabled:hover:text-text-muted"
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
              onClick={() => onShowSubtitleChange(!showSubtitle)}
              aria-pressed={!showSubtitle}
              title={showSubtitle ? "关掉字幕，纯听力练习" : "打开字幕"}
              className="inline-flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium text-text-secondary transition hover:bg-bg-warm/50"
            >
              {showSubtitle ? (
                <EyeIcon className="h-3.5 w-3.5 text-text-muted" />
              ) : (
                <EyeOffIcon className="h-3.5 w-3.5 text-text-muted" />
              )}
              <span className="hidden sm:inline">{showSubtitle ? "字幕" : "纯听"}</span>
            </button>
          </div>
        </Card>
      ) : null}

      <Card variant="inset" className="relative mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-accent-soft/30 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute right-0 bottom-24 h-36 w-36 rounded-full bg-accent-muted/20 blur-3xl"
          aria-hidden="true"
        />

        {errorMessage ? (
          <div className="relative z-10 mx-4 mt-4 rounded-2xl bg-error-bg px-4 py-3 text-sm text-error">
            {errorMessage}
          </div>
        ) : null}

        {showTopicBridge && activeTopic ? <TopicBridge topic={activeTopic} /> : null}

        {showTopicBridge && !activeTopic ? (
          <Card
            variant="ghost"
            className="animate-fade-up mx-4 mt-4 border border-border-subtle bg-surface-raised/80 p-4"
          >
            <p className="text-base font-medium text-text">自由畅聊</p>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              没有固定话题，点麦克风想到什么说什么就行
            </p>
          </Card>
        ) : null}

        <div ref={listRef} className="relative z-10 flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex min-h-[min(44vh,360px)] flex-col items-center justify-center px-6 text-center">
              <CoachAvatar active={isActive} />
              <p className="mt-8 text-base font-medium text-text-secondary">{emptyHint}</p>
              {!showSubtitle ? (
                <p className="mt-2 max-w-xs text-xs leading-relaxed text-text-muted">
                  字幕已关 · 点气泡可看单句
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {!showTopicBridge && activeTopic ? (
                <p className="mb-4 text-center text-xs text-text-muted">
                  话题：{activeTopic.title}
                </p>
              ) : null}
              <div className="mb-6 flex flex-col items-center text-center">
                <CoachAvatar active={isActive} />
                {latestMessage && (showSubtitle || latestMessage.role === "user" || revealedIds.has(latestMessage.id)) ? (
                  <div className="mt-5 max-w-sm rounded-2xl border border-border-subtle bg-surface-raised/90 px-4 py-3 shadow-card backdrop-blur-sm">
                    <p className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
                      {latestMessage.role === "user" ? "你刚说" : "小榜"}
                    </p>
                    <p
                      className={`mt-1 text-[15px] leading-relaxed ${
                        latestMessage.isFinal ? "text-text" : "text-text-muted italic"
                      }`}
                    >
                      {latestMessage.text}
                    </p>
                  </div>
                ) : latestMessage?.role === "bot" ? (
                  <button
                    type="button"
                    onClick={() => revealMessage(latestMessage.id)}
                    className="mt-5 rounded-full border border-dashed border-accent-muted px-4 py-2 text-xs text-text-muted transition hover:border-accent hover:text-text-secondary"
                  >
                    点开看最新一句
                  </button>
                ) : null}
              </div>

              <ul className="space-y-3 border-t border-border-subtle/60 pt-4 pb-2">
                {messages.map((message) =>
                  message.role === "user" ? (
                    <li key={message.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-[18px] rounded-br-sm bg-accent px-4 py-2.5 text-surface shadow-card">
                        <p
                          className={`text-[15px] leading-relaxed ${
                            message.isFinal ? "" : "opacity-80 italic"
                          }`}
                        >
                          {message.text}
                        </p>
                      </div>
                    </li>
                  ) : (
                    <li key={message.id} className="flex items-start justify-start gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft ring-2 ring-surface-raised">
                        <svg
                          className="h-3.5 w-3.5 text-accent"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="8" r="3.5" />
                          <path d="M5 19c0-2.8 3.1-5 7-5s7 2.2 7 5" />
                        </svg>
                      </span>
                      {showSubtitle || revealedIds.has(message.id) ? (
                        <div className="max-w-[85%] rounded-[18px] rounded-bl-sm border border-border-subtle bg-surface-raised px-4 py-2.5 shadow-card">
                          <p className="text-[15px] leading-relaxed text-text">{message.text}</p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => revealMessage(message.id)}
                          title="点一下看这句"
                          className="flex max-w-[85%] items-center gap-2 rounded-[18px] rounded-bl-sm border border-dashed border-accent-muted bg-surface/80 px-4 py-2.5 text-left shadow-card transition hover:border-accent hover:bg-surface"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-xs">
                            🔊
                          </span>
                          <span className="text-[14px] italic leading-relaxed text-text-muted">
                            {message.isFinal ? "听完啦 · 点开看这句" : "正在说…"}
                          </span>
                        </button>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </>
          )}

          {reportLoading ? (
            <div className="mt-8 flex flex-col items-center gap-3 py-6">
              <span className="h-8 w-8 animate-pulse rounded-full bg-accent-soft" />
              <p className="text-sm text-text-muted">正在整理今天的复盘…</p>
            </div>
          ) : null}

          {reportError ? (
            <div className="mt-6 rounded-2xl bg-error-bg px-5 py-3 text-sm text-error">{reportError}</div>
          ) : null}

          {report ? (
            <div className="mt-6 border-t-2 border-accent/30 pt-2">
              <ReportView report={report} wordCount={wordCount} sentenceCount={sentenceCount} />
            </div>
          ) : null}
        </div>

        <div className="relative z-10 h-7 px-4">
          {hint ? (
            <p className="animate-pulse text-center text-xs text-text-muted">{hint}</p>
          ) : null}
        </div>

        <div className="relative z-10 border-t border-border-subtle bg-surface/80 px-4 py-5 backdrop-blur-md">
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
                className="min-w-0 flex-1 rounded-full border border-border bg-surface-raised px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
              />
              <Button
                type="submit"
                size="sm"
                disabled={status === "connecting" || !draftText.trim()}
              >
                发送
              </Button>
            </form>
          ) : null}

          {isActive ? (
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => stop()}
                disabled={status === "connecting" || reportLoading}
              >
                <PauseIcon className="h-3.5 w-3.5" />
                暂停
              </Button>
              {canGenerateReport ? (
                <Button size="sm" onClick={onEndAndReport} disabled={reportLoading}>
                  结束并复盘
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            {isActive ? (
              <div
                className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center"
                aria-hidden="true"
              >
                <span className="session-ripple absolute inset-0 rounded-full bg-accent/20" />
                <span
                  className="session-ripple absolute inset-0 rounded-full bg-accent/15"
                  style={{ animationDelay: "0.9s" }}
                />
                <div className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-accent-muted to-accent text-surface shadow-elevated">
                  <MicIcon className="h-8 w-8" />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={reportLoading}
                aria-label={hasHistory ? "继续对话" : "开始对话"}
                className="group relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-text-secondary to-text text-surface shadow-elevated transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute inset-0 rounded-full bg-white/10 opacity-0 transition group-hover:opacity-100" />
                <MicIcon className="relative h-8 w-8" />
              </button>
            )}

            <p className="text-[11px] tracking-wide text-text-muted">
              {isActive
                ? typingTestMode
                  ? "打字测试 · 底部输入发送"
                  : "麦克风开着 · 随时开口"
                : hasHistory
                  ? "轻触继续对话"
                  : "轻触开始"}
            </p>

            {!isActive && canGenerateReport ? (
              <Button variant="outline" size="sm" onClick={onEndAndReport} disabled={reportLoading}>
                结束本次对话并生成复盘
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
