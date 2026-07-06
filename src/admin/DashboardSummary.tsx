import type { DashboardSummary } from "./types";
import { formatCurrency } from "./api";

interface DashboardSummaryProps {
  data: DashboardSummary | null;
  loading: boolean;
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

export function DashboardSummaryCards({ data, loading }: DashboardSummaryProps) {
  if (loading) {
    return (
      <section className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((key) => (
          <div key={key} className="h-28 animate-pulse rounded-2xl bg-bg-warm" />
        ))}
      </section>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-4 text-base font-medium text-text">今日数据</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="用户"
          value={`${data.total_users} 人`}
          sub={`今日新用户 ${data.new_users_today} 人`}
        />
        <StatCard
          label="对话"
          value={`${data.total_sessions} 次`}
          sub={`今日对话 ${data.sessions_today} 次`}
        />
        <StatCard
          label="成本"
          value={formatCurrency(data.total_cost)}
          sub={`今日成本 ${formatCurrency(data.cost_today)}`}
        />
      </div>
    </section>
  );
}
