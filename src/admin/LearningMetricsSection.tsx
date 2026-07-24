import { useEffect, useState } from "react";
import { defaultDateFrom, fetchLearningMetrics, todayIsoDate } from "./api";
import type { LearningMetricsData, RetentionRow } from "./types";

function formatMinutes(value: number) {
  return `${Math.max(0, value).toFixed(1)} 分钟`;
}
function formatPercent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
function formatWow(value: number | null) {
  if (value === null) return "上周无基线";
  if (value === 0) return "较上周持平";
  return `${value > 0 ? "↑" : "↓"} ${Math.abs(value * 100).toFixed(1)}% WoW`;
}
function wowClass(value: number | null) {
  if (value === null || value === 0) return "text-text-muted";
  return value > 0 ? "text-emerald-700" : "text-red-700";
}
function NorthStarCard({ label, value, previous, wow }: { label: string; value: string; previous: string; wow: number | null }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-card)]">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
      <p className="mt-1 text-xs text-text-secondary">上周 {previous}</p>
      <p className={`mt-2 text-xs font-semibold ${wowClass(wow)}`}>{formatWow(wow)}</p>
    </div>
  );
}
function RetentionTable({ rows }: { rows: RetentionRow[] }) {
  const labelByMetric: Record<RetentionRow["metric_name"], string> = { next_day: "次日回访率", seven_day: "7 日内回访率" };
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="mb-3"><h2 className="text-base font-medium">留存</h2><p className="mt-1 text-xs text-text-muted">基于 app_open 的近 30 天可观察 cohort</p></div>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="text-text-muted"><tr className="border-b border-border-subtle"><th className="px-2 py-2">指标</th><th className="px-2 py-2">Cohort</th><th className="px-2 py-2">回访人数</th><th className="px-2 py-2">回访率</th></tr></thead><tbody>{rows.map((row) => (<tr key={row.metric_name} className="border-b border-border-subtle/70 last:border-b-0"><td className="px-2 py-2 font-medium text-text">{labelByMetric[row.metric_name]}</td><td className="px-2 py-2 tabular-nums">{row.cohort_actors}</td><td className="px-2 py-2 tabular-nums text-text-secondary">{row.returned_actors}</td><td className="px-2 py-2 tabular-nums font-semibold text-text">{formatPercent(row.retention_rate)}</td></tr>))}</tbody></table></div>
    </div>
  );
}
export function LearningMetricsSection() {
  const [data, setData] = useState<LearningMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(null);
    void (async () => { try { const result = await fetchLearningMetrics({ dateFrom: defaultDateFrom(30), dateTo: todayIsoDate() }); if (!cancelled) setData(result); } catch (err) { if (!cancelled) { setData(null); setError(err instanceof Error ? err.message : "加载失败"); } } finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, []);
  if (loading) return <section className="grid gap-4 lg:grid-cols-3">{[1, 2, 3].map((key) => <div key={key} className="h-32 animate-pulse rounded-2xl bg-bg-warm" />)}</section>;
  if (error) return <section className="rounded-2xl border border-error/30 bg-error/5 p-5"><h2 className="text-base font-medium text-text">北极星与留存</h2><p className="mt-2 text-sm text-error">加载失败：{error}</p></section>;
  if (!data) return null;
  const { current, previous, wow } = data.north_star;
  return <section className="space-y-4"><div><h2 className="mb-4 text-base font-medium text-text">北极星 · 本周真实开口</h2><div className="grid gap-4 md:grid-cols-2"><NorthStarCard label="真实开口用户数" value={`${current.speaking_actor_count} 人`} previous={`${previous.speaking_actor_count} 人`} wow={wow.speaking_actor_count} /><NorthStarCard label="人均开口分钟数" value={formatMinutes(current.avg_speaking_minutes)} previous={formatMinutes(previous.avg_speaking_minutes)} wow={wow.avg_speaking_minutes} /></div></div><RetentionTable rows={data.retention} /></section>;
}
