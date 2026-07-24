import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ReportView } from "./ReportView";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import type {
  GrowthStats,
  MemoryEntry,
  ReportHistoryItem,
  ReportJSON,
  TrackedExpression,
  UserMemory,
} from "../types";
import { getCefrLevel, getLevelInfo } from "../config/levels";
import {
  GROWTH_CACHE_STALE_MS,
  growthCacheAgeMs,
  readGrowthCache,
  writeGrowthCache,
} from "../core/growthCache";
import { loadGrowthPageData, loadReportDetail, upsertUserMemory } from "../core/storage";
import { useAuth } from "../hooks/useAuth";
import { scenarioLabel } from "../config/topics";
import { LevelSystemCard } from "./LevelSystem";
import { ExpressionMasteryTabs } from "./ExpressionMasteryTabs";
import { groupTrackedExpressionsByStatus } from "../core/trackedExpressionMastery";

export interface GrowthPanelProps {
  isGuest: boolean;
  onGoToAccount?: () => void;
}

interface GrowthDashboardProps extends GrowthPanelProps {
  onOpenRecord: () => void;
  onOpenExpressions: () => void;
  onOpenMemory: () => void;
  onOpenPreferences: () => void;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }
  if (minutes > 0) {
    return `${minutes} 分钟`;
  }
  return `${seconds} 秒`;
}

function formatSpeakingMinutes(seconds: number): string {
  if (seconds <= 0) {
    return "0 分钟";
  }
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function topicLabel(topic: string | null): string {
  return scenarioLabel(topic);
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="default" className="px-3 py-3.5">
      <div className="text-[20px] font-bold tracking-tight text-text">{value}</div>
      <div className="mt-[3px] text-[11px] text-text-muted">{label}</div>
    </Card>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[22px] font-bold tracking-tight text-text">{value}</div>
      <div className="mt-0.5 text-[12px] text-text-secondary">{label}</div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GrowthSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[44rem] animate-pulse space-y-8">
      <div className="h-4 w-40 rounded-full bg-bg-warm" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-24 rounded-[var(--radius-card)] bg-surface" />
        ))}
      </div>
      <div className="grid gap-4">
        <div className="h-48 rounded-[var(--radius-card)] bg-surface" />
        <div className="h-48 rounded-[var(--radius-card)] bg-surface" />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-32 rounded-[var(--radius-card)] bg-surface" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-[var(--radius-card)] bg-surface" />
        ))}
      </div>
      <div className="h-28 rounded-[var(--radius-card)] bg-surface" />
    </div>
  );
}

function ReviewRow({
  item,
  expanded,
  report,
  detailLoading,
  onToggle,
}: {
  item: ReportHistoryItem;
  expanded: boolean;
  report: ReportJSON | null;
  detailLoading: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div>
          <div className="text-sm font-semibold tracking-tight text-text">{topicLabel(item.topic)}</div>
          <div className="mt-[3px] text-xs text-text-muted">{formatDate(item.createdAt)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">{formatDuration(item.durationSeconds)}</div>
          <div className="mt-1 text-[13px] font-bold text-accent-gold">
            {getCefrLevel(item.userLevel)}
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-border-subtle">
          {detailLoading ? (
            <p className="px-5 py-6 text-sm text-text-muted">加载复盘详情…</p>
          ) : (
            <div className="px-2 pb-2">
              <ReportView report={report} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MemoryChip({
  children,
  onDelete,
  disabled,
}: {
  children: ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border-subtle bg-bg-warm/60 px-3 py-2.5">
      <div className="min-w-0 text-sm leading-relaxed text-text">{children}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={onDelete}
        className="shrink-0 rounded-full px-2 py-1 text-[12px] font-semibold text-text-muted transition-colors hover:bg-surface hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
      >
        删除
      </button>
    </div>
  );
}

function RememberedAboutYou({
  memory,
  deletingKey,
  onDeleteFact,
  onDeleteEntry,
}: {
  memory: UserMemory | null;
  deletingKey: string | null;
  onDeleteFact: (fact: string) => void;
  onDeleteEntry: (entry: MemoryEntry) => void;
}) {
  const facts = memory?.summary.personalFacts ?? [];
  const storyEntries = [...(memory?.entries ?? [])]
    .filter((entry) => entry.storyNotes.trim())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  if (facts.length === 0 && storyEntries.length === 0) {
    return (
      <Card variant="ghost" className="border-dashed p-5 text-sm leading-relaxed text-text-muted">
        小榜还没有形成稳定记忆。多聊几次后，这里会出现你的兴趣、近况和常用话题；你也可以随时删除。
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {facts.length > 0 ? (
        <div>
          <div className="mb-2 text-xs font-semibold text-text-muted">稳定信息</div>
          <div className="space-y-2">
            {facts.map((fact) => (
              <MemoryChip
                key={fact}
                disabled={deletingKey === `fact:${fact}`}
                onDelete={() => onDeleteFact(fact)}
              >
                {fact}
              </MemoryChip>
            ))}
          </div>
        </div>
      ) : null}

      {storyEntries.length > 0 ? (
        <div>
          <div className="mb-2 text-xs font-semibold text-text-muted">最近聊过的近况</div>
          <div className="space-y-2">
            {storyEntries.map((entry) => (
              <MemoryChip
                key={entry.sessionId}
                disabled={deletingKey === `entry:${entry.sessionId}`}
                onDelete={() => onDeleteEntry(entry)}
              >
                <div>{entry.storyNotes}</div>
                <div className="mt-1 text-[11px] text-text-muted">
                  {entry.topic} · {formatDate(entry.createdAt)}
                </div>
              </MemoryChip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useGrowthData(isGuest: boolean) {
  const { userId } = useAuth();
  const initialCache = !isGuest && userId ? readGrowthCache(userId) : null;

  const [stats, setStats] = useState<GrowthStats | null>(initialCache?.stats ?? null);
  const [history, setHistory] = useState<ReportHistoryItem[]>(initialCache?.history ?? []);
  const [trackedExpressions, setTrackedExpressions] = useState<TrackedExpression[]>(
    initialCache?.trackedExpressions ?? [],
  );
  const [memory, setMemory] = useState<UserMemory | null>(initialCache?.memory ?? null);
  const [loading, setLoading] = useState(!isGuest && !initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest || !userId) {
      setStats(null);
      setHistory([]);
      setTrackedExpressions([]);
      setMemory(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const cached = readGrowthCache(userId);
    if (cached) {
      setStats(cached.stats);
      setHistory(cached.history);
      setTrackedExpressions(cached.trackedExpressions);
      setMemory(cached.memory ?? null);
      setLoading(false);
    }

    const cacheAge = growthCacheAgeMs(userId);
    if (cached && cacheAge !== null && cacheAge < GROWTH_CACHE_STALE_MS) {
      return;
    }

    let cancelled = false;
    void (async () => {
      if (!cached) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const data = await loadGrowthPageData();
        if (!cancelled && data) {
          writeGrowthCache(userId, data);
          setStats(data.stats);
          setHistory(data.history);
          setTrackedExpressions(data.trackedExpressions);
          setMemory(data.memory ?? null);
        }
      } catch (loadError) {
        if (!cancelled && !cached) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isGuest, userId]);

  return {
    userId,
    stats,
    setStats,
    history,
    setHistory,
    trackedExpressions,
    setTrackedExpressions,
    memory,
    setMemory,
    loading,
    refreshing,
    error,
  };
}

function EmptyGrowthCard({ onGoToAccount }: { onGoToAccount?: () => void }) {
  return (
    <Card variant="ghost" className="border-dashed p-6 text-sm leading-relaxed text-text-muted">
      还没有完成的练习。去「练习」聊一次并生成复盘后，这里会开始累积你的语言档案。
      {onGoToAccount ? (
        <Button className="mt-4" fullWidth onClick={onGoToAccount}>
          登录 / 注册
        </Button>
      ) : null}
    </Card>
  );
}

function GuestGrowthCard({ onGoToAccount }: { onGoToAccount?: () => void }) {
  return (
    <Card variant="default" className="p-6 text-sm leading-relaxed text-text-muted">
      登录后，这里会记录你的练习次数、总时长、连续练习、历史复盘和常见表达问题。
      {onGoToAccount ? (
        <Button className="mt-4" fullWidth onClick={onGoToAccount}>
          登录 / 注册
        </Button>
      ) : null}
    </Card>
  );
}

function getMasteryCounts(trackedExpressions: TrackedExpression[]) {
  const groups = groupTrackedExpressionsByStatus(trackedExpressions);
  return {
    groups,
    unmastered: groups.unmastered.length,
    reviewing: groups.reviewing.length,
    mastered: groups.mastered.length,
  };
}

function DashboardAction({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 rounded-[14px] px-4 py-3 text-left transition-colors hover:bg-bg-warm/70 active:scale-[0.99]"
    >
      <div className="min-w-0">
        <div className="text-[14px] font-semibold tracking-tight text-text">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-text-muted">{description}</div>
      </div>
      <span className="shrink-0 text-text-muted">
        <ChevronIcon />
      </span>
    </button>
  );
}

export function GrowthDashboard({
  isGuest,
  onGoToAccount,
  onOpenRecord,
  onOpenExpressions,
  onOpenMemory,
  onOpenPreferences,
}: GrowthDashboardProps) {
  const { stats, history, trackedExpressions, memory, loading, refreshing, error } = useGrowthData(isGuest);
  const mastery = useMemo(() => getMasteryCounts(trackedExpressions), [trackedExpressions]);
  const latestHistory = history[0] ?? null;
  const topReviewTargets = mastery.groups.unmastered.slice(0, 3);

  if (isGuest) {
    return <GuestGrowthCard onGoToAccount={onGoToAccount} />;
  }

  if (loading && !stats) {
    return <DashboardSkeleton />;
  }

  if (error && !stats) {
    return <p className="text-sm text-error">{error}</p>;
  }

  if (!stats || stats.sessionCount === 0) {
    return <EmptyGrowthCard />;
  }

  const latestLevel = getCefrLevel(stats.latestUserLevel);
  const latestLevelInfo = getLevelInfo(latestLevel);
  const memoryCount = (memory?.summary.personalFacts.length ?? 0) +
    (memory?.entries.filter((entry) => entry.storyNotes.trim()).length ?? 0);

  return (
    <div className="space-y-5">
      <Card variant="default" className="overflow-hidden p-0">
        <div className="bg-ink px-5 py-5 text-ink-on-canvas">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="eyebrow !text-ink-on-canvas/45">今日继续练</div>
              <h3 className="mt-2 text-[22px] font-semibold tracking-tight">
                {topReviewTargets.length > 0 ? "复练几个还没稳的表达" : "保持今天的开口节奏"}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-on-canvas/62">
                {topReviewTargets.length > 0
                  ? `还有 ${mastery.unmastered} 个表达等你用出来，先挑 3 个最常见的。`
                  : "当前没有紧急复练项，可以继续自由聊一次，把表达用进真实对话里。"}
              </p>
            </div>
            {refreshing ? <span className="shrink-0 text-[12px] font-semibold text-accent-teal-on-canvas">更新中</span> : null}
          </div>

          {topReviewTargets.length > 0 ? (
            <div className="mt-4 space-y-2">
              {topReviewTargets.map((expression) => (
                <div
                  key={expression.id}
                  className="rounded-[12px] bg-surface-canvas-chip px-3 py-2 text-[13px] font-semibold leading-snug text-ink-on-canvas"
                >
                  {expression.targetText}
                </div>
              ))}
            </div>
          ) : null}

          <Button className="mt-4" fullWidth onClick={onOpenExpressions} variant="secondary">
            {topReviewTargets.length > 0 ? "查看表达库" : "查看我的表达"}
          </Button>
        </div>
      </Card>

      <div>
        <div className="section-title">我的进度</div>
        <Card variant="default" className="p-5">
          <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="text-[clamp(38px,5vw,54px)] font-bold leading-none tracking-[-0.03em] text-text">
                {latestLevel}
              </div>
              <p className="mt-1 text-[13px] text-text-secondary">
                {latestLevelInfo.shortLabel} · {latestLevelInfo.ability}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenRecord}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-text"
            >
              完整记录 <ChevronIcon />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <CompactStat label="练习次数" value={`${stats.sessionCount}`} />
            <CompactStat label="总时长" value={formatDuration(stats.totalDurationSeconds)} />
            <CompactStat label="本周开口" value={formatSpeakingMinutes(stats.weekSpeakingSeconds ?? 0)} />
            <CompactStat label="连续天数" value={`${stats.currentStreakDays}`} />
          </div>
        </Card>
      </div>

      <div>
        <div className="section-title">本周收获</div>
        <Card variant="default" className="p-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[22px] font-bold tracking-tight text-text">{mastery.unmastered}</div>
              <div className="mt-0.5 text-[12px] text-text-muted">未掌握</div>
            </div>
            <div>
              <div className="text-[22px] font-bold tracking-tight text-text">{mastery.reviewing}</div>
              <div className="mt-0.5 text-[12px] text-text-muted">复习中</div>
            </div>
            <div>
              <div className="text-[22px] font-bold tracking-tight text-spark">{mastery.mastered}</div>
              <div className="mt-0.5 text-[12px] text-text-muted">已掌握</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenExpressions}
            className="mt-4 flex w-full items-center justify-center gap-1 rounded-[12px] bg-bg-warm px-4 py-3 text-[13px] font-semibold text-text transition active:scale-[0.99]"
          >
            查看全部表达 <ChevronIcon />
          </button>
        </Card>
      </div>

      <div>
        <div className="section-title">最近一次复盘</div>
        {latestHistory ? (
          <Card variant="default" className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold tracking-tight text-text">{topicLabel(latestHistory.topic)}</div>
                <div className="mt-1 text-[12.5px] text-text-muted">
                  {formatDate(latestHistory.createdAt)} · {formatDuration(latestHistory.durationSeconds)}
                </div>
              </div>
              <div className="shrink-0 rounded-full bg-bg-warm px-3 py-1 text-[12px] font-bold text-spark">
                {getCefrLevel(latestHistory.userLevel)}
              </div>
            </div>
            <p className="mt-3 border-t border-border pt-3 text-[13px] leading-relaxed text-text-secondary">
              这次复盘有 {latestHistory.correctionCount} 个可优化表达。完整报告已收进练习记录，需要时再展开看。
            </p>
            <button
              type="button"
              onClick={onOpenRecord}
              className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-text"
            >
              查看完整复盘 <ChevronIcon />
            </button>
          </Card>
        ) : (
          <Card variant="ghost" className="border-dashed p-5 text-sm text-text-muted">暂无最近复盘</Card>
        )}
      </div>

      <div>
        <div className="section-title">更多</div>
        <Card variant="default" className="p-1.5">
          <DashboardAction title="练习记录" description="查看历史对话复盘和等级变化" onClick={onOpenRecord} />
          <DashboardAction title="小榜记忆" description={`管理小榜记得的关于你 · ${memoryCount} 条`} onClick={onOpenMemory} />
          <DashboardAction title="练习偏好" description="音色 / 语速 / 字幕" onClick={onOpenPreferences} />
        </Card>
      </div>
    </div>
  );
}

export function GrowthPanel({ isGuest, onGoToAccount }: GrowthPanelProps) {
  const {
    stats,
    history,
    loading,
    refreshing,
    error,
  } = useGrowthData(isGuest);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState<Record<string, ReportJSON>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const handleToggleHistory = useCallback(
    async (sessionId: string) => {
      if (expandedSessionId === sessionId) {
        setExpandedSessionId(null);
        return;
      }

      setExpandedSessionId(sessionId);

      if (reportDetails[sessionId]) {
        return;
      }

      setDetailLoadingId(sessionId);
      try {
        const report = await loadReportDetail(sessionId);
        if (report) {
          setReportDetails((current) => ({ ...current, [sessionId]: report }));
        }
      } finally {
        setDetailLoadingId((current) => (current === sessionId ? null : current));
      }
    },
    [expandedSessionId, reportDetails],
  );

  if (isGuest) {
    return <GuestGrowthCard onGoToAccount={onGoToAccount} />;
  }

  if (loading && !stats) {
    return <GrowthSkeleton />;
  }

  if (error && !stats) {
    return <p className="mx-auto w-full max-w-[44rem] text-sm text-error">{error}</p>;
  }

  if (!stats || stats.sessionCount === 0) {
    return <EmptyGrowthCard />;
  }

  const latestLevel = getCefrLevel(stats.latestUserLevel);
  const latestLevelInfo = getLevelInfo(latestLevel);

  return (
    <div className="mx-auto w-full max-w-[44rem] space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">语言能力档案</p>
          <div className="mt-4 text-[clamp(44px,5vw,64px)] font-bold leading-none tracking-[-0.03em] text-text">
            {latestLevel}
          </div>
          <p className="mt-1 text-[13px] text-text-secondary">
            {latestLevelInfo.shortLabel} · {latestLevelInfo.ability}
          </p>
        </div>
        {refreshing ? (
          <div className="text-[12.5px] font-semibold text-accent-teal">正在更新</div>
        ) : null}
      </div>

      <div>
        <LevelSystemCard
          userLevel={stats.latestUserLevel}
          title="完整等级体系"
          note="基于最近练习估算"
        />

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-4">
          <StatTile label="练习次数" value={`${stats.sessionCount}`} />
          <StatTile label="总时长" value={formatDuration(stats.totalDurationSeconds)} />
          <StatTile label="本周开口" value={formatSpeakingMinutes(stats.weekSpeakingSeconds ?? 0)} />
          <StatTile label="连续天数" value={`${stats.currentStreakDays}`} />
        </div>
      </div>

      <div>
        <div className="section-title">最近点评</div>
        <Card variant="default" className="p-0">
          <div className="divide-y divide-border">
            {history.length > 0 ? (
              history.map((item) => (
                <ReviewRow
                  key={item.sessionId}
                  item={item}
                  expanded={expandedSessionId === item.sessionId}
                  report={reportDetails[item.sessionId] ?? null}
                  detailLoading={detailLoadingId === item.sessionId}
                  onToggle={() => void handleToggleHistory(item.sessionId)}
                />
              ))
            ) : (
              <div className="px-5 py-4 text-sm text-text-muted">暂无最近点评</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function ExpressionLibraryPanel({ isGuest, onGoToAccount }: GrowthPanelProps) {
  const { stats, trackedExpressions, loading, error } = useGrowthData(isGuest);
  const mastery = useMemo(() => getMasteryCounts(trackedExpressions), [trackedExpressions]);

  if (isGuest) {
    return <GuestGrowthCard onGoToAccount={onGoToAccount} />;
  }

  if (loading && !stats) {
    return <GrowthSkeleton />;
  }

  if (error && !stats) {
    return <p className="mx-auto w-full max-w-[44rem] text-sm text-error">{error}</p>;
  }

  if (!stats || stats.sessionCount === 0) {
    return <EmptyGrowthCard />;
  }

  return (
    <div className="mx-auto w-full max-w-[44rem] space-y-6">
      <Card variant="default" className="p-5">
        <div className="section-title !mb-3">表达掌握度</div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[24px] font-bold tracking-tight text-text">{mastery.unmastered}</div>
            <div className="mt-0.5 text-[12px] text-text-muted">未掌握</div>
          </div>
          <div>
            <div className="text-[24px] font-bold tracking-tight text-text">{mastery.reviewing}</div>
            <div className="mt-0.5 text-[12px] text-text-muted">复习中</div>
          </div>
          <div>
            <div className="text-[24px] font-bold tracking-tight text-spark">{mastery.mastered}</div>
            <div className="mt-0.5 text-[12px] text-text-muted">已掌握</div>
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-[13px] leading-relaxed text-text-secondary">
          这里只收你在复盘里反复出现、值得主动复用的表达。首页只展示摘要，完整列表放在这里慢慢看。
        </p>
      </Card>

      <div>
        <div className="section-title">全部表达</div>
        <ExpressionMasteryTabs trackedExpressions={trackedExpressions} />
      </div>
    </div>
  );
}

export function MemoryManagementPanel({ isGuest, onGoToAccount }: GrowthPanelProps) {
  const {
    userId,
    stats,
    history,
    trackedExpressions,
    memory,
    setMemory,
    loading,
    error,
  } = useGrowthData(isGuest);
  const [deletingMemoryKey, setDeletingMemoryKey] = useState<string | null>(null);

  const persistMemoryUpdate = useCallback(
    async (nextMemory: UserMemory, deletingKey: string) => {
      setDeletingMemoryKey(deletingKey);
      const previousMemory = memory;
      setMemory(nextMemory);
      try {
        await upsertUserMemory(nextMemory);
        if (userId) {
          writeGrowthCache(userId, {
            stats: stats ?? {
              sessionCount: 0,
              totalDurationSeconds: 0,
              weekSpeakingSeconds: 0,
              currentStreakDays: 0,
              longestStreakDays: 0,
              latestUserLevel: nextMemory.summary.userLevel,
              frequentMistakes: [],
            },
            history,
            trackedExpressions,
            memory: nextMemory,
          });
        }
      } catch (deleteError) {
        setMemory(previousMemory);
        console.warn(
          "[memory] failed to delete visible memory:",
          deleteError instanceof Error ? deleteError.message : deleteError,
        );
      } finally {
        setDeletingMemoryKey(null);
      }
    },
    [history, memory, setMemory, stats, trackedExpressions, userId],
  );

  const handleDeleteFact = useCallback(
    (fact: string) => {
      if (!memory || deletingMemoryKey) {
        return;
      }
      void persistMemoryUpdate(
        {
          ...memory,
          summary: {
            ...memory.summary,
            personalFacts: memory.summary.personalFacts.filter((item) => item !== fact),
            updatedAt: new Date().toISOString(),
          },
        },
        `fact:${fact}`,
      );
    },
    [deletingMemoryKey, memory, persistMemoryUpdate],
  );

  const handleDeleteEntry = useCallback(
    (entry: MemoryEntry) => {
      if (!memory || deletingMemoryKey) {
        return;
      }
      void persistMemoryUpdate(
        {
          ...memory,
          entries: memory.entries.filter((item) => item.sessionId !== entry.sessionId),
        },
        `entry:${entry.sessionId}`,
      );
    },
    [deletingMemoryKey, memory, persistMemoryUpdate],
  );

  if (isGuest) {
    return <GuestGrowthCard onGoToAccount={onGoToAccount} />;
  }

  if (loading && !stats) {
    return <GrowthSkeleton />;
  }

  if (error && !stats) {
    return <p className="mx-auto w-full max-w-[44rem] text-sm text-error">{error}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-[44rem] space-y-5">
      <Card variant="default" className="p-5">
        <div className="section-title !mb-2">小榜记忆</div>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          这些信息会用于下次对话的个性化开场和话题衔接。你可以删除任何不想让小榜继续记住的内容。
        </p>
      </Card>

      <RememberedAboutYou
        memory={memory}
        deletingKey={deletingMemoryKey}
        onDeleteFact={handleDeleteFact}
        onDeleteEntry={handleDeleteEntry}
      />
    </div>
  );
}

/** @deprecated Use GrowthPanel — kept as alias for any external imports */
export const GrowthView = GrowthPanel;
