import { useState, type FormEvent } from "react";
import { EMAIL_ALREADY_REGISTERED, useAuth } from "../hooks/useAuth";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { SegmentedTabs } from "./SegmentedTabs";

type AuthMode = "signup" | "login";

export interface AccountPanelProps {
  onAuthenticated?: () => void;
}

const inputClass =
  "w-full rounded-2xl border border-border-subtle bg-surface-raised px-4 py-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20";

export function AccountPanel({ onAuthenticated }: AccountPanelProps) {
  const {
    isConfigured,
    isAnonymous,
    email,
    nickname,
    registerAccount,
    signInWithPassword,
    signOut,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>("login");
  const [nicknameValue, setNicknameValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  if (!isConfigured) {
    return (
      <Card variant="ghost" className="p-5 text-sm text-text-muted">
        账号功能未配置 Supabase，当前仅可使用练习功能。
      </Card>
    );
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setEmailTaken(false);
    setPassword("");
    if (nextMode === "login") {
      setNicknameValue("");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setEmailTaken(false);
    try {
      if (mode === "signup") {
        await registerAccount(emailValue, password, nicknameValue);
      } else {
        await signInWithPassword(emailValue, password);
      }
      onAuthenticated?.();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      if (message === EMAIL_ALREADY_REGISTERED) {
        setError("这个邮箱已经注册过了，直接登录吧～");
        setEmailTaken(true);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const displayName = nickname?.trim() || null;
  const canSubmit =
    mode === "signup"
      ? Boolean(emailValue.trim() && password && nicknameValue.trim())
      : Boolean(emailValue.trim() && password);

  if (!isAnonymous && email) {
    return (
      <section className="space-y-5">
        <Card variant="elevated" className="p-6">
          <p className="text-xs text-text-muted">当前账号</p>
          <p className="mt-3 text-2xl font-medium text-text">
            {displayName ?? "学习者"}
          </p>
          <p className="mt-1 text-sm text-text-muted">{email}</p>
        </Card>

        <p className="text-sm leading-relaxed text-text-muted">
          你的练习记录、成长数据和 Coach 记忆都会保存在这个账号下，换设备登录即可找回。
        </p>

        <Button variant="outline" fullWidth onClick={() => void signOut()}>
          退出登录
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <p className="text-sm leading-relaxed text-text-muted">
        不登录也能去「练习」随便聊。登录后可保存复盘记录、成长数据和 Coach 记忆。
      </p>

      <SegmentedTabs
        ariaLabel="账号操作"
        tabs={[
          { id: "login", label: "登录" },
          { id: "signup", label: "注册" },
        ]}
        active={mode}
        onChange={switchMode}
      />

      <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
        {mode === "signup" ? (
          <input
            type="text"
            value={nicknameValue}
            onChange={(event) => setNicknameValue(event.target.value)}
            placeholder="昵称（例如：小明）"
            autoComplete="nickname"
            maxLength={32}
            className={inputClass}
          />
        ) : null}
        <input
          type="email"
          value={emailValue}
          onChange={(event) => setEmailValue(event.target.value)}
          placeholder="邮箱"
          autoComplete="email"
          className={inputClass}
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={mode === "signup" ? "设置密码（至少 6 位）" : "输入密码"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputClass}
        />

        {error ? (
          <div className="space-y-1.5">
            <p className="text-sm text-error">{error}</p>
            {emailTaken ? (
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-sm font-medium text-accent underline underline-offset-2"
              >
                用这个邮箱去登录 →
              </button>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" variant="primary" fullWidth disabled={busy || !canSubmit}>
          {busy ? "处理中…" : mode === "signup" ? "注册" : "登录"}
        </Button>
      </form>
    </section>
  );
}
