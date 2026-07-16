import type { ExpressionPracticeSummary } from "../types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Mascot } from "./ui/Mascot";

export interface ExpressionPracticeSummaryScreenProps {
  summary: ExpressionPracticeSummary | null;
  loading: boolean;
  error: string | null;
  onBackToReport: () => void;
  onExit: () => void;
}

export function ExpressionPracticeSummaryScreen({
  summary,
  loading,
  error,
  onBackToReport,
  onExit,
}: ExpressionPracticeSummaryScreenProps) {
  if (summary) {
    return (
      <section className="animate-fade-up mx-auto w-full max-w-[40rem] space-y-6 pb-12 pt-4 md:pt-6">
        <header>
          <p className="eyebrow">表达复练小结</p>
          <h2 className="mt-2 text-[clamp(28px,4vw,38px)] font-bold tracking-tight text-text">
            这次先把表达开口用起来
          </h2>
          <p className="mt-2 max-w-[48ch] text-sm leading-relaxed text-text-secondary">
            不打分，也不判定掌握。先看你有没有尝试，再给一版更自然的说法。
          </p>
        </header>

        <div>
          <h3 className="text-[13px] font-semibold text-text-secondary">目标表达</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.targetExpressions.map((expression) => (
              <span
                key={expression}
                className="rounded-full border border-accent-teal/25 bg-accent-teal/10 px-3 py-1.5 text-xs font-medium text-accent-teal"
              >
                {expression}
              </span>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-[13px] font-semibold text-text-secondary">这次的使用反馈</h3>
          <ul className="mt-4 space-y-3">
            {summary.attemptedExpressions.map((item) => (
              <li key={item.target}>
                <Card variant="default" className="p-4">
                  <p className="text-[15px] font-semibold leading-snug text-text">{item.target}</p>
                  {item.userSentence ? (
                    <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
                      你说的：{item.userSentence}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[13px] leading-[1.6] text-text-secondary">{item.feedback}</p>
                  {item.betterVersion ? (
                    <p className="mt-2 text-[14px] font-semibold leading-snug text-accent-teal">
                      更自然：{item.betterVersion}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </div>

        <Card variant="inset" className="p-5">
          <p className="section-title !mb-0">下次先试这一个</p>
          <p className="mt-3 text-[16px] font-semibold text-text">{summary.nextSuggestion.expression}</p>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {summary.nextSuggestion.reason}
          </p>
        </Card>

        <div className="flex flex-col items-center gap-3 pt-2">
          <Button onClick={onExit} className="min-w-[12rem]">
            完成练习
          </Button>
          <button
            type="button"
            onClick={onBackToReport}
            className="rounded-full px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
          >
            回到原报告
          </button>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="animate-fade-up mx-auto flex w-full max-w-[40rem] flex-1 flex-col items-center justify-center gap-4 py-20">
        <Mascot expression="thinking" size={64} />
        <p className="text-sm text-text-secondary">小榜正在整理复练小结…</p>
        <p className="px-6 text-center text-xs text-text-muted">
          这份小结只展示在前端，不会覆盖刚才的普通报告。
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="animate-fade-up mx-auto flex w-full max-w-[40rem] flex-col items-center gap-5 py-16">
        <Mascot expression="idle" size={56} />
        <div className="w-full rounded-2xl bg-error-bg px-5 py-4 text-center text-sm text-error">
          {error}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBackToReport}>
            回到原报告
          </Button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
          >
            退出练习
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-fade-up mx-auto flex w-full max-w-[40rem] flex-col items-center gap-4 py-24">
      <p className="text-sm text-text-muted">还没有可展示的复练小结</p>
      <Button variant="outline" size="sm" onClick={onBackToReport}>
        回到原报告
      </Button>
    </section>
  );
}
