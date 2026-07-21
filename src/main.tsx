import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { UserPreferencesProvider } from "./hooks/useUserPreferences";
import "./index.css";

const isAdminRoute = window.location.pathname.startsWith("/admin");
const AdminApp = lazy(() =>
  import("./admin/AdminApp").then((module) => ({ default: module.AdminApp })),
);

function AdminFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6 text-sm text-text-muted">
      正在加载后台…
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isAdminRoute ? (
      <Suspense fallback={<AdminFallback />}>
        <AdminApp />
      </Suspense>
    ) : (
      <AuthProvider>
        <UserPreferencesProvider>
          <App />
        </UserPreferencesProvider>
      </AuthProvider>
    )}
  </StrictMode>,
);
