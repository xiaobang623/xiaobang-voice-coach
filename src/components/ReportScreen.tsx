import type { GrowthNewExpression, ReportJSON, TaskGoal } from "../types";
import { ReportView } from "./ReportView";
import { Button } from "./ui/Button";
import { Mascot } from "./ui/Mascot";

export interface ReportScreenProps {
  report: ReportJSON | null;
  loading: boolean;
  error: string | null;
  wordCount: number;
  sentenceCount: number;
  taskGoals?: TaskGoal[];
  /** 注册用户报告会存到「我的 → 练习记录」；游客不保存 */
  savedToHistory: boolean;
  onBackToChat: () => void;
  onExit: () => void;
  onRepracticeExpressions?: (expressions: GrowthNewExpression[]) => void;
}

/**
 * 复盘报告独立页：对话结束后全屏展示，不再挤在聊天气泡下方。
 * - 报告就绪：立即展示（后台保存不阻塞阅读），底部「完成练习」+ 去向提示
 * - 生成中：loading 态 + 可直接退出（注册用户报告生成后仍会自动保存）
 * - 失败：错误提示 + 返回对话 / 退出
 */
export function ReportScreen({
  report,
  loading,
  error,
  wordCount,
  sentenceCount,
  taskGoals,
  savedToHistory,
  onBackToChat,
  onExit,
  onRepracticeExpressions,
}: ReportScreenProps) {
  // 报告已生成就直接展示，哪怕后台还在保存（loading 仍为 true）
  if (report) {
    return (
      <section className="animate-fade-up mx-auto w-full max-w-[40rem] pb-12 pt-4 md:pt-6">
        <ReportView
          report={report}
          wordCount={wordCount}
          sentenceCount={sentenceCount}
          taskGoals={taskGoals}
          onRepracticeExpressions={onRepracticeExpressions}
        />

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button onClick={onExit} className="min-w-[12rem]">
            完成练习
          </Button>
          <p className="text-center text-xs text-text-muted">
            {savedToHistory
              ? "报告已自动保存，之后可在「我的 → 练习记录 → 历史复盘」随时回看"
              : "游客模式不保存历史报告，注册登录后可随时回看每次复盘"}
          </p>
          <button
            type="button"
            onClick={onBackToChat}
            className="rounded-full px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
          >
            返回继续聊
          </button>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="animate-fade-up mx-auto flex w-full max-w-[40rem] flex-1 flex-col items-center justify-center gap-4 py-20">
        <Mascot expression="thinking" size={64} />
        <p className="text-sm text-text-secondary">小榜正在整理今天的复盘…</p>
        <p className="px-6 text-center text-xs text-text-muted">
          {savedToHistory
            ? "通常只要几秒钟。不想等也可以直接退出，报告生成后会自动保存到「我的 → 练习记录 → 历史复盘」"
            : "通常只要几秒钟。游客模式下报告不会保存，退出后就看不到了哦"}
        </p>
        <Button variant="outline" size="sm" onClick={onExit} className="mt-2">
          先退出，稍后再看
        </Button>
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
          <Button variant="outline" size="sm" onClick={onBackToChat}>
            返回对话重试
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
      <p className="text-sm text-text-muted">还没有可展示的复盘报告</p>
      <Button variant="outline" size="sm" onClick={onBackToChat}>
        返回对话
      </Button>
    </section>
  );
}
