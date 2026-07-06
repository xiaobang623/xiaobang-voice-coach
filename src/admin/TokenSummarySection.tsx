import { useEffect, useState } from "react";
import type { TokenModelRow, TokenUserRow } from "./types";
import { defaultDateFrom, fetchTokenSummary, formatCurrency, formatDurationSeconds, formatTokens, formatUsageMetric, todayIsoDate } from "./api";

export function TokenSummarySection() {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom(30));
  const [dateTo, setDateTo] = useState(todayIsoDate());
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
          setByModel(result.by_model);
          setByUser(result.by_user);
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
        <h2 className="text-base font-medium">Token 消耗排行</h2>
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
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-text-secondary">按模型</h3>
            <table className="min-w-full text-left text-sm">
              <thead className="text-text-muted">
                <tr className="border-b border-border-subtle">
                  <th className="px-2 py-2">模型</th>
                  <th className="px-2 py-2">次数</th>
                  <th className="px-2 py-2">用量</th>
                  <th className="px-2 py-2">成本</th>
                </tr>
              </thead>
              <tbody>
                {byModel.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-text-muted">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  byModel.map((row) => (
                    <tr key={`${row.api_provider}-${row.model_name}`} className="border-b border-border-subtle/70">
                      <td className="px-2 py-2">{row.model_name}</td>
                      <td className="px-2 py-2">{row.call_count}</td>
                      <td className="px-2 py-2">{formatUsageMetric(row)}</td>
                      <td className="px-2 py-2">{formatCurrency(row.total_cost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-text-secondary">按用户 Top 20</h3>
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
      ) : null}
    </section>
  );
}
