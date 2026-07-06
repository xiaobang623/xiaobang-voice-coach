import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { DashboardSummaryCards } from "./DashboardSummary";
import { UserListTable } from "./UserListTable";
import { SessionListTable } from "./SessionListTable";
import { TokenSummarySection } from "./TokenSummarySection";
import { fetchAdminMe, fetchDashboardSummary, logoutAdmin } from "./api";
import type { AdminUser, DashboardSummary } from "./types";

interface AdminDashboardPageProps {
  onLogout: () => void;
}

export function AdminDashboardPage({ onLogout }: AdminDashboardPageProps) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [filterUserId, setFilterUserId] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const me = await fetchAdminMe();
        if (!cancelled) {
          setUser(me);
        }
      } catch {
        if (!cancelled) {
          onLogout();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onLogout]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);

    void (async () => {
      try {
        const data = await fetchDashboardSummary();
        if (!cancelled) {
          setSummary(data);
        }
      } catch {
        if (!cancelled) {
          setSummary(null);
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    void (async () => {
      try {
        await logoutAdmin();
      } finally {
        onLogout();
      }
    })();
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text-muted">
        验证登录状态…
      </div>
    );
  }

  return (
    <AdminLayout user={user} onLogout={handleLogout}>
      <DashboardSummaryCards data={summary} loading={summaryLoading} />
      <UserListTable onSelectUser={setFilterUserId} />
      <SessionListTable filterUserId={filterUserId} onFilterUserIdChange={setFilterUserId} />
      <TokenSummarySection />
    </AdminLayout>
  );
}
