import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { UserPreferencesProvider } from "./hooks/useUserPreferences";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <UserPreferencesProvider>
        <App />
      </UserPreferencesProvider>
    </AuthProvider>
  </StrictMode>,
);
