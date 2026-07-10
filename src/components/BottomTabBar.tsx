import { MicTabIcon, RecordTabIcon, UserTabIcon } from "./ui/icons";

export type MainTab = "practice" | "record" | "me";

export interface BottomTabBarProps {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}

const TABS: Array<{ id: MainTab; label: string; Icon: typeof MicTabIcon }> = [
  { id: "practice", label: "练习", Icon: MicTabIcon },
  { id: "record", label: "记录", Icon: RecordTabIcon },
  { id: "me", label: "我的", Icon: UserTabIcon },
];

export function BottomTabBar({ active, onChange }: BottomTabBarProps) {
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="page-shell">
        <div className="mx-auto flex h-16 max-w-[360px] items-center justify-around rounded-[1.5rem] border border-border bg-surface/90 px-2 shadow-elevated backdrop-blur-xl">
          {TABS.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex h-12 w-16 flex-col items-center justify-center gap-1 rounded-[0.8rem] text-[11px] font-semibold tracking-tight transition-colors active:scale-95 ${
                  isActive ? "text-text" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                <tab.Icon
                  key={isActive ? `${tab.id}-active` : tab.id}
                  className={`h-[22px] w-[22px] ${isActive ? "animate-tab-pop" : ""}`}
                />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
