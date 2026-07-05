import { useEffect, useState } from "react";
import { AccountPanel } from "./AccountPanel";
import { GrowthPanel } from "./GrowthView";
import { SettingsIcon } from "./SettingsIcon";
import { SettingsView } from "./SettingsView";
import { SubPageHeader } from "./SubPageHeader";
import { Card } from "./ui/Card";
import { useAuth } from "../hooks/useAuth";

type MeScreen = "home" | "settings" | "account";
type AccountBackTarget = "home" | "settings";

export interface MeViewProps {
  /** Increment to open the account screen from outside (e.g. practice tab CTA). */
  accountDeepLink?: number;
}

export function MeView({ accountDeepLink = 0 }: MeViewProps) {
  const { isAnonymous, nickname } = useAuth();
  const [screen, setScreen] = useState<MeScreen>("home");
  const [accountBackTarget, setAccountBackTarget] = useState<AccountBackTarget>("settings");

  const displayName = nickname?.trim();

  const openAccount = (from: AccountBackTarget) => {
    setAccountBackTarget(from);
    setScreen("account");
  };

  useEffect(() => {
    if (accountDeepLink > 0) {
      setAccountBackTarget("home");
      setScreen("account");
    }
  }, [accountDeepLink]);

  const handleAccountBack = () => {
    setScreen(accountBackTarget);
  };

  if (screen === "settings") {
    return (
      <section className="animate-fade-up py-2">
        <SubPageHeader onBack={() => setScreen("home")} />
        <SettingsView onOpenAccount={() => openAccount("settings")} />
      </section>
    );
  }

  if (screen === "account") {
    return (
      <section className="animate-fade-up py-2">
        <SubPageHeader title="账号" onBack={handleAccountBack} />
        <AccountPanel
          onAuthenticated={() => {
            setScreen(accountBackTarget === "settings" ? "settings" : "home");
          }}
        />
      </section>
    );
  }

  return (
    <section className="animate-fade-up py-2">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-text-muted">我的练习</p>
          <h2 className="mt-2 text-2xl font-medium text-text">
            {displayName ? `你好，${displayName}` : "我的"}
          </h2>
          <p className="mt-2 text-sm text-text-muted">
            {isAnonymous ? "登录后保存成长记录和 Coach 记忆" : "查看你的练习成长"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setScreen("settings")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-raised text-text-secondary shadow-card transition-colors hover:bg-surface hover:text-accent"
          aria-label="偏好与账号"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </header>

      {isAnonymous ? (
        <Card variant="ghost" className="mb-6 space-y-3 border-dashed p-4">
          <p className="text-xs leading-relaxed text-text-muted">
            游客模式 · 练习记录不会保存
          </p>
          <button
            type="button"
            onClick={() => openAccount("home")}
            className="text-sm font-medium text-accent underline underline-offset-2"
          >
            登录 / 注册
          </button>
        </Card>
      ) : null}

      <GrowthPanel isGuest={isAnonymous} onGoToAccount={() => openAccount("home")} />
    </section>
  );
}
