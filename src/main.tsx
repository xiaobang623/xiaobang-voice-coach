import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AdminApp } from "./admin/AdminApp";
import { AuthProvider } from "./hooks/useAuth";
import { UserPreferencesProvider } from "./hooks/useUserPreferences";
import "./index.css";

const isAdminRoute = window.location.pathname.startsWith("/admin");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isAdminRoute ? (
      <AdminApp />
    ) : (
      <AuthProvider>
        <UserPreferencesProvider>
          <App />
        </UserPreferencesProvider>
      </AuthProvider>
    )}
  </StrictMode>,
);
