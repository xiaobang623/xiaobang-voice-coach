import { useCallback, useEffect, useState } from "react";
import { ReportView } from "./ReportView";
import type {
  CorrectionType,
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

export interface GrowthPanelProps {
  isGuest: boolean;
  onGoToAccount?: () => void;
}

const USER_LEVEL_LABEL: Record<UserLevel, string> = {
  beginner: "初级",
  intermediate: "中级",
  advanced: "高级",
};

const TYPE_LABEL: Record<CorrectionType, string> = {
  grammar: "语法",
  collocation: "搭配",
  vocabulary: "用词",
  naturalness: "地道表达",
  structure: "句式",
};

const TOPIC_LABELS: Record<string, string> = {
  daily: "今天过得怎么样",
  travel: "想去的地方",
  food: "吃点什么好",
  work: "工作与生活",
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
  if (!topic) {
    return "自由畅聊";
  }
  return TOPIC_LABELS[topic] ?? topic;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-raised p-5 shadow-card">
      <p className="text-2xl font-medium text-text">{value}</p>
      <p className="mt-1 text-sm text-text-secondary">{label}</p>
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

function GrowthSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-4 w-40 rounded-full bg-bg-warm" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 rounded-[var(--radius-card)] bg-surface" />
        ))}
      </div>
      <div className="space-y-3">
        <div className="h-4 w-28 rounded-full bg-bg-warm" />
        <div className="h-20 rounded-[var(--radius-card)] bg-surface" />
        <div className="h-20 rounded-[var(--radius-card)] bg-surface" />
      </div>
    </div>
  );
}

function HistoryCard({
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
    <li className="relative pl-6 before:absolute before:top-0 before:bottom-0 before:left-[7px] before:w-px before:bg-border-subtle last:before:bottom-auto last:before:h-6">
      <span className="absolute top-5 left-0 h-3.5 w-3.5 rounded-full border-2 border-accent bg-surface" />
      <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-raised shadow-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div>
          <p className="text-sm font-medium text-text">{topicLabel(item.topic)}</p>
          <p className="mt-1 text-xs text-text-muted">{formatDate(item.createdAt)}</p>
        </div>
        <div className="text-right text-xs text-text-muted">
          <p>{formatDuration(item.durationSeconds)}</p>
          <p className="mt-1">
            {USER_LEVEL_LABEL[item.userLevel]} · {item.correctionCount} 条建议
          </p>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-border-subtle px-2 pb-2">
          {detailLoading ? (
            <p className="px-4 py-6 text-sm text-text-muted">加载复盘详情…</p>
          ) : (
            <ReportView report={report} />
          )}
        </div>
      ) : null}
      </div>
    </li>
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
      <div className="space-y-4">
        <p className="rounded-[var(--radius-card)] border border-border-subtle bg-surface p-6 text-sm leading-relaxed text-text-muted shadow-card">
          注册账号后，这里会记录对话次数、练习时长、连续打卡、历史复盘，以及经常犯的表达问题。
        </p>
        {onGoToAccount ? (
          <button
            type="button"
            onClick={onGoToAccount}
            className="w-full rounded-full bg-accent px-6 py-3.5 text-sm font-medium text-surface shadow-card transition hover:bg-accent-hover"
          >
            注册 / 登录
          </button>
        ) : null}
      </div>
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
      <p className="rounded-[var(--radius-card)] border border-dashed border-border-subtle bg-surface p-6 text-sm leading-relaxed text-text-muted">
        还没有完成的练习。去「练习」聊一次并生成复盘后，成长数据会出现在这里。
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {refreshing ? (
        <p className="text-xs text-text-muted">正在更新…</p>
      ) : (
        <p className="text-sm text-text-muted">
          {stats.latestUserLevel ? (
            <>
              当前水平约
              <span className="mx-1 font-medium text-text-secondary">
                {USER_LEVEL_LABEL[stats.latestUserLevel]}
              </span>
            </>
          ) : (
            "继续练习，小榜会帮你看见变化"
          )}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="完成对话" value={`${stats.sessionCount} 次`} />
        <StatCard label="累计练习" value={formatDuration(stats.totalDurationSeconds)} />
        <StatCard
          label="连续打卡"
          value={`${stats.currentStreakDays} 天`}
          hint={
            stats.longestStreakDays > stats.currentStreakDays
              ? `最长 ${stats.longestStreakDays} 天`
              : undefined
          }
        />
        <StatCard
          label="最常犯错"
          value={stats.frequentMistakes.length > 0 ? `${stats.frequentMistakes.length} 类` : "暂无"}
        />
      </div>

      {stats.frequentMistakes.length > 0 ? (
        <div>
          <h3 className="text-base font-medium text-text-secondary">经常出现的表达问题</h3>
          <p className="mt-0.5 text-xs text-text-muted">从历次复盘中汇总</p>
          <ul className="mt-4 space-y-3">
            {stats.frequentMistakes.map((mistake) => (
              <li
                key={`${mistake.type}-${mistake.original}-${mistake.corrected}`}
                className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-raised p-4 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                    {TYPE_LABEL[mistake.type]}
                  </span>
                  {mistake.count > 1 ? (
                    <span className="text-xs text-text-muted">出现 {mistake.count} 次</span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-text-muted line-through decoration-accent-muted/70">
                  {mistake.original}
                </p>
                <p className="mt-1 text-base font-medium text-text">{mistake.corrected}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div>
          <h3 className="text-base font-medium text-text-secondary">历史复盘</h3>
          <p className="mt-0.5 text-xs text-text-muted">点一条展开查看详情</p>
          <ul className="mt-4 space-y-1">
            {history.map((item) => (
              <HistoryCard
                key={item.sessionId}
                item={item}
                expanded={expandedSessionId === item.sessionId}
                report={reportDetails[item.sessionId] ?? null}
                detailLoading={detailLoadingId === item.sessionId}
                onToggle={() => void handleToggleHistory(item.sessionId)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Use GrowthPanel — kept as alias for any external imports */
export const GrowthView = GrowthPanel;
