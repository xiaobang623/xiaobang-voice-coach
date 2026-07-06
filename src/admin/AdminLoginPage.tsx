import { useState, type FormEvent } from "react";
import { loginAdmin } from "./api";

interface AdminLoginPageProps {
  onSuccess: () => void;
}

export function AdminLoginPage({ onSuccess }: AdminLoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await loginAdmin(username.trim(), password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5">
      <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface p-8 shadow-[var(--shadow-elevated)]">
        <h1 className="text-center text-xl font-semibold">小榜 · 管理后台</h1>
        <p className="mt-1 text-center text-sm text-text-muted">登录后查看数据仪表板</p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm text-text-secondary">用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="text-sm text-text-secondary">密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
              autoComplete="current-password"
            />
          </label>

          {error ? <p className="text-sm text-error">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {loading ? "登录中…" : "登录"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-muted">首次使用需先调用 /api/admin/auth/setup 创建管理员</p>
      </div>
    </div>
  );
}
