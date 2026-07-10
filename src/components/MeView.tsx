import { useEffect, useState, type ReactNode } from "react";
import { AccountPanel } from "./AccountPanel";
import { GrowthPanel } from "./GrowthView";
import { SettingsIcon } from "./SettingsIcon";
import { SettingsView } from "./SettingsView";
import { SubPageHeader } from "./SubPageHeader";
import { Card } from "./ui/Card";
import { useAuth } from "../hooks/useAuth";

const ICONS = {
  profile: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  plan: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  voice: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 11a6 6 0 0 0 12 0M12 19v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  list: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M4 12h10M4 18h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  bell: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4a5 5 0 0 0-5 5v3.4L5.4 15h13.2L17 12.4V9a5 5 0 0 0-5-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  notif: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21c-4.4 0-8-1.6-8-4.5S6 12 6 9a6 6 0 0 1 12 0c0 3 2 4.6 2 7.5S16.4 21 12 21Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  privacy: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  help: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.5 9.2a2.5 2.5 0 0 1 4.9.7c0 1.6-2.4 1.8-2.4 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v.01M12 11v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

type MeScreen = "home" | "settings" | "account";
type AccountBackTarget = "home" | "settings";

export interface MeViewProps {
  accountDeepLink?: number;
  onAccountExit?: () => void;
  onAccountDeepLinkConsumed?: () => void;
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
  isLink = false,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick?: () => void;
  isLink?: boolean;
}) {
  const Comp = onClick ? "button" : "a";
  return (
    <Comp
      {...(onClick ? { type: "button", onClick } : { href: "#" })}
      className="flex min-h-11 items-center justify-between gap-4 py-3.5 text-left text-inherit"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-ink-soft">
          {icon}
        </div>
        <span className="text-[14px] font-medium tracking-tight text-text">{label}</span>
      </div>
      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        {value ? <span>{value}</span> : null}
        {isLink ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>
    </Comp>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="section-title">{title}</div>
      <CardShell>{children}</CardShell>
    </div>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return (
    <Card variant="default" className="p-0">
      <div className="px-5">{children}</div>
    </Card>
  );
}

export function MeView({ accountDeepLink = 0, onAccountExit, onAccountDeepLinkConsumed }: MeViewProps) {
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
      onAccountDeepLinkConsumed?.();
    }
  }, [accountDeepLink, onAccountDeepLinkConsumed]);

  const handleAccountBack = () => {
    if (onAccountExit) {
      onAccountExit();
      return;
    }
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
            if (onAccountExit) {
              onAccountExit();
              return;
            }
            setScreen(accountBackTarget === "settings" ? "settings" : "home");
          }}
        />
      </section>
    );
  }

  return (
    <section className="animate-fade-up pb-2">
      <header className="app-top-bar mb-7 flex items-start justify-between gap-4 md:mb-9 md:pt-0">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-text-muted">我的</p>
          <div className="profile-row mt-3 flex items-center gap-3.5">
            <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-ink text-bg text-[18px] font-bold">
              {displayName?.[0]?.toUpperCase() ?? "A"}
            </div>
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight text-text">
                {displayName ?? "Alex"}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-text-muted">alex@example.com</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setScreen("settings")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-secondary shadow-card transition-colors active:scale-95 hover:text-text"
          aria-label="偏好与账号"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <SettingsGroup title="账号">
            <SettingsRow icon={ICONS.profile} label="个人资料" onClick={() => openAccount("home")} isLink />
            <div className="border-t border-border-subtle" />
            <SettingsRow icon={ICONS.plan} label="订阅与升级" value="高级会员" isLink />
          </SettingsGroup>

          <SettingsGroup title="练习">
            <SettingsRow icon={ICONS.voice} label="语音设置" value="Aria · 美式" isLink onClick={() => setScreen("settings")} />
            <div className="border-t border-border-subtle" />
            <SettingsRow icon={ICONS.list} label="练习偏好" isLink onClick={() => setScreen("settings")} />
            <div className="border-t border-border-subtle" />
            <SettingsRow icon={ICONS.bell} label="每日提醒" value="晚 8:00" />
          </SettingsGroup>
        </div>

        <div className="space-y-6">
          <SettingsGroup title="通用">
            <SettingsRow icon={ICONS.notif} label="通知" isLink />
            <div className="border-t border-border-subtle" />
            <SettingsRow icon={ICONS.privacy} label="隐私与数据" isLink />
          </SettingsGroup>

          <SettingsGroup title="支持">
            <SettingsRow icon={ICONS.help} label="帮助中心" isLink />
            <div className="border-t border-border-subtle" />
            <SettingsRow icon={ICONS.info} label="关于小榜" value="v2.4.0" />
          </SettingsGroup>

          <button
            type="button"
            className="flex h-14 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface text-[15px] font-semibold tracking-tight text-[#A85A42] shadow-card transition active:scale-[0.98]"
          >
            退出登录
          </button>
        </div>
      </div>

      <section className="mt-8">
        <GrowthPanel isGuest={isAnonymous} onGoToAccount={() => openAccount("home")} />
      </section>
    </section>
  );
}
