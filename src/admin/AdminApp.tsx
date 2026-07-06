import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminLoginPage } from "./AdminLoginPage";
import { AdminDashboardPage } from "./AdminDashboardPage";
import { fetchAdminMe } from "./api";

function getAdminPath() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") {
    return "/admin/dashboard";
  }
  return path;
}

export function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const path = useMemo(() => getAdminPath(), []);

  const goLogin = useCallback(() => {
    if (window.location.pathname !== "/admin/login") {
      window.history.replaceState(null, "", "/admin/login");
    }
    setAuthed(false);
  }, []);

  const goDashboard = useCallback(() => {
    if (window.location.pathname !== "/admin/dashboard") {
      window.history.replaceState(null, "", "/admin/dashboard");
    }
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (path === "/admin/login") {
      setAuthed(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await fetchAdminMe();
        if (!cancelled) {
          setAuthed(true);
          if (path !== "/admin/dashboard") {
            window.history.replaceState(null, "", "/admin/dashboard");
          }
        }
      } catch {
        if (!cancelled) {
          setAuthed(false);
          window.history.replaceState(null, "", "/admin/login");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text-muted">
        加载中…
      </div>
    );
  }

  if (!authed) {
    return <AdminLoginPage onSuccess={goDashboard} />;
  }

  return <AdminDashboardPage onLogout={goLogin} />;
}
