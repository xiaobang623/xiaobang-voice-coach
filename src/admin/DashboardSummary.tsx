import type { DashboardSummary } from "./types";
import { formatCostProviderBreakdown, formatCurrency } from "./api";

interface DashboardSummaryProps {
  data: DashboardSummary | null;
  loading: boolean;
  error?: string | null;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-card)]">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
      <p className="mt-1 text-xs text-text-secondary">{sub}</p>
    </div>
  );
}

export function DashboardSummaryCards({ data, loading, error }: DashboardSummaryProps) {
  if (loading) {
    return (
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((key) => (
          <div key={key} className="h-28 animate-pulse rounded-2xl bg-bg-warm" />
        ))}
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-error/30 bg-error/5 p-5">
        <h2 className="text-base font-medium text-text">今日数据</h2>
        <p className="mt-2 text-sm text-error">加载失败：{error}</p>
      </section>
    );
  }

  if (!data) {
    return null;
  }

  const costTodayBreakdown = formatCostProviderBreakdown(
    data.cost_today_by_provider ?? data.cost_by_provider,
  );

  return (
    <section>
      <h2 className="mb-4 text-base font-medium text-text">今日数据</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="注册用户"
          value={`${data.total_users} 人`}
          sub={`今日新用户 ${data.new_users_today} 人`}
        />
        <StatCard
          label="游客"
          value={`${data.total_guests ?? 0} 人`}
          sub="有 API 用量记录的游客"
        />
        <StatCard
          label="对话"
          value={`${data.total_sessions} 次`}
          sub={`今日对话 ${data.sessions_today} 次`}
        />
        <StatCard
          label="成本"
          value={formatCurrency(data.total_cost)}
          sub={`今日 ${formatCurrency(data.cost_today)} · ${costTodayBreakdown}`}
        />
      </div>
      <CostAlertStrip data={data} />
    </section>
  );
}

/** C3 成本护栏：今日单人成本超阈值告警条。无告警时展示静默状态一行。 */
function CostAlertStrip({ data }: { data: DashboardSummary }) {
  const alerts = data.cost_alerts ?? [];
  const threshold = data.cost_alert_threshold ?? 5;

  if (alerts.length === 0) {
    return (
      <p className="mt-3 text-xs text-text-muted">
        今日无额度告警（阈值 {formatCurrency(threshold)}/人/天）
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-error/30 bg-error/5 p-4">
      <p className="text-sm font-medium text-error">
        ⚠️ 今日额度告警 · {alerts.length} 人超过 {formatCurrency(threshold)}/天
      </p>
      <ul className="mt-2 space-y-1">
        {alerts.map((alert) => (
          <li
            key={`${alert.actor_type}:${alert.actor_id}`}
            className="flex items-center justify-between text-xs text-text-secondary"
          >
            <span className="truncate font-mono">
              {alert.actor_type === "guest" ? "游客" : "用户"} {alert.actor_id.slice(0, 12)}…
            </span>
            <span className="shrink-0 font-semibold text-error">{formatCurrency(alert.cost)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
