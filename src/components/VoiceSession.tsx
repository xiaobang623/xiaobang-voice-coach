import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReportJSON, SessionSettings, TaskScenario, TopicOption, VoiceOption } from "../types";
import type { UseVoiceSessionResult } from "../hooks/useVoiceSession";
import { SPEED_OPTIONS } from "../config/session";
import { isTypingTestAvailable } from "../config/features";
import { ReportView } from "./ReportView";
import { TaskCard } from "./TaskCard";
import { TaskChecklist } from "./TaskChecklist";
import { TopicBridge, CoachOpeningBubble } from "./TopicBridge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { KeyboardIcon, SlidersIcon, SpeakerIcon } from "./ui/icons";
import { Mascot, type MascotExpression } from "./ui/Mascot";
import { VoiceAvatar } from "./ui/VoiceAvatar";

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

function UserListeningBubble() {
  return (
    <span className="flex h-5 items-center gap-1" aria-label="正在听">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-surface/90"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

interface VoicePickerProps {
  value: string;
  options: VoiceOption[];
  disabled: boolean;
  onChange: (voiceType: string) => void;
}

interface VoiceMenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const VOICE_MENU_MIN_WIDTH = 208;
const VOICE_MENU_GAP = 6;
const VOICE_MENU_MAX_HEIGHT = 256;

function VoicePicker({ value, options, disabled, onChange }: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [menuPosition, setMenuPosition] = useState<VoiceMenuPosition | null>(null);
  const selected = options.find((option) => option.id === value) ?? options[0];

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const width = Math.max(rect.width, VOICE_MENU_MIN_WIDTH);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom - VOICE_MENU_GAP;
    const spaceAbove = rect.top - VOICE_MENU_GAP;
    const openDown = spaceBelow >= 120 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(
      VOICE_MENU_MAX_HEIGHT,
      Math.max(120, openDown ? spaceBelow : spaceAbove),
    );

    setMenuPosition(
      openDown
        ? { left, width, top: rect.bottom + VOICE_MENU_GAP, maxHeight }
        : { left, width, bottom: window.innerHeight - rect.top + VOICE_MENU_GAP, maxHeight },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, options.length, updateMenuPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!selected || options.length === 0) {
    return null;
  }

  const menu =
    open && !disabled && menuPosition
      ? createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-label="音色"
            style={{
              position: "fixed",
              left: menuPosition.left,
              width: menuPosition.width,
              top: menuPosition.top,
              bottom: menuPosition.bottom,
              maxHeight: menuPosition.maxHeight,
              zIndex: 1000,
            }}
            className="overflow-y-auto rounded-2xl border border-border-subtle bg-surface-raised py-1 shadow-elevated"
          >
            {options.map((option) => {
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
          </ul>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="relative min-w-0 flex-1">
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="音色"
          title={disabled ? "对话进行中暂不可改，请先暂停" : undefined}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-text-secondary transition hover:bg-bg-warm/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>
      {menu}
    </>
  );
}

function SessionStatusDot({ status }: { status: "idle" | "connecting" | "live" | "paused" }) {
  // ai-mark from redesign/voice-session.html: teal radial dot with soft ring
  const tone =
    status === "live"
      ? "bg-[radial-gradient(circle_at_32%_28%,#8FC4BE,#3F6E6B_70%)] shadow-[0_0_0_3px_rgba(143,196,190,0.14)]"
      : status === "connecting"
        ? "bg-[radial-gradient(circle_at_32%_28%,#D8B876,#A6813F_70%)] animate-pulse"
        : status === "paused"
          ? "bg-ink-on-canvas-faint"
          : "bg-[rgba(244,243,240,0.24)]";

  return <span className={`h-[18px] w-[18px] shrink-0 rounded-full ${tone}`} aria-hidden="true" />;
}

function RealtimeHintToast({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-3 top-16 z-50 max-w-[min(22rem,calc(100%-1.5rem))] animate-fade-up rounded-2xl border border-white/12 bg-surface-canvas-raised/92 px-3.5 py-3 text-ink-on-canvas shadow-elevated backdrop-blur-md md:right-7 md:top-20"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-teal/18 text-[12px] text-accent-teal">
          ✦
        </span>
        <p className="text-[12.5px] leading-snug text-ink-on-canvas-soft">{message}</p>
      </div>
    </div>
  );
}

function CoachAvatar({ status }: { status: "connecting" | "active" | "ended" }) {
  const expression: MascotExpression =
    status === "connecting" ? "thinking" : status === "active" ? "talking" : "idle";

  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft ring-2 ring-surface">
      <Mascot expression={expression} size={34} bob={false} />
    </div>
  );
}

export interface VoiceSessionProps {
  voice: UseVoiceSessionResult;
  settings: SessionSettings;
  sessionLabel: string;
  activeTopic?: TopicOption | null;
  activeTask?: TaskScenario | null;
  appSessionId: string;
  usageUserId?: string | null;
  usageGuestId?: string | null;
  voiceType: string;
  voiceOptions: VoiceOption[];
  showVoicePicker: boolean;
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
  sessionLabel: _sessionLabel,
  activeTopic,
  activeTask,
  appSessionId,
  usageUserId,
  usageGuestId,
  voiceType,
  voiceOptions,
  showVoicePicker,
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
  const [taskCardDismissed, setTaskCardDismissed] = useState(false);

  useEffect(() => {
    setTaskCardDismissed(false);
  }, [activeTask?.id]);

  const revealMessage = useCallback((id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const voiceTypeRef = useRef(voiceType);
  const speedRatioRef = useRef(speedRatio);
  voiceTypeRef.current = voiceType;
  speedRatioRef.current = speedRatio;

  const handleStart = useCallback(() => {
    void start({
      sessionId: appSessionId,
      userId: usageUserId,
      guestId: usageGuestId,
      voiceType: voiceTypeRef.current,
      speedRatio: speedRatioRef.current,
      systemPrompt: settings.systemPrompt,
      typingTestMode: isTypingTestAvailable() && typingTestMode,
    });
  }, [start, appSessionId, usageUserId, usageGuestId, settings.systemPrompt, typingTestMode]);

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
      if (typingTestMode) {
        return "打字测试模式 · 在底部输入英文发送";
      }
      if (activeTask) {
        return "说点什么吧，试着完成你的任务目标";
      }
      if (activeTopic) {
        return "说点什么吧，从这个话题接着聊";
      }
      return "说点什么吧，我听着呢";
    }
    if (hasHistory) {
      return typingTestMode
        ? "点下方麦克风继续，或用打字测试"
        : "点下方麦克风继续聊";
    }
    if (typingTestMode) {
      return "开启打字测试后，点麦克风开始（无需开口）";
    }
    if (activeTask && !taskCardDismissed) {
      return "先看任务目标，点「开始闯关」再开麦";
    }
    if (activeTask || activeTopic) {
      return "点麦克风，小榜会从这个场景跟你开口";
    }
    return "点麦克风，随便聊点什么都行";
  })();

  const coachExpression: MascotExpression =
    status === "connecting" ? "thinking" : status === "active" ? "talking" : "idle";

  const showTaskCard =
    activeTask && !taskCardDismissed && messages.length === 0 && !report;
  const showTopicBridge =
    !activeTask && activeTopic && messages.length === 0 && !report;
  const showTaskChecklist = activeTask && taskCardDismissed && !report;

  return (
    <section className="animate-fade-up flex min-h-0 w-full flex-1 flex-col bg-bg-canvas text-ink-on-canvas md:mx-auto md:max-w-[40rem] md:overflow-hidden md:rounded-[24px] md:border md:border-white/10">
      {hint ? <RealtimeHintToast message={hint} /> : null}

      <div className="flex shrink-0 items-center justify-between gap-2 px-1 py-1.5 md:px-4 md:pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <SessionStatusDot status={statusTone} />
          <p className="truncate text-sm tabular-nums text-ink-on-canvas-soft">{statusLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isTypingTestAvailable() ? (
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
              className={`flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.94] ${
                typingTestMode
                  ? "border-ink-on-canvas bg-ink-on-canvas text-bg-canvas"
                  : "border-[rgba(244,243,240,0.14)] bg-[rgba(244,243,240,0.08)] text-ink-on-canvas-soft hover:text-ink-on-canvas"
              }`}
            >
              <KeyboardIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">打字测试</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setControlsOpen((open) => !open)}
            aria-expanded={controlsOpen}
            aria-label="练习设置"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition active:scale-[0.94] ${
              controlsOpen
                ? "border-ink-on-canvas bg-ink-on-canvas text-bg-canvas"
                : "border-[rgba(244,243,240,0.14)] bg-[rgba(244,243,240,0.08)] text-ink-on-canvas hover:bg-[rgba(244,243,240,0.16)]"
            }`}
          >
            <SlidersIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {controlsOpen ? (
        <Card variant="elevated" className="relative z-40 mt-2 shrink-0 border-white/10 bg-surface-canvas-raised text-ink-on-canvas">
          <div className="flex flex-col divide-y divide-border-subtle sm:flex-row sm:items-stretch sm:divide-x sm:divide-y-0">
            {showVoicePicker ? (
              <VoicePicker
                value={voiceType}
                options={voiceOptions}
                disabled={sessionLocked}
                onChange={onVoiceChange}
              />
            ) : null}

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

      <div ref={listRef} className="relative z-10 mt-2 min-h-0 flex-1 overflow-y-auto px-1 md:px-4">
        {errorMessage ? (
          <div className="mb-3 rounded-2xl bg-error-bg px-4 py-3 text-sm text-error">
            {errorMessage}
          </div>
        ) : null}

        <ul className="space-y-3 pb-2">
          {showTaskCard && activeTask ? (
            <li>
              <TaskCard scenario={activeTask} onStart={() => setTaskCardDismissed(true)} />
            </li>
          ) : null}

          {showTopicBridge && activeTopic ? (
            <TopicBridge topic={activeTopic} expression={coachExpression} />
          ) : null}

          {!showTaskCard && !activeTask && !activeTopic && messages.length === 0 && !report ? (
            <CoachOpeningBubble
              text="想到什么说什么，点麦克风我先跟你打招呼～"
              expression={coachExpression}
            />
          ) : null}

          {showTaskChecklist ? (
            <li>
              <TaskChecklist goals={activeTask.goals} title={activeTask.title} />
            </li>
          ) : null}

          {messages.map((message) =>
            message.role === "user" ? (
              <li key={message.id} className="flex justify-end">
                <div className="min-w-[5.5rem] max-w-[85%] rounded-[18px] rounded-br-sm border border-white/10 bg-surface-canvas-raised px-4 py-2.5 text-ink-on-canvas">
                  {message.isListeningDraft ? (
                    <UserListeningBubble />
                  ) : (
                    <p
                      className={`break-words text-[15px] leading-relaxed ${
                        message.isFinal ? "" : "opacity-80 italic"
                      }`}
                    >
                      {message.text}
                    </p>
                  )}
                </div>
              </li>
            ) : (
              <li key={message.id} className="flex items-end gap-2.5">
                <CoachAvatar
                  status={
                    message.isFinal
                      ? status === "active"
                        ? "active"
                        : "ended"
                      : "active"
                  }
                />
                {showSubtitle || revealedIds.has(message.id) ? (
                  <div className="min-w-[5.5rem] max-w-[85%] rounded-[18px] rounded-bl-md border border-white/10 bg-surface-canvas-raised px-4 py-2.5">
                    <p className="break-words text-[15px] leading-relaxed text-ink-on-canvas">{message.text}</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => revealMessage(message.id)}
                    title="点一下看这句"
                    className="flex min-w-[5.5rem] max-w-[85%] items-center gap-2 rounded-[18px] rounded-bl-md border border-dashed border-accent-muted bg-surface/80 px-4 py-2.5 text-left shadow-card transition active:scale-[0.98]"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <SpeakerIcon className="h-3.5 w-3.5" />
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

        {reportLoading ? (
          <div className="mt-6 flex flex-col items-center gap-3 py-4">
            <Mascot expression="thinking" size={40} />
            <p className="text-sm text-ink-on-canvas-soft">正在整理今天的复盘…</p>
          </div>
        ) : null}

        {reportError ? (
          <div className="mt-4 rounded-2xl bg-error-bg px-5 py-3 text-sm text-error">{reportError}</div>
        ) : null}

        {report ? (
          <div className="mt-4 rounded-t-[24px] bg-bg p-5 text-text">
            <ReportView
              report={report}
              wordCount={wordCount}
              sentenceCount={sentenceCount}
              taskGoals={activeTask?.goals}
            />
          </div>
        ) : null}
      </div>

      <div className="relative z-10 shrink-0 rounded-b-[24px] border-t border-white/10 bg-surface-canvas-raised/90 px-4 py-4 backdrop-blur-md md:px-6 md:py-5">
          {isTypingTestAvailable() && typingTestMode && isActive ? (
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
                className="min-w-0 flex-1 rounded-full border border-white/15 bg-bg-canvas px-4 py-2.5 text-sm text-ink-on-canvas placeholder:text-ink-on-canvas-faint focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60"
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
                className="!border-[rgba(244,243,240,0.18)] !bg-[rgba(244,243,240,0.1)] !text-ink-on-canvas backdrop-blur-[16px] hover:!bg-[rgba(244,243,240,0.16)]"
              >
                <PauseIcon className="h-3.5 w-3.5" />
                暂停
              </Button>
              {canGenerateReport ? (
                <Button
                  size="sm"
                  onClick={onEndAndReport}
                  disabled={reportLoading}
                  className="!bg-rust !text-[#FBEEE8]"
                >
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
                <span className="session-ripple absolute inset-0 rounded-full bg-accent-teal/20" />
                <span
                  className="session-ripple absolute inset-0 rounded-full bg-accent-teal/15"
                  style={{ animationDelay: "0.9s" }}
                />
                <div className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-ink-on-canvas text-bg-canvas shadow-elevated">
                  <MicIcon className="h-8 w-8" />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={reportLoading}
                aria-label={hasHistory ? "继续对话" : "开始对话"}
                className="group relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-ink-on-canvas text-bg-canvas shadow-elevated transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:scale-[1.04] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute inset-0 rounded-full bg-white/10 opacity-0 transition group-hover:opacity-100" />
                <MicIcon className="relative h-8 w-8" />
              </button>
            )}

            <p className="text-center text-[12.5px] text-ink-on-canvas-faint">
              {isActive
                ? typingTestMode
                  ? "打字测试 · 底部输入发送"
                  : "麦克风开着 · 随时开口"
                : hasHistory
                  ? "轻触继续对话"
                  : emptyHint}
            </p>

            {!isActive && canGenerateReport ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onEndAndReport}
                disabled={reportLoading}
                className="!border-[rgba(244,243,240,0.18)] !bg-[rgba(244,243,240,0.1)] !text-ink-on-canvas backdrop-blur-[16px] hover:!bg-[rgba(244,243,240,0.16)]"
              >
                结束本次对话并生成复盘
              </Button>
            ) : null}
          </div>
      </div>
    </section>
  );
}
