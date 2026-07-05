import { MicTabIcon, UserTabIcon } from "./ui/icons";

export type MainTab = "practice" | "me";

export interface BottomTabBarProps {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}

const TABS: Array<{ id: MainTab; label: string; Icon: typeof MicTabIcon }> = [
  { id: "practice", label: "练习", Icon: MicTabIcon },
  { id: "me", label: "我的", Icon: UserTabIcon },
];

export function BottomTabBar({ active, onChange }: BottomTabBarProps) {
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle/80 bg-surface/95 backdrop-blur-xl"
    >
      <div className="page-shell grid grid-cols-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 py-2.5 text-xs transition-colors ${
                isActive ? "text-accent" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <tab.Icon className="h-5 w-5" />
              <span className={isActive ? "font-semibold" : "font-medium"}>{tab.label}</span>
              {isActive ? (
                <span className="mt-0.5 h-0.5 w-5 rounded-full bg-accent" aria-hidden="true" />
              ) : (
                <span className="mt-0.5 h-0.5 w-5" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
