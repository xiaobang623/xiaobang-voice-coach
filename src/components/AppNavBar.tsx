import { Mascot } from "./ui/Mascot";
import type { MainTab } from "./BottomTabBar";

export interface AppNavBarProps {
  active: MainTab;
  onChange: (tab: MainTab) => void;
  showLogin?: boolean;
  onLogin?: () => void;
}

const TABS: Array<{ id: MainTab; label: string }> = [
  { id: "practice", label: "练习" },
  { id: "me", label: "我的" },
];

export function AppNavBar({ active, onChange, showLogin, onLogin }: AppNavBarProps) {
  return (
    <header className="app-top-bar sticky top-0 z-30 w-full border-b border-border bg-bg/85 backdrop-blur-[16px] max-md:hidden">
      <div className="page-shell flex items-center justify-between gap-8 py-4">
        <div className="flex min-w-0 items-center gap-11">
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-base font-bold tracking-tight text-text">小榜</span>
          </div>

          <nav aria-label="主导航" className="flex items-center gap-[30px]">
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChange(tab.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative pb-4 pt-1 -mb-4 text-sm font-semibold tracking-tight transition-colors ${
                    isActive ? "text-text" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`absolute inset-x-0 bottom-0 h-[2px] bg-text transition-opacity ${
                      isActive ? "opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {showLogin && onLogin ? (
            <button
              type="button"
              onClick={onLogin}
              className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold tracking-tight text-text transition hover:border-border-strong active:scale-[0.98]"
            >
              登录 / 注册
            </button>
          ) : null}
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-muted">
            <Mascot expression="idle" size={32} bob={false} />
          </div>
        </div>
      </div>
    </header>
  );
}
