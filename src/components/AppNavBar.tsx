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
  { id: "record", label: "记录" },
  { id: "me", label: "我的" },
];

export function AppNavBar({ active, onChange, showLogin, onLogin }: AppNavBarProps) {
  return (
    <header className="app-top-bar sticky top-0 z-30 w-full border-b border-border-subtle/80 bg-bg/95 backdrop-blur-xl max-md:hidden">
      <div className="page-shell flex items-center justify-between gap-8 py-5">
        <div className="flex min-w-0 items-center gap-10">
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-[1.15rem] font-semibold tracking-tight text-text">小榜</span>
          </div>

          <nav aria-label="主导航" className="flex items-center gap-8">
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChange(tab.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative pb-3 text-[1rem] font-medium tracking-tight transition-colors ${
                    isActive ? "text-text" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`absolute inset-x-0 -bottom-[1px] mx-auto h-[3px] w-8 rounded-full bg-text transition-opacity ${
                      isActive ? "opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-surface shadow-card">
            <Mascot expression="idle" size={30} bob={false} />
          </div>
        </div>
      </div>
    </header>
  );
}
