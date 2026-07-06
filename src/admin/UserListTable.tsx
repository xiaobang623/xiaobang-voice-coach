import { useEffect, useState } from "react";
import type { AdminUserRow, Pagination } from "./types";
import { fetchAdminUsers, formatCurrency, formatDateTime } from "./api";

interface UserListTableProps {
  onSelectUser: (userId: string) => void;
}

export function UserListTable({ onSelectUser }: UserListTableProps) {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0 });
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await fetchAdminUsers({
          page: pagination.page,
          search,
          sortBy,
          sortOrder,
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
  }, [pagination.page, search, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">用户列表</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(event) => {
              setPagination((prev) => ({ ...prev, page: 1 }));
              setSearch(event.target.value);
            }}
            placeholder="搜索昵称"
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm"
          >
            <option value="created_at">注册时间</option>
            <option value="session_count">对话次数</option>
            <option value="total_cost">总成本</option>
          </select>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as "asc" | "desc")}
            className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm"
          >
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-text-muted">
            <tr className="border-b border-border-subtle">
              <th className="px-2 py-2 font-medium">昵称</th>
              <th className="px-2 py-2 font-medium">注册时间</th>
              <th className="px-2 py-2 font-medium">对话次数</th>
              <th className="px-2 py-2 font-medium">总成本</th>
              <th className="px-2 py-2 font-medium">最近对话</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-text-muted">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-text-muted">
                  暂无用户
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border-subtle/70">
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onSelectUser(row.id)}
                      className="text-accent hover:underline"
                    >
                      {row.nickname}
                    </button>
                  </td>
                  <td className="px-2 py-2">{formatDateTime(row.created_at)}</td>
                  <td className="px-2 py-2">{row.session_count}</td>
                  <td className="px-2 py-2">{formatCurrency(row.total_cost)}</td>
                  <td className="px-2 py-2">{formatDateTime(row.last_session)}</td>
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
    </section>
  );
}
