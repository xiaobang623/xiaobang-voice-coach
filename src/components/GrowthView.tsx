import { useCallback, useEffect, useState } from "react";
import { ReportView } from "./ReportView";
import { Card } from "./ui/Card";
import type {
  GrowthStats,
  ReportHistoryItem,
  ReportJSON,
  UserLevel,
} from "../types";
import {
  GROWTH_CACHE_STALE_MS,
  growthCacheAgeMs,
  readGrowthCache,
  writeGrowthCache,
} from "../core/growthCache";
import { loadGrowthPageData, loadReportDetail } from "../core/storage";
import { useAuth } from "../hooks/useAuth";
import { scenarioLabel } from "../config/topics";

export interface GrowthPanelProps {
  isGuest: boolean;
  onGoToAccount?: () => void;
}

const USER_LEVEL_LABEL: Record<UserLevel, string> = {
  beginner: "初级",
  intermediate: "中级",
  advanced: "高级",
};

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
    <Card variant="default" className="p-4 md:p-5">
      <div className="text-[20px] font-bold tracking-tight text-text md:text-[24px]">{value}</div>
      <div className="mt-1 text-[11px] text-text-muted">{label}</div>
    </Card>
  );
}

function GrowthSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-4 w-40 rounded-full bg-bg-warm" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-24 rounded-[var(--radius-card)] bg-surface" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
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
          <div className="mt-1 text-xs text-text-muted">{formatDate(item.createdAt)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">{formatDuration(item.durationSeconds)}</div>
          <div className="mt-1 text-[13px] font-semibold text-spark">
            {USER_LEVEL_LABEL[item.userLevel]}
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

export function GrowthPanel({ isGuest, onGoToAccount }: GrowthPanelProps) {
  const { userId } = useAuth();
  const initialCache = !isGuest && userId ? readGrowthCache(userId) : null;

  const [stats, setStats] = useState<GrowthStats | null>(initialCache?.stats ?? null);
  const [history, setHistory] = useState<ReportHistoryItem[]>(initialCache?.history ?? []);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState<Record<string, ReportJSON>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isGuest && !initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest || !userId) {
      setStats(null);
      setHistory([]);
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

  if (isGuest) {
    return (
      <Card variant="default" className="p-6 text-sm leading-relaxed text-text-muted">
        登录后，这里会记录你的练习次数、总时长、连续练习、历史复盘和常见表达问题。
        {onGoToAccount ? (
          <button
            type="button"
            onClick={onGoToAccount}
            className="mt-4 inline-flex w-full items-center justify-center rounded-[16px] bg-accent px-6 py-3.5 text-sm font-medium text-surface shadow-card transition hover:bg-accent-hover"
          >
            登录 / 注册
          </button>
        ) : null}
      </Card>
    );
  }

  if (loading && !stats) {
    return <GrowthSkeleton />;
  }

  if (error && !stats) {
    return <p className="text-sm text-error">{error}</p>;
  }

  if (!stats || stats.sessionCount === 0) {
    return (
      <Card variant="ghost" className="border-dashed p-6 text-sm leading-relaxed text-text-muted">
        还没有完成的练习。去「练习」聊一次并生成复盘后，这里会开始累积你的语言档案。
      </Card>
    );
  }

  const latestLevel = stats.latestUserLevel ? USER_LEVEL_LABEL[stats.latestUserLevel] : "B2";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-text-muted">语言能力档案</p>
          <div className="mt-3 text-[clamp(44px,5vw,64px)] font-bold leading-none tracking-tight text-text">
            {latestLevel}
          </div>
          <p className="mt-1 text-[13px] text-text-secondary">中高级 · 口语流利度良好</p>
        </div>
        <div className="text-[12.5px] font-semibold text-spark">
          {refreshing ? "正在更新" : "↑ 较上月提升"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="练习次数" value={`${stats.sessionCount}`} />
            <StatTile label="总时长" value={formatDuration(stats.totalDurationSeconds)} />
            <StatTile label="连续天数" value={`${stats.currentStreakDays}`} />
          </div>

          <div className="mt-7">
            <div className="section-title">常见问题模式</div>
            <Card variant="default" className="p-0">
              <div className="divide-y divide-border-subtle">
                {stats.frequentMistakes.length > 0 ? (
                  stats.frequentMistakes.slice(0, 3).map((mistake) => (
                    <div
                      key={`${mistake.type}-${mistake.original}-${mistake.corrected}`}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      <div className="w-28 shrink-0 text-[13.5px] font-semibold tracking-tight text-text">
                        {mistake.type === "grammar"
                          ? "时态一致性"
                          : mistake.type === "collocation"
                            ? "介词使用"
                            : mistake.type === "vocabulary"
                              ? "词汇选择"
                              : mistake.type === "naturalness"
                                ? "连接词单一"
                                : "句式结构"}
                      </div>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full bg-[#9aa0a6]"
                          style={{ width: `${Math.min(100, Math.max(18, mistake.count * 12))}%` }}
                        />
                      </div>
                      <div className="w-12 shrink-0 text-right text-[12px] text-text-muted">
                        {mistake.count} 次
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-5 py-4 text-sm text-text-muted">暂无常见问题</div>
                )}
              </div>
            </Card>
          </div>
        </div>

        <div>
          <div className="section-title">最近点评</div>
          <Card variant="default" className="p-0">
            <div className="divide-y divide-border-subtle">
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
