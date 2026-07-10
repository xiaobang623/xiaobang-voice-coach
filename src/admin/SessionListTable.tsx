import { useEffect, useState } from "react";
import type { AdminSessionRow, AdminUser, Pagination } from "./types";
import {
  defaultDateFrom,
  fetchAdminSessions,
  formatDateTime,
  formatSessionCostBreakdown,
  formatVoiceBackendLabel,
  todayIsoDate,
} from "./api";
import { VoiceConfigModal } from "./VoiceConfigModal";

interface SessionListTableProps {
  user: AdminUser;
  filterUserId: string;
  onFilterUserIdChange: (userId: string) => void;
}

export function SessionListTable({ user, filterUserId, onFilterUserIdChange }: SessionListTableProps) {
  const [rows, setRows] = useState<AdminSessionRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0 });
  const [dateFrom, setDateFrom] = useState(defaultDateFrom(7));
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configTarget, setConfigTarget] = useState<AdminSessionRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await fetchAdminSessions({
          page: pagination.page,
          userId: filterUserId,
          dateFrom,
          dateTo,
        });
        if (!cancelled) {
          setRows(result.rows);
          setPagination(result.pagination);
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
  }, [pagination.page, filterUserId, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">对话列表</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setPagination((prev) => ({ ...prev, page: 1 }));
              setDateFrom(event.target.value);
            }}
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPagination((prev) => ({ ...prev, page: 1 }));
              setDateTo(event.target.value);
            }}
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm"
          />
          <input
            value={filterUserId}
            onChange={(event) => {
              setPagination((prev) => ({ ...prev, page: 1 }));
              onFilterUserIdChange(event.target.value);
            }}
            placeholder="用户 / 游客 ID 过滤"
            className="min-w-48 rounded-full border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-text-muted">
            <tr className="border-b border-border-subtle">
              <th className="px-2 py-2 font-medium">时间</th>
              <th className="px-2 py-2 font-medium">用户</th>
              <th className="px-2 py-2 font-medium">话题</th>
              <th className="px-2 py-2 font-medium">语音</th>
              <th className="px-2 py-2 font-medium">摘要</th>
              <th className="px-2 py-2 font-medium">成本</th>
              <th className="px-2 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-text-muted">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-text-muted">
                  暂无对话
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border-subtle/70">
                  <td className="px-2 py-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                  <td className="px-2 py-2">{row.user_nickname}</td>
                  <td className="px-2 py-2">{row.topic ?? "自由聊"}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-text-secondary">
                    {formatVoiceBackendLabel(row.voice_backend)}
                  </td>
                  <td className="max-w-xs truncate px-2 py-2 text-text-secondary">
                    {row.transcript_preview || (row.is_archived === false ? "（未存档，仅有用量）" : "—")}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap" title={formatSessionCostBreakdown(row.cost_by_provider, row.total_cost)}>
                    {formatSessionCostBreakdown(row.cost_by_provider, row.total_cost)}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => setConfigTarget(row)}
                      className="text-xs text-accent hover:underline"
                    >
                      会话配置
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-sm">
        <button
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
          className="rounded-full border border-border px-3 py-1 disabled:opacity-40"
        >
          上一页
        </button>
        <span className="text-text-muted">
          {pagination.page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={pagination.page >= totalPages}
          onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
          className="rounded-full border border-border px-3 py-1 disabled:opacity-40"
        >
          下一页
        </button>
      </div>

      {configTarget ? (
        <VoiceConfigModal
          user={user}
          scopeType="session"
          sessionId={configTarget.id}
          userId={configTarget.user_id ?? undefined}
          guestId={configTarget.guest_id ?? undefined}
          title={`会话语音配置 · ${formatDateTime(configTarget.created_at)}`}
          onClose={() => setConfigTarget(null)}
        />
      ) : null}
    </section>
  );
}
