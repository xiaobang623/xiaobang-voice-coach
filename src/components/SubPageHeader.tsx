import { ChevronLeftIcon } from "./ui/icons";

export interface SubPageHeaderProps {
  title?: string;
  onBack: () => void;
}

export function SubPageHeader({ title, onBack }: SubPageHeaderProps) {
  return (
    <header className="mb-6 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm/70 hover:text-text"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        返回
      </button>
      {title ? (
        <h2 className="min-w-0 flex-1 truncate text-lg font-medium text-text">
          {title}
        </h2>
      ) : null}
    </header>
  );
}
