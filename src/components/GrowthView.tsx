import { useCallback, useEffect, useState } from "react";
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

export interface GrowthPanelProps {
  isGuest: boolean;
  onGoToAccount?: () => void;
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
    return null;
  }

  return (
    <div>
      <div className="section-title">小榜记得的关于你</div>
      <Card variant="default" className="space-y-4 p-5">
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
      </Card>
    </div>
  );
}

export function GrowthPanel({ isGuest, onGoToAccount }: GrowthPanelProps) {
  const { userId } = useAuth();
  const initialCache = !isGuest && userId ? readGrowthCache(userId) : null;

  const [stats, setStats] = useState<GrowthStats | null>(initialCache?.stats ?? null);
  const [history, setHistory] = useState<ReportHistoryItem[]>(initialCache?.history ?? []);
  const [trackedExpressions, setTrackedExpressions] = useState<TrackedExpression[]>(
    initialCache?.trackedExpressions ?? [],
  );
  const [memory, setMemory] = useState<UserMemory | null>(initialCache?.memory ?? null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState<Record<string, ReportJSON>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isGuest && !initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingMemoryKey, setDeletingMemoryKey] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest || !userId) {
      setStats(null);
      setHistory([]);
      setTrackedExpressions([]);
      setMemory(null);
      setReportDetails({});
      setExpandedSessionId(null);
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
    [history, memory, stats, trackedExpressions, userId],
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
    return (
      <Card variant="default" className="mx-auto w-full max-w-[44rem] p-6 text-sm leading-relaxed text-text-muted">
        登录后，这里会记录你的练习次数、总时长、连续练习、历史复盘和常见表达问题。
        {onGoToAccount ? (
          <Button className="mt-4" fullWidth onClick={onGoToAccount}>
            登录 / 注册
          </Button>
        ) : null}
      </Card>
    );
  }

  if (loading && !stats) {
    return <GrowthSkeleton />;
  }

  if (error && !stats) {
    return <p className="mx-auto w-full max-w-[44rem] text-sm text-error">{error}</p>;
  }

  if (!stats || stats.sessionCount === 0) {
    return (
      <Card variant="ghost" className="mx-auto w-full max-w-[44rem] border-dashed p-6 text-sm leading-relaxed text-text-muted">
        还没有完成的练习。去「练习」聊一次并生成复盘后，这里会开始累积你的语言档案。
      </Card>
    );
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

      <div className="space-y-7">
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

          <div className="mt-7">
            <div className="section-title">掌握度</div>
            <ExpressionMasteryTabs trackedExpressions={trackedExpressions} />
          </div>
        </div>

        <RememberedAboutYou
          memory={memory}
          deletingKey={deletingMemoryKey}
          onDeleteFact={handleDeleteFact}
          onDeleteEntry={handleDeleteEntry}
        />

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
    </div>
  );
}

/** @deprecated Use GrowthPanel — kept as alias for any external imports */
export const GrowthView = GrowthPanel;
