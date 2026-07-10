export interface SegmentedTabsProps<T extends string> {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}

export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex rounded-full bg-bg-warm p-1.5"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`flex-1 rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
              isActive
                ? "bg-surface-raised text-text shadow-card"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
