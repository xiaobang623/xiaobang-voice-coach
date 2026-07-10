import { useEffect, useState } from "react";
import type { CostProviderRow, TokenModelRow, TokenUserRow } from "./types";
import {
  defaultDateFrom,
  fetchTokenSummary,
  formatCostProviderBreakdown,
  formatCurrency,
  formatDurationSeconds,
  formatProviderLabel,
  formatTokens,
  formatUsageMetric,
  getProviderBadgeClass,
  todayIsoDate,
} from "./api";

function ProviderSummaryCard({ row }: { row: CostProviderRow }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-bg/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getProviderBadgeClass(row.api_provider)}`}
        >
          {row.label}
        </span>
        <span className="text-lg font-semibold text-text">{formatCurrency(row.total_cost)}</span>
      </div>
      <p className="mt-2 text-xs text-text-muted">{row.rate_hint}</p>
      <p className="mt-2 text-sm text-text-secondary">
        {row.call_count} 次 · {formatUsageMetric(row)}
      </p>
    </div>
  );
}

export function TokenSummarySection() {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom(30));
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [totalCost, setTotalCost] = useState(0);
  const [byProvider, setByProvider] = useState<CostProviderRow[]>([]);
  const [byModel, setByModel] = useState<TokenModelRow[]>([]);
  const [byUser, setByUser] = useState<TokenUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await fetchTokenSummary({ dateFrom, dateTo });
        if (!cancelled) {
          setTotalCost(result.total_cost);
          setByProvider(result.by_provider ?? []);
          setByModel(result.by_model ?? []);
          setByUser(result.by_user ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">成本明细</h2>
          <p className="mt-1 text-xs text-text-muted">
            按来源区分豆包实时语音、硅谷云 ASR/TTS、DeepSeek 文本消耗
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {loading ? <p className="text-sm text-text-muted">加载中…</p> : null}

      {!loading ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border-subtle bg-bg/40 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-text-muted">筛选区间总成本</p>
                <p className="mt-1 text-2xl font-semibold text-text">{formatCurrency(totalCost)}</p>
              </div>
              <p className="text-sm text-text-secondary">{formatCostProviderBreakdown(byProvider)}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {byProvider.map((row) => (
              <ProviderSummaryCard key={row.api_provider} row={row} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-secondary">按模型 / 服务</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-text-muted">
                    <tr className="border-b border-border-subtle">
                      <th className="px-2 py-2">来源</th>
                      <th className="px-2 py-2">服务</th>
                      <th className="px-2 py-2">次数</th>
                      <th className="px-2 py-2">用量</th>
                      <th className="px-2 py-2">成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byModel.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-2 py-4 text-text-muted">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      byModel.map((row) => (
                        <tr
                          key={`${row.api_provider}-${row.model_name}`}
                          className="border-b border-border-subtle/70"
                        >
                          <td className="px-2 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${getProviderBadgeClass(row.api_provider)}`}
                            >
                              {row.provider_label ?? formatProviderLabel(row.api_provider)}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <div>{row.model_label ?? row.model_name}</div>
                            {row.rate_hint ? (
                              <div className="text-xs text-text-muted">{row.rate_hint}</div>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">{row.call_count}</td>
                          <td className="px-2 py-2">{formatUsageMetric(row)}</td>
                          <td className="px-2 py-2">{formatCurrency(row.total_cost)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-text-secondary">按用户 Top 20</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-text-muted">
                    <tr className="border-b border-border-subtle">
                      <th className="px-2 py-2">用户</th>
                      <th className="px-2 py-2">次数</th>
                      <th className="px-2 py-2">用量</th>
                      <th className="px-2 py-2">成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byUser.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-2 py-4 text-text-muted">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      byUser.map((row) => (
                        <tr key={row.user_id} className="border-b border-border-subtle/70">
                          <td className="px-2 py-2">{row.user_nickname}</td>
                          <td className="px-2 py-2">{row.call_count}</td>
                          <td className="px-2 py-2">
                            {[
                              row.total_duration_seconds
                                ? formatDurationSeconds(row.total_duration_seconds)
                                : null,
                              row.total_tokens ? formatTokens(row.total_tokens) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className="px-2 py-2">{formatCurrency(row.total_cost)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
