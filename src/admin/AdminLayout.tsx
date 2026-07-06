import type { ReactNode } from "react";
import type { AdminUser } from "./types";

interface AdminLayoutProps {
  user: AdminUser;
  onLogout: () => void;
  children: ReactNode;
}

export function AdminLayout({ user, onLogout, children }: AdminLayoutProps) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border-subtle bg-surface/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-lg font-semibold">小榜 · 管理后台</h1>
            <p className="text-xs text-text-muted">Voice Coach Admin</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-bg-warm px-3 py-1 text-xs text-text-secondary">
              {user.username} · {user.role}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-full border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm hover:text-text"
            >
              登出
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">{children}</main>
    </div>
  );
}
