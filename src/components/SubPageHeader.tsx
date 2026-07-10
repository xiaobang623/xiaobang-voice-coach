import { ChevronLeftIcon } from "./ui/icons";

export interface SubPageHeaderProps {
  title?: string;
  onBack: () => void;
}

export function SubPageHeader({ title, onBack }: SubPageHeaderProps) {
  return (
    <header className="app-top-bar mb-8 flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm/70 hover:text-text"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        返回
      </button>
      {title ? (
        <h2 className="font-display min-w-0 flex-1 truncate text-xl font-medium tracking-tight text-text">
          {title}
        </h2>
      ) : null}
    </header>
  );
}
