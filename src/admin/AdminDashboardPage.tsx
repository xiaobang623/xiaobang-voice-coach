import { useEffect, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { DashboardSummaryCards } from "./DashboardSummary";
import { FunnelSection } from "./FunnelSection";
import { LearningMetricsSection } from "./LearningMetricsSection";
import { UserListTable } from "./UserListTable";
import { SessionListTable } from "./SessionListTable";
import { VoiceConfigSection } from "./VoiceConfigSection";
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
  const [summaryError, setSummaryError] = useState<string | null>(null);
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
    setSummaryError(null);

    void (async () => {
      try {
        const data = await fetchDashboardSummary();
        if (!cancelled) {
          setSummary(data);
        }
      } catch (err) {
        if (!cancelled) {
          setSummary(null);
          setSummaryError(err instanceof Error ? err.message : "加载失败");
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
      <DashboardSummaryCards data={summary} loading={summaryLoading} error={summaryError} />
      <LearningMetricsSection />
      <FunnelSection />
      <VoiceConfigSection user={user} />
      <UserListTable user={user} onSelectUser={setFilterUserId} />
      <SessionListTable user={user} filterUserId={filterUserId} onFilterUserIdChange={setFilterUserId} />
      <TokenSummarySection />
    </AdminLayout>
  );
}
