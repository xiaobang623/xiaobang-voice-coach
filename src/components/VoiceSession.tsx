import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ExpressionPracticeContext,
  PracticeMode,
  ReportJSON,
  SessionSettings,
  TalkDirection,
  TaskScenario,
  TopicOption,
  VoiceOption,
} from "../types";
import type { UseVoiceSessionResult } from "../hooks/useVoiceSession";
import { SPEED_OPTIONS } from "../config/session";
import { FREE_TALK_DIRECTIONS, pickDirections } from "../config/chatTopics";
import { isTypingTestAvailable } from "../config/features";
import { trackEventOnce } from "../core/analytics";
import { TaskCard } from "./TaskCard";
import { TaskChecklist } from "./TaskChecklist";
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

function SessionGuideBanner({
  activeTask,
}: {
  activeTask?: TaskScenario | null;
}) {
  const body = activeTask
    ? "继续按角色场景回答，完成当前小目标。"
    : "跟着小榜的问题继续说，答短一点也可以。";

  return (
    <li className="sticky top-2 z-20">
      <div className="mx-auto flex max-w-[86%] items-center justify-center rounded-full border border-white/10 bg-bg-canvas/72 px-3 py-1.5 text-[12px] text-ink-on-canvas-faint shadow-card backdrop-blur-md">
        <span className="truncate">{body}</span>
      </div>
    </li>
  );
}

const OPENING_GUIDE_DIRECTION_COUNT = 3;

function OpeningPrepSheet({
  activeTopic,
  activeTask,
  aiDirections,
  status,
  errorMessage,
  readyPending,
  onReady,
  onRetry,
  expressionPracticeContext,
}: {
  activeTopic?: TopicOption | null;
  activeTask?: TaskScenario | null;
  /**
   * AI-generated directions prefetched when the user picked this topic/task
   * (see useOpeningDirections). The prep page renders static directions
   * immediately, then softly swaps to AI/personalized directions if they arrive
   * before the user starts.
   */
  aiDirections?: TalkDirection[] | null;
  status: "connecting" | "active" | "ended";
  errorMessage: string | null;
  readyPending: boolean;
  onReady: () => void;
  onRetry: () => void;
  expressionPracticeContext?: ExpressionPracticeContext | null;
}) {
  const staticPool =
    (activeTask?.directions?.length ? activeTask.directions : undefined) ??
    (activeTopic?.directions?.length ? activeTopic.directions : undefined) ??
    FREE_TALK_DIRECTIONS;
  const pool = aiDirections && aiDirections.length > 0 ? aiDirections : staticPool;
  const [shown, setShown] = useState<TalkDirection[]>(() =>
    pickDirections(staticPool, OPENING_GUIDE_DIRECTION_COUNT),
  );
  const appliedAiDirectionsRef = useRef(false);

  useEffect(() => {
    if (!aiDirections || aiDirections.length === 0 || appliedAiDirectionsRef.current) {
      return;
    }
    appliedAiDirectionsRef.current = true;
    setShown(pickDirections(aiDirections, OPENING_GUIDE_DIRECTION_COUNT));
  }, [aiDirections]);

  const targetExpressions = expressionPracticeContext?.targetExpressions.slice(0, 3) ?? [];
  const isExpressionPractice = targetExpressions.length > 0;
  const title = isExpressionPractice
    ? "试着用上这些表达"
    : activeTask
      ? `先用一句英文进入场景`
      : "先准备一句，再开口";
  const subtitle = isExpressionPractice
    ? "不用刻意背，聊到合适的时候用出来就行。"
    : activeTask
      ? `「${activeTask.title}」不用演完整，先开个头就行。`
      : activeTopic
        ? `聊「${activeTopic.title}」，选一个方向先说一句。`
        : "选一个方向，先说一句真实想说的英文。";
  const statusCopy = errorMessage
    ? { label: "连接没成功", body: "检查麦克风或重试连接", tone: "text-error bg-error-bg border-error/30" }
    : status === "active"
      ? { label: "已准备好", body: "点按钮后开始收音", tone: "text-accent-teal-on-canvas bg-accent-teal/14 border-accent-teal/25" }
      : { label: "连接中", body: "可以先想第一句", tone: "text-accent-gold-on-canvas bg-spark/14 border-spark/25" };
  const primaryLabel = errorMessage
    ? "重试连接"
    : readyPending || status === "connecting"
      ? "小榜马上就好…"
      : "我准备好了";
  const primaryDisabled = !errorMessage && (readyPending || status === "connecting");

  return (
    <li
      className={`animate-fade-up flex h-full py-2 ${
        isExpressionPractice ? "min-h-0 items-start" : "min-h-[28rem] items-center"
      }`}
    >
      <div className="w-full rounded-[24px] border border-[rgba(244,243,240,0.14)] bg-surface-canvas-raised px-4 py-4 text-ink-on-canvas shadow-elevated md:px-5 md:py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-canvas-chip ring-1 ring-[rgba(244,243,240,0.12)]">
            <Mascot expression={status === "connecting" ? "thinking" : "idle"} size={42} bob={false} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12px] font-semibold tracking-[0.08em] text-ink-on-canvas-faint uppercase">
                开口准备
              </p>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusCopy.tone}`}>
                {statusCopy.label} · {statusCopy.body}
              </span>
            </div>
            <h2 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight text-ink-on-canvas">
              {title}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-on-canvas-soft">
              {subtitle}
            </p>
          </div>
        </div>

        {isExpressionPractice ? (
          <div className="mt-4 max-h-[10rem] space-y-2.5 overflow-y-auto pr-1">
            {targetExpressions.map((expression, index) => (
              <div
                key={`${expression.text}-${index}`}
                className="w-full rounded-2xl border border-[rgba(244,243,240,0.14)] bg-bg-canvas px-3.5 py-2.5 text-left"
              >
                <span className="block text-[14.5px] font-semibold leading-snug text-ink-on-canvas">
                  {expression.text}
                </span>
                {expression.meaning ? (
                  <span className="mt-1 block text-[13px] leading-snug text-ink-on-canvas-soft">
                    {expression.meaning}
                  </span>
                ) : null}
                {expression.example ? (
                  <span className="mt-1.5 block text-[12.5px] italic leading-snug text-ink-on-canvas-faint">
                    例：{expression.example}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[13px] font-semibold text-ink-on-canvas-soft">选一个方向，借一句开头</p>
              <button
                type="button"
                onClick={() =>
                  setShown((current) => pickDirections(pool, OPENING_GUIDE_DIRECTION_COUNT, current))
                }
                className="shrink-0 rounded-full border border-[rgba(244,243,240,0.14)] bg-surface-canvas-chip px-3 py-1.5 text-[12px] font-medium text-ink-on-canvas-soft transition hover:bg-white/10 hover:text-ink-on-canvas active:scale-[0.97]"
              >
                🎲 换一批
              </button>
            </div>

            <div className="mt-2.5 space-y-2">
              {shown.map((direction) => (
                <div
                  key={direction.zh}
                  className="w-full rounded-2xl border border-[rgba(244,243,240,0.14)] bg-bg-canvas px-3.5 py-3 text-left"
                >
                  <span className="block text-[15px] font-semibold leading-snug text-ink-on-canvas">
                    {direction.zh}
                  </span>
                  {direction.en ? (
                    <span className="mt-1 block text-[13px] italic leading-snug text-ink-on-canvas-soft">
                      {direction.en}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-3">
          <p className="text-[12px] leading-relaxed text-ink-on-canvas-faint">
            不会写入聊天记录，点按钮后才开始收音。
          </p>
          <Button
            size="md"
            onClick={errorMessage ? onRetry : onReady}
            disabled={primaryDisabled}
            className="!rounded-full !bg-ink-on-canvas !px-5 !text-bg-canvas"
          >
            {primaryLabel}
          </Button>
        </div>
      </div>
    </li>
  );
}


function TargetExpressionChips({ context }: { context?: ExpressionPracticeContext | null }) {
  const expressions = context?.targetExpressions.slice(0, 3) ?? [];
  if (expressions.length === 0) {
    return null;
  }

  return (
    <div className="relative z-20 shrink-0 px-1 pt-1 md:px-4">
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-white/10 bg-surface-canvas-raised/70 px-2.5 py-2 backdrop-blur-md">
        {expressions.map((expression, index) => (
          <span
            key={`${expression.text}-${index}`}
            className="max-w-full truncate rounded-full border border-accent-teal/25 bg-accent-teal/12 px-2.5 py-1 text-[11.5px] font-medium text-accent-teal-on-canvas"
            title={expression.meaning ? `${expression.text} · ${expression.meaning}` : expression.text}
          >
            {expression.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function CoachAvatar({ status }: { status: "connecting" | "active" | "ended" }) {
  const expression: MascotExpression =
    status === "connecting" ? "thinking" : status === "active" ? "talking" : "idle";

  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft ring-2 ring-surface">
      <Mascot expression={expression} size={32} bob={false} className="translate-y-[1px]" />
    </div>
  );
}

export interface VoiceSessionProps {
  voice: UseVoiceSessionResult;
  settings: SessionSettings;
  sessionLabel: string;
  practiceMode?: PracticeMode;
  expressionPracticeContext?: ExpressionPracticeContext | null;
  activeTopic?: TopicOption | null;
  activeTask?: TaskScenario | null;
  /** Prefetched AI opening directions for the active topic/task, if ready. */
  aiDirections?: TalkDirection[] | null;
  appSessionId: string;
  usageUserId?: string | null;
  usageGuestId?: string | null;
  analyticsUserId?: string | null;
  analyticsGuestId?: string | null;
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
  onEndAndReport: () => void;
  onViewReport: () => void;
}

export function VoiceSession({
  voice,
  settings,
  sessionLabel: _sessionLabel,
  practiceMode = "normal",
  expressionPracticeContext,
  activeTopic,
  activeTask,
  aiDirections,
  appSessionId,
  usageUserId,
  usageGuestId,
  analyticsUserId,
  analyticsGuestId,
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
  onEndAndReport,
  onViewReport,
}: VoiceSessionProps) {
  const {
    status,
    messages,
    errorMessage,
    hint,
    startedAt,
    activeAsrProvider,
    start,
    enableInput,
    stop,
    sendTextQuery,
  } = voice;
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [now, setNow] = useState(() => Date.now());
  const [typingTestMode, setTypingTestMode] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
  const [controlsOpen, setControlsOpen] = useState(false);
  const [taskCardDismissed, setTaskCardDismissed] = useState(false);
  const [openingPrepared, setOpeningPrepared] = useState(false);
  const [readyRequested, setReadyRequested] = useState(false);

  const openingFlowKey =
    practiceMode === "expression_practice" && expressionPracticeContext?.targetExpressions.length
      ? `expression-practice:${expressionPracticeContext.sourceReportId ?? expressionPracticeContext.targetExpressions.map((item) => item.text).join("|")}`
      : activeTask?.id ?? activeTopic?.id ?? "free-talk";
  const analyticsTopic =
    practiceMode === "expression_practice"
      ? "expression_practice"
      : activeTask?.id ?? activeTopic?.id ?? "free-talk";

  // 开口漏斗埋点：准备页展示时间 / 点「我准备好了」时间，用于 waitedMs 和 msFromReady。
  const prepShownAtRef = useRef(Date.now());
  const readyAtRef = useRef<number | null>(null);
  const openingFlowKeyRef = useRef(openingFlowKey);
  openingFlowKeyRef.current = openingFlowKey;

  // 开口漏斗埋点：进入对话页（每个 appSessionId 记一次）。
  useEffect(() => {
    prepShownAtRef.current = Date.now();
    readyAtRef.current = null;
    trackEventOnce(`enter_session:${appSessionId}`, "enter_session", {
      userId: analyticsUserId,
      guestId: analyticsGuestId,
      sessionId: appSessionId,
      props: { topic: analyticsTopic },
    });
  }, [analyticsGuestId, analyticsTopic, analyticsUserId, appSessionId]);

  useEffect(() => {
    setTaskCardDismissed(false);
  }, [activeTask?.id]);

  useEffect(() => {
    setOpeningPrepared(false);
    setReadyRequested(false);
  }, [openingFlowKey]);

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

  const isActive = status === "active" || status === "connecting";
  const sessionLocked = isActive;
  const hasHistory = messages.length > 0;
  const userHasSpoken = messages.some((message) => message.role === "user" && message.text.trim().length > 0);
  const userHasFinalUtterance = messages.some(
    (message) =>
      message.role === "user" && message.isFinal && message.text.trim().length > 0,
  );
  const canGenerateReport = userHasSpoken && !report && !reportLoading;

  // 开口漏斗埋点：用户说出第一句（每个会话记一次）。
  useEffect(() => {
    if (!userHasFinalUtterance) {
      return;
    }
    trackEventOnce(`first_utterance:${appSessionId}`, "first_utterance", {
      userId: analyticsUserId,
      guestId: analyticsGuestId,
      sessionId: appSessionId,
      props:
        readyAtRef.current !== null
          ? { msFromReady: Math.max(0, Date.now() - readyAtRef.current) }
          : {},
    });
  }, [analyticsGuestId, analyticsUserId, userHasFinalUtterance, appSessionId]);

  const handleStart = useCallback((waitForUserReady = false) => {
    void start({
      sessionId: appSessionId,
      userId: usageUserId,
      guestId: usageGuestId,
      voiceType: voiceTypeRef.current,
      speedRatio: speedRatioRef.current,
      systemPrompt: settings.systemPrompt,
      // Coach no longer auto-opens; the user speaks first after the prep sheet.
      typingTestMode: isTypingTestAvailable() && typingTestMode,
      waitForUserReady,
    });
  }, [
    start,
    appSessionId,
    usageUserId,
    usageGuestId,
      settings.systemPrompt,
    typingTestMode,
  ]);

  const handleOpeningReady = useCallback(() => {
    // 开口漏斗埋点：点「我准备好了」（每个会话记一次，重试点击不重复计）。
    if (readyAtRef.current === null) {
      readyAtRef.current = Date.now();
    }
    trackEventOnce(`ready_click:${appSessionId}`, "ready_click", {
      userId: analyticsUserId,
      guestId: analyticsGuestId,
      sessionId: appSessionId,
      props: {
        waitedMs: Math.max(0, Date.now() - prepShownAtRef.current),
        topic: analyticsTopic,
      },
    });

    if (errorMessage) {
      setReadyRequested(false);
      handleStart(true);
      return;
    }
    if (status === "active") {
      enableInput();
      setOpeningPrepared(true);
      setReadyRequested(false);
      return;
    }
    setReadyRequested(true);
    if (status === "ended") {
      handleStart(true);
    }
  }, [
    analyticsGuestId,
    analyticsTopic,
    analyticsUserId,
    appSessionId,
    enableInput,
    errorMessage,
    handleStart,
    status,
  ]);

  const handleOpeningRetry = useCallback(() => {
    setReadyRequested(false);
    handleStart(true);
  }, [handleStart]);

  const handleSendText = useCallback(() => {
    const text = draftText.trim();
    if (!text) {
      return;
    }
    sendTextQuery(text);
    setDraftText("");
  }, [draftText, sendTextQuery]);

  const statusTone: "idle" | "connecting" | "live" | "paused" =
    status === "connecting"
      ? "connecting"
      : status === "active"
        ? "live"
        : hasHistory
          ? "paused"
          : "idle";

  // 贴底跟随：用户在底部附近时新消息平滑滚入；往上翻历史时不打扰。
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const handleScroll = () => {
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 120;
    };
    list.addEventListener("scroll", handleScroll, { passive: true });
    return () => list.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottomRef.current || messages.length === 0) {
      return;
    }
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages]);

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
      return userHasSpoken ? `对话中 · ${formatElapsed(startedAt, now)}` : "";
    }
    if (reportLoading && !report) {
      return "正在生成复盘，稍等一下…";
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
      if (!userHasSpoken) {
        if (activeTask) {
          return "你先开口，说一句简单英文，小榜会进入角色";
        }
        return "小榜在听 · 先说一句简单英文";
      }
      if (activeAsrProvider === "platform-native-asr") {
        return "平台原生 ASR 已开启，说话会实时转成文字";
      }
      return "小榜在听 · 随时接着说";
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

  const showTaskCard =
    activeTask && !taskCardDismissed && messages.length === 0 && !report;
  const showTaskChecklist = activeTask && taskCardDismissed && !report;
  const shouldUseOpeningPrep =
    !hasHistory && !report && !typingTestMode && !showTaskCard && !reportLoading;
  const showOpeningPrep = shouldUseOpeningPrep && !openingPrepared && !userHasSpoken;
  const showGuideBanner =
    isActive && (userHasSpoken || openingPrepared) && !errorMessage && !report;

  useEffect(() => {
    if (!shouldUseOpeningPrep || status !== "ended" || errorMessage) {
      return;
    }
    handleStart(true);
  }, [errorMessage, handleStart, shouldUseOpeningPrep, status]);

  useEffect(() => {
    if (!readyRequested || status !== "active") {
      return;
    }
    enableInput();
    setOpeningPrepared(true);
    setReadyRequested(false);
  }, [enableInput, readyRequested, status]);

  useEffect(() => {
    if (errorMessage) {
      setReadyRequested(false);
    }
  }, [errorMessage]);

  return (
    <section className="animate-fade-up flex min-h-0 h-full w-full flex-1 flex-col overflow-hidden bg-bg-canvas text-ink-on-canvas md:mx-auto md:max-w-[40rem] md:rounded-[24px] md:border md:border-white/10">
      {hint ? <RealtimeHintToast message={hint} /> : null}

      <div className="flex shrink-0 items-center justify-between gap-2 px-1 py-1.5 md:px-4 md:pt-4">
        {statusLine ? (
          <div className="flex min-w-0 items-center gap-2">
            <SessionStatusDot status={statusTone} />
            <p className="truncate text-sm tabular-nums text-ink-on-canvas-soft">{statusLine}</p>
          </div>
        ) : (
          <span className="min-w-0 flex-1" aria-hidden="true" />
        )}
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

      {practiceMode === "expression_practice" && !showOpeningPrep ? (
        <TargetExpressionChips context={expressionPracticeContext} />
      ) : null}

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

      <div
        ref={listRef}
        className="relative z-10 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 md:px-4"
      >
        {errorMessage && !showOpeningPrep ? (
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

          {showTaskChecklist ? (
            <li>
              <TaskChecklist goals={activeTask.goals} title={activeTask.title} />
            </li>
          ) : null}

          {showOpeningPrep ? (
            <OpeningPrepSheet
              key={openingFlowKey}
              activeTopic={activeTopic}
              activeTask={activeTask}
              aiDirections={aiDirections}
              status={status}
              errorMessage={errorMessage}
              readyPending={readyRequested}
              onReady={handleOpeningReady}
              onRetry={handleOpeningRetry}
              expressionPracticeContext={
                practiceMode === "expression_practice" ? expressionPracticeContext : null
              }
            />
          ) : null}

          {showGuideBanner ? <SessionGuideBanner activeTask={activeTask} /> : null}

          {messages.map((message) =>
            message.role === "user" ? (
              <li key={message.id} className="animate-fade-up flex justify-end">
                <div className="min-w-[5.5rem] max-w-[85%] rounded-[18px] rounded-br-sm border border-white/10 bg-surface-canvas-raised px-4 py-2.5 text-ink-on-canvas">
                  {message.isListeningDraft ? (
                    message.text.trim().length > 0 ? (
                      <p
                        className={`break-words text-[15px] leading-relaxed ${
                          message.isFinal ? "" : "opacity-80 italic"
                        }`}
                      >
                        {message.text}
                      </p>
                    ) : (
                      <UserListeningBubble />
                    )
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
              <li key={message.id} className="animate-fade-up flex items-end gap-2.5">
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

        {reportError ? (
          <div className="mt-4 rounded-2xl bg-error-bg px-5 py-3 text-sm text-error">{reportError}</div>
        ) : null}
      </div>

      {!showOpeningPrep ? (
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

          {isActive && !showOpeningPrep ? (
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
                  {practiceMode === "expression_practice" ? "结束并看小结" : "结束并复盘"}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            {showOpeningPrep ? (
              <div className="rounded-2xl border border-white/10 bg-bg-canvas px-4 py-3 text-center">
                <p className="text-[12.5px] leading-relaxed text-ink-on-canvas-soft">
                  {practiceMode === "expression_practice"
                    ? "看一眼目标表达，点「我准备好了」后再开口。"
                    : "先在上方选个方向，点「我准备好了」后再开口。"}
                </p>
              </div>
            ) : isActive ? (
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
                onClick={() => handleStart()}
                disabled={reportLoading}
                aria-label={hasHistory ? "继续对话" : "开始对话"}
                className="group relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-ink-on-canvas text-bg-canvas shadow-elevated transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:scale-[1.04] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute inset-0 rounded-full bg-white/10 opacity-0 transition group-hover:opacity-100" />
                <MicIcon className="relative h-8 w-8" />
              </button>
            )}

            <p className="text-center text-[12.5px] text-ink-on-canvas-faint">
              {showOpeningPrep
                ? status === "active"
                  ? "语音已准备好，但还不会收你的声音"
                  : "正在连接时也可以先想第一句"
                : isActive
                ? typingTestMode
                  ? "打字测试 · 底部输入发送"
                  : activeAsrProvider === "platform-native-asr"
                    ? "平台原生 ASR · 实时听写中"
                    : "麦克风开着 · 随时开口"
                : reportLoading && !report
                  ? "复盘生成中，稍等一下…"
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
                {practiceMode === "expression_practice" ? "结束本次复练并看小结" : "结束本次对话并生成复盘"}
              </Button>
            ) : null}

            {report ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onViewReport}
                className="!border-[rgba(244,243,240,0.18)] !bg-[rgba(244,243,240,0.1)] !text-ink-on-canvas backdrop-blur-[16px] hover:!bg-[rgba(244,243,240,0.16)]"
              >
                查看复盘报告
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
