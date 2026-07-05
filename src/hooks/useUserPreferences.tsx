import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_USER_PREFERENCES, normalizeUserPreferences } from "../config/preferences";
import { loadUserPreferencesState, saveUserPreferences } from "../core/storage";
import { useAuth } from "./useAuth";
import type { UserPreferences } from "../types";

const LOCAL_PREFS_KEY = "xiaobang.practice.prefs";

export interface UserPreferencesContextValue {
  preferences: UserPreferences;
  isReady: boolean;
  setVoiceType: (voiceType: string) => void;
  setSpeedRatio: (speedRatio: number) => void;
  setShowSubtitle: (showSubtitle: boolean) => void;
  updatePreferences: (patch: Partial<UserPreferences>) => void;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

function readLocalPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_USER_PREFERENCES };
    }
    return normalizeUserPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_USER_PREFERENCES };
  }
}

function writeLocalPreferences(preferences: UserPreferences): void {
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore quota / private-mode errors.
  }
}

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { isConfigured, isAnonymous, userId } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsReady(false);

      if (!isConfigured || isAnonymous) {
        const local = readLocalPreferences();
        if (!cancelled) {
          setPreferences(local);
          setIsReady(true);
        }
        return;
      }

      const remote = await loadUserPreferencesState();
      if (!cancelled) {
        if (remote?.isUnset) {
          const local = readLocalPreferences();
          setPreferences(local);
          void saveUserPreferences(local);
        } else {
          setPreferences(remote?.preferences ?? { ...DEFAULT_USER_PREFERENCES });
        }
        setIsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConfigured, isAnonymous, userId]);

  const persist = useCallback(
    (next: UserPreferences) => {
      if (!isConfigured || isAnonymous) {
        writeLocalPreferences(next);
        return;
      }
      void saveUserPreferences(next);
    },
    [isConfigured, isAnonymous],
  );

  const updatePreferences = useCallback(
    (patch: Partial<UserPreferences>) => {
      setPreferences((prev) => {
        const next = { ...prev, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setVoiceType = useCallback(
    (voiceType: string) => updatePreferences({ voiceType }),
    [updatePreferences],
  );

  const setSpeedRatio = useCallback(
    (speedRatio: number) => updatePreferences({ speedRatio }),
    [updatePreferences],
  );

  const setShowSubtitle = useCallback(
    (showSubtitle: boolean) => updatePreferences({ showSubtitle }),
    [updatePreferences],
  );

  const value: UserPreferencesContextValue = {
    preferences,
    isReady,
    setVoiceType,
    setSpeedRatio,
    setShowSubtitle,
    updatePreferences,
  };

  return (
    <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
  );
}

export function useUserPreferences(): UserPreferencesContextValue {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  }
  return context;
}
