import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { invalidateGrowthCache } from "../core/growthCache";
import { isSupabaseConfigured, supabase } from "../core/supabaseClient";

export interface AuthContextValue {
  /** Whether Supabase env vars are present. */
  isConfigured: boolean;
  /** True while restoring session or loading profile. */
  isLoading: boolean;
  /** Authenticated user id, or null when unconfigured / signed out. */
  userId: string | null;
  /** True while the user is on a throwaway anonymous session. */
  isAnonymous: boolean;
  /** Bound email once on a permanent account, else null. */
  email: string | null;
  /** Saved nickname from profiles (registered accounts only). */
  nickname: string | null;
  /** Persist nickname to profiles and update local state. */
  saveNickname: (nickname: string) => Promise<void>;
  /** Create a permanent account with email, password, and nickname. */
  registerAccount: (email: string, password: string, nickname: string) => Promise<void>;
  /** Sign in to an existing account (e.g. returning on a new device). */
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Sign out and fall back to a fresh anonymous session. */
  signOut: () => Promise<void>;
}

/**
 * Sentinel thrown by registerAccount when the email already has an account.
 * The UI matches on this to guide the user to the login tab.
 */
export const EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED";

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchNickname(userId: string): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[auth] failed to load profile:", error.message);
    return null;
  }

  const value = data?.nickname?.trim();
  return value || null;
}

async function ensureSession(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }

  const { data: existing, error: getError } = await supabase.auth.getSession();
  if (getError) {
    console.warn("[auth] getSession failed:", getError.message);
  }
  if (existing.session) {
    return existing.session;
  }

  const { data: signedIn, error: signInError } = await supabase.auth.signInAnonymously();
  if (signInError) {
    console.warn("[auth] anonymous sign-in failed:", signInError.message);
    return null;
  }

  return signedIn.session;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [isLoading, setIsLoading] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const syncProfile = async (nextUser: User | null) => {
      if (cancelled) {
        return;
      }

      setUser(nextUser);

      if (!nextUser || nextUser.is_anonymous) {
        setNickname(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const savedNickname = await fetchNickname(nextUser.id);
      if (!cancelled) {
        setNickname(savedNickname);
        setIsLoading(false);
      }
    };

    void (async () => {
      setIsLoading(true);
      const session = await ensureSession();
      if (!cancelled) {
        await syncProfile(session?.user ?? null);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncProfile(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const saveNickname = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error("昵称不能为空");
    }
    if (!supabase || !user) {
      throw new Error("Supabase 未配置或未登录");
    }

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, nickname: trimmed }, { onConflict: "id" });

    if (error) {
      throw new Error(error.message);
    }

    setNickname(trimmed);
  }, [user]);

  const registerAccount = useCallback(
    async (rawEmail: string, password: string, rawNickname: string) => {
      const email = rawEmail.trim();
      const trimmedNickname = rawNickname.trim();
      if (!email || !password || !trimmedNickname) {
        throw new Error("邮箱、密码和昵称都不能为空");
      }
      if (password.length < 6) {
        throw new Error("密码至少 6 位");
      }
      if (!supabase) {
        throw new Error("Supabase 未配置");
      }

      // If a failed signUp leaves us without a session, restore a guest one.
      // getSession() reads local storage (no network), so this stays fast.
      const restoreGuestIfNeeded = async () => {
        const { data: current } = await supabase!.auth.getSession();
        if (!current.session) {
          void supabase!.auth.signInAnonymously();
        }
      };

      // signUp directly (no upfront signOut round-trip): the new account's
      // session replaces the guest one on success.
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        await restoreGuestIfNeeded();
        // signUp fails outright (confirmation off) for an existing email.
        if (/already registered|already been registered|user_already_exists/i.test(error.message)) {
          throw new Error(EMAIL_ALREADY_REGISTERED);
        }
        throw new Error(error.message);
      }

      const registeredUser = data.user;
      // Enumeration protection: an existing email returns a user whose
      // identities array is empty instead of an error.
      if (registeredUser && registeredUser.identities && registeredUser.identities.length === 0) {
        await restoreGuestIfNeeded();
        throw new Error(EMAIL_ALREADY_REGISTERED);
      }
      if (!registeredUser) {
        await restoreGuestIfNeeded();
        throw new Error("注册失败，请稍后再试");
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ id: registeredUser.id, nickname: trimmedNickname }, { onConflict: "id" });

      if (profileError) {
        throw new Error(profileError.message);
      }

      setNickname(trimmedNickname);
      // onAuthStateChange (SIGNED_IN) refreshes user state automatically.
    },
    [],
  );

  const signInWithPassword = useCallback(async (rawEmail: string, password: string) => {
    const email = rawEmail.trim();
    if (!email || !password) {
      throw new Error("邮箱和密码不能为空");
    }
    if (!supabase) {
      throw new Error("Supabase 未配置");
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(error.message);
    }
    // onAuthStateChange (SIGNED_IN) swaps in the real account session.
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) {
      return;
    }
    invalidateGrowthCache();
    await supabase.auth.signOut();
    // Keep the app usable: drop straight back into a fresh anonymous session.
    await supabase.auth.signInAnonymously();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const userId = user?.id ?? null;
    const isAnonymous = Boolean(user?.is_anonymous);
    return {
      isConfigured: configured,
      isLoading,
      userId,
      isAnonymous,
      email: user?.is_anonymous ? null : (user?.email ?? null),
      nickname: isAnonymous ? null : nickname,
      saveNickname,
      registerAccount,
      signInWithPassword,
      signOut,
    };
  }, [configured, isLoading, user, nickname, saveNickname, registerAccount, signInWithPassword, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
