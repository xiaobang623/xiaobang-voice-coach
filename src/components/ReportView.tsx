import type {
  Correction,
  GrowthNewExpression,
  GrowthTalkMore,
  ReportGrowth,
  ReportJSON,
  ReportReusedExpression,
  TaskGoal,
  TaskGoalStatus,
} from "../types";
import { getCefrLevel, getLevelInfo } from "../config/levels";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { trackEventOnce } from "../core/analytics";

export interface ReportViewProps {
  report: ReportJSON | null;
  wordCount?: number;
  sentenceCount?: number;
  taskGoals?: TaskGoal[];
  onRepracticeExpressions?: (expressions: GrowthNewExpression[]) => void;
}

interface CoreExpression {
  original?: string;
  improved: string;
  why: string;
  example?: string;
  hookLine: string;
  relatedCorrection?: Correction;
  source: "focus" | "correction" | "fallback";
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  if (minutes === 0) {
    return `${rest} 秒`;
  }
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`;
}

function compactText(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[“”"'‘’`]/g, "")
    .replace(/[?.!,，。！？:：;；]/g, "")
    .replace(/\s+/g, " ");
}

function isSameExpression(a?: string | null, b?: string | null): boolean {
  const left = compactText(a);
  const right = compactText(b);
  return Boolean(left && right && left === right);
}

function isRelatedExpression(a?: string | null, b?: string | null): boolean {
  const left = compactText(a);
  const right = compactText(b);
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

function isValidText(value?: string | null): value is string {
  return Boolean(value && value.trim().length > 0);
}

function getGrowth(report: ReportJSON): ReportGrowth | undefined {
  if (!report.growth) {
    return undefined;
  }
  return {
    ...report.growth,
    sayBetter: Array.isArray(report.growth.sayBetter) ? report.growth.sayBetter : [],
    newExpressions: Array.isArray(report.growth.newExpressions) ? report.growth.newExpressions : [],
    talkMore: Array.isArray(report.growth.talkMore) ? report.growth.talkMore : [],
  };
}

function findCorrectionForFocus(report: ReportJSON, focusPhrase?: string): Correction | undefined {
  if (!report.corrections.length) {
    return undefined;
  }
  if (!focusPhrase) {
    return report.corrections[0];
  }
  return (
    report.corrections.find(
      (item) =>
        isRelatedExpression(item.original, focusPhrase) ||
        isRelatedExpression(item.corrected, focusPhrase),
    ) ?? report.corrections[0]
  );
}

function pickCoreExpression(report: ReportJSON): CoreExpression {
  const growth = getGrowth(report);
  const focus = growth?.focusNextTime;
  const relatedCorrection = findCorrectionForFocus(report, focus?.phrase);

  if (focus?.phrase) {
    const why = [relatedCorrection?.explanation, focus.why]
      .filter(isValidText)
      .filter((item, index, list) => list.findIndex((candidate) => candidate === item) === index)
      .join(" ");

    return {
      original: relatedCorrection?.original,
      improved: focus.phrase,
      why: why || "这是一句下次最容易复用、也最贴近这次话题的表达。",
      example: relatedCorrection?.example,
      hookLine: focus.hookLine || "下次先把这一句自然用出来，就已经赢了。",
      relatedCorrection,
      source: "focus",
    };
  }

  if (relatedCorrection) {
    return {
      original: relatedCorrection.original,
      improved: relatedCorrection.corrected,
      why: relatedCorrection.explanation || "这样说会更自然，也更接近真实口语里的表达方式。",
      example: relatedCorrection.example,
      hookLine: "下次先把这一句自然说出来，就已经赢了。",
      relatedCorrection,
      source: "correction",
    };
  }

  return {
    improved: "Could you give me an example?",
    why: "这是一句低压力、高频、真实对话里马上能用的表达。想让对方多解释一点时，可以直接用。",
    example: "Could you give me an example?",
    hookLine: "下次卡住时，先用这句把对话接下去。",
    source: "fallback",
  };
}

function hasEnoughContent(report: ReportJSON, wordCount?: number, sentenceCount?: number): boolean {
  const growth = getGrowth(report);
  const contentCount =
    (growth?.sayBetter.length ?? 0) +
    (growth?.newExpressions.length ?? 0) +
    (growth?.talkMore.length ?? 0) +
    report.corrections.length +
    (report.reusedExpressions?.length ?? 0);
  const sentences = sentenceCount ?? report.userTurns ?? 0;
  const words = wordCount ?? 0;

  return report.durationSeconds >= 90 || sentences >= 4 || words >= 25 || contentCount >= 5;
}

function buildSpeakingDelta(report: ReportJSON): string | null {
  const speakingSeconds = report.userSpeakingSeconds;
  const previousSeconds = report.previousUserSpeakingSeconds;
  if (typeof speakingSeconds !== "number" || typeof previousSeconds !== "number") {
    return null;
  }

  const diff = Math.round(speakingSeconds - previousSeconds);
  if (diff > 0) {
    return `比上次多开口 ${formatDuration(diff)}。`;
  }
  if (diff < 0) {
    return "这次说得少一点也没关系，先保持开口。";
  }
  return "和上次一样稳定开口。";
}

function buildSummaryLine(report: ReportJSON, sentenceCount?: number): string {
  const parts = [`${getCefrLevel(report.userLevel)}`, `聊了 ${formatDuration(report.durationSeconds)}`];
  const sentenceValue = sentenceCount ?? report.userTurns;
  if (typeof sentenceValue === "number") {
    parts.push(`${Math.max(0, sentenceValue)} 句话`);
  }
  if (typeof report.userSpeakingSeconds === "number") {
    parts.push(`开口 ${formatDuration(report.userSpeakingSeconds)}`);
  }

  return `${parts[0]}｜${parts.slice(1).join(" · ")}`;
}

function SectionHeading({
  kicker,
  title,
  description,
}: {
  kicker?: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      {kicker ? <p className="eyebrow text-accent-gold">{kicker}</p> : null}
      <h3 className="mt-1 text-[20px] font-bold tracking-tight text-text">{title}</h3>
      {description ? <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{description}</p> : null}
    </div>
  );
}

function SummarySection({
  report,
  wordCount,
  sentenceCount,
}: {
  report: ReportJSON;
  wordCount?: number;
  sentenceCount?: number;
}) {
  const levelInfo = getLevelInfo(getCefrLevel(report.userLevel));
  const delta = buildSpeakingDelta(report);

  return (
    <Card variant="default" className="overflow-hidden border-spark-soft bg-gradient-to-br from-surface via-surface to-spark-soft/40 p-5 shadow-card">
      <p className="text-sm font-medium text-text-muted">这次怎么样</p>
      <p className="mt-2 text-[17px] font-bold leading-snug text-text">{buildSummaryLine(report, sentenceCount)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <Badge tone="spark">{levelInfo.shortLabel}</Badge>
        {typeof wordCount === "number" ? <span>{Math.max(0, wordCount)} 个词</span> : null}
        {delta ? <span>{delta}</span> : null}
      </div>
    </Card>
  );
}

function progressStatusText(item: ReportReusedExpression): string {
  if (item.statusAfter === "mastered") {
    return `已复用 ${item.reuseCount} 次，基本掌握`;
  }
  if (item.statusAfter === "reviewing") {
    return `已复用 ${item.reuseCount} 次，正在变熟`;
  }
  return `已复用 ${item.reuseCount} 次，继续练`;
}

function ProgressEvidenceSection({ items }: { items?: ReportReusedExpression[] }) {
  if (!items?.length) {
    return null;
  }

  const [first, ...rest] = items;

  return (
    <Card variant="default" className="border-accent-teal/20 bg-accent-teal/5 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-teal text-surface">
          ✓
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-accent-teal">你把上次学的用出来了</p>
          <p className="mt-2 text-[17px] font-semibold leading-snug text-text">“{first.currentText}”</p>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">目标表达：{first.targetText}</p>
          <p className="mt-2 text-xs font-semibold text-accent-teal">{progressStatusText(first)}</p>
          {rest.length > 0 ? <p className="mt-2 text-xs text-text-muted">还有 {rest.length} 个表达也在变熟，放到更多小建议里。</p> : null}
        </div>
      </div>
    </Card>
  );
}

function CoreExpressionSection({
  report,
  shortReport,
}: {
  report: ReportJSON;
  shortReport: boolean;
}) {
  const core = pickCoreExpression(report);
  const showOriginal = core.original && !isSameExpression(core.original, core.improved);

  return (
    <Card variant="elevated" className="p-5">
      <SectionHeading
        kicker="Core"
        title="先带走这一句"
        description={
          shortReport
            ? "这次内容很短，不硬拆报告。先把这一句练熟就够了。"
            : "别贪多，这次优先把这一个表达变成下次能说出口的话。"
        }
      />

      <div className="mt-5 rounded-[22px] bg-text p-5 text-surface">
        <p className="text-xs font-semibold text-accent-gold-on-canvas">推荐说法</p>
        <p className="mt-2 text-[24px] font-bold leading-tight tracking-tight">{core.improved}</p>
      </div>

      {showOriginal ? (
        <div className="mt-4 rounded-2xl bg-bg-warm/70 p-4">
          <p className="text-xs font-semibold text-text-muted">你刚才说</p>
          <p className="mt-1 text-sm text-text-muted line-through decoration-border-strong">{core.original}</p>
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl bg-spark-soft/70 p-4">
        <p className="text-sm font-semibold text-text">为什么这样更好？</p>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{core.why}</p>
      </div>

      {core.example ? (
        <div className="mt-4 rounded-2xl border border-border-subtle bg-surface p-4">
          <p className="text-sm font-semibold text-text">下次可以直接这样用</p>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">“{core.example}”</p>
        </div>
      ) : null}

      <p className="mt-4 text-sm leading-relaxed text-text-secondary">{core.hookLine}</p>
    </Card>
  );
}

function isCoveredByCore(value: string | undefined, core: CoreExpression): boolean {
  return (
    isRelatedExpression(value, core.improved) ||
    isRelatedExpression(value, core.original) ||
    isRelatedExpression(value, core.relatedCorrection?.corrected) ||
    isRelatedExpression(value, core.relatedCorrection?.original)
  );
}

function pickNextExpressions(report: ReportJSON, shortReport: boolean) {
  const growth = getGrowth(report);
  const core = pickCoreExpression(report);
  if (!growth) {
    return {
      expressions: [] as GrowthNewExpression[],
      upgrades: [] as ReportGrowth["sayBetter"],
      talkMore: [] as GrowthTalkMore[],
    };
  }

  const maxExpressionCount = shortReport ? 1 : 2;
  const expressions = growth.newExpressions
    .filter((item) => !isCoveredByCore(item.phrase, core))
    .slice(0, maxExpressionCount);
  const upgrades = growth.sayBetter
    .filter((item) => !isCoveredByCore(item.original, core) && !isCoveredByCore(item.upgraded, core))
    .slice(0, shortReport ? 0 : 1);
  const talkMore = growth.talkMore.slice(0, shortReport ? 0 : 1);

  return { expressions, upgrades, talkMore };
}

function NextStepSection({
  report,
  shortReport,
  onRepracticeExpressions,
}: {
  report: ReportJSON;
  shortReport: boolean;
  onRepracticeExpressions?: (expressions: GrowthNewExpression[]) => void;
}) {
  const { expressions, upgrades, talkMore } = pickNextExpressions(report, shortReport);
  const hasAny = expressions.length > 0 || upgrades.length > 0 || talkMore.length > 0;

  if (!hasAny) {
    return (
      <Card variant="default" className="p-5">
        <SectionHeading
          kicker="Next"
          title="下次接着说"
          description="这次信息量不多，先给你一个最容易复用的表达。"
        />
        <div className="mt-4 rounded-2xl bg-bg-warm/70 p-4">
          <p className="text-[16px] font-semibold text-text">Could you give me an example?</p>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">想让对方多解释一点时，可以直接用。</p>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="default" className="p-5">
      <SectionHeading
        kicker="Next"
        title="下次接着说"
        description={shortReport ? "只留 1 个能马上复用的表达。" : "只留 2–3 个能复用的，不把你淹没在建议里。"}
      />

      <div className="mt-5 space-y-3">
        {expressions.map((item) => (
          <div key={item.phrase} className="rounded-2xl bg-bg-warm/70 p-4">
            <p className="text-[16px] font-semibold leading-snug text-text">{item.phrase}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{item.meaning}</p>
            {item.example ? <p className="mt-2 text-sm leading-relaxed text-text">“{item.example}”</p> : null}
          </div>
        ))}

        {upgrades.map((item) => (
          <div key={item.upgraded} className="rounded-2xl bg-spark-soft/55 p-4">
            <p className="text-xs font-semibold text-accent-gold">可以把原句升级成</p>
            <p className="mt-1.5 text-[16px] font-semibold leading-snug text-text">{item.upgraded}</p>
            {item.note ? <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{item.note}</p> : null}
          </div>
        ))}

        {talkMore.map((item) => (
          <div key={`${item.angle}-${item.starter}`} className="rounded-2xl border border-dashed border-spark/35 bg-surface p-4">
            <p className="text-sm font-semibold text-text">下次可以多聊一点：{item.angle}</p>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">“{item.starter}”</p>
          </div>
        ))}
      </div>

      {onRepracticeExpressions && expressions.length > 0 ? (
        <Button type="button" size="md" fullWidth onClick={() => onRepracticeExpressions(expressions)} className="mt-4">
          复练这些表达
        </Button>
      ) : null}
    </Card>
  );
}

const TASK_STATUS_LABEL: Record<TaskGoalStatus, string> = {
  done: "达成",
  partial: "部分达成",
  missed: "未达成",
};

function MoreSuggestions({
  report,
  wordCount,
  sentenceCount,
  taskGoals,
}: {
  report: ReportJSON;
  wordCount?: number;
  sentenceCount?: number;
  taskGoals?: TaskGoal[];
}) {
  const growth = getGrowth(report);
  const core = pickCoreExpression(report);
  const { expressions, upgrades, talkMore } = pickNextExpressions(report, false);
  const levelInfo = getLevelInfo(getCefrLevel(report.userLevel));

  const remainingCorrections = report.corrections
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) => !isCoveredByCore(item.original, core) && !isCoveredByCore(item.corrected, core),
    );
  const visibleExpressionPhrases = new Set(expressions.map((item) => compactText(item.phrase)));
  const remainingExpressions =
    growth?.newExpressions.filter(
      (item) => !isCoveredByCore(item.phrase, core) && !visibleExpressionPhrases.has(compactText(item.phrase)),
    ) ?? [];
  const visibleUpgradeTexts = new Set(upgrades.map((item) => compactText(item.upgraded)));
  const remainingUpgrades =
    growth?.sayBetter.filter(
      (item) =>
        !isCoveredByCore(item.original, core) &&
        !isCoveredByCore(item.upgraded, core) &&
        !visibleUpgradeTexts.has(compactText(item.upgraded)),
    ) ?? [];
  const visibleTalkMoreTexts = new Set(talkMore.map((item) => compactText(item.starter)));
  const remainingTalkMore =
    growth?.talkMore.filter((item) => !visibleTalkMoreTexts.has(compactText(item.starter))) ?? [];
  const remainingReused = report.reusedExpressions?.slice(1) ?? [];
  const taskResults = report.taskResults ?? [];
  const total =
    remainingCorrections.length +
    remainingExpressions.length +
    remainingUpgrades.length +
    remainingTalkMore.length +
    remainingReused.length +
    taskResults.length +
    1;

  if (total <= 1 && typeof wordCount !== "number" && typeof sentenceCount !== "number") {
    return null;
  }

  const goalDescById = Object.fromEntries((taskGoals ?? []).map((goal) => [goal.id, goal.desc]));

  return (
    <details className="group rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div>
          <p className="text-[16px] font-bold text-text">更多小建议</p>
          <p className="mt-1 text-sm text-text-muted">等级说明、数据明细和剩余建议，想细看再打开。</p>
        </div>
        <span className="rounded-full bg-bg-warm px-3 py-1 text-xs font-semibold text-text-secondary group-open:hidden">展开</span>
        <span className="hidden rounded-full bg-bg-warm px-3 py-1 text-xs font-semibold text-text-secondary group-open:inline">收起</span>
      </summary>

      <div className="mt-5 space-y-3">
        <div className="rounded-2xl bg-bg-warm/70 p-4 text-sm leading-relaxed text-text-secondary">
          <p className="font-semibold text-text">{getCefrLevel(report.userLevel)} · {levelInfo.shortLabel}</p>
          <p className="mt-1">{levelInfo.ability}</p>
          <p className="mt-2 text-xs text-text-muted">
            数据：{formatDuration(report.durationSeconds)}
            {typeof report.userSpeakingSeconds === "number" ? ` · 开口 ${formatDuration(report.userSpeakingSeconds)}` : ""}
            {typeof wordCount === "number" ? ` · ${wordCount} 个词` : ""}
            {typeof sentenceCount === "number" ? ` · ${sentenceCount} 句话` : ""}
          </p>
        </div>

        {remainingReused.map((item) => (
          <div key={`${item.targetText}-${item.currentText}`} className="rounded-2xl bg-accent-teal/5 p-4">
            <p className="text-xs font-semibold text-accent-teal">复用证据</p>
            <p className="mt-1.5 text-sm font-semibold text-text">“{item.currentText}”</p>
            <p className="mt-1 text-xs text-text-secondary">{progressStatusText(item)}</p>
          </div>
        ))}

        {remainingCorrections.map(({ item, index }) => (
          <details
            key={`${item.type}-${item.corrected}-${index}`}
            className="group/correction rounded-2xl bg-bg-warm/70 p-4"
            onToggle={(event) => {
              if (event.currentTarget.open) {
                trackEventOnce(`correction_view:${report.sessionId}:${index}`, "correction_view", {
                  sessionId: report.sessionId,
                  props: { index },
                });
              }
            }}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-text-muted">小修改</p>
                <p className="mt-1 text-sm font-semibold text-text">{item.corrected}</p>
              </div>
              <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-muted group-open/correction:hidden">展开</span>
              <span className="hidden rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-muted group-open/correction:inline">收起</span>
            </summary>
            <div className="mt-3 border-t border-border-subtle pt-3">
              <p className="text-sm text-text-muted line-through decoration-border-strong">{item.original}</p>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{item.explanation}</p>
            </div>
          </details>
        ))}

        {remainingUpgrades.map((item) => (
          <div key={item.upgraded} className="rounded-2xl bg-bg-warm/70 p-4">
            <p className="text-xs font-semibold text-text-muted">表达升级</p>
            <p className="mt-1.5 text-sm font-semibold text-text">{item.upgraded}</p>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{item.note}</p>
          </div>
        ))}

        {remainingExpressions.map((item) => (
          <div key={item.phrase} className="rounded-2xl bg-bg-warm/70 p-4">
            <p className="text-xs font-semibold text-text-muted">补充表达</p>
            <p className="mt-1.5 text-sm font-semibold text-text">{item.phrase}</p>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{item.meaning}</p>
          </div>
        ))}

        {remainingTalkMore.map((item) => (
          <div key={`${item.angle}-${item.starter}`} className="rounded-2xl bg-bg-warm/70 p-4">
            <p className="text-xs font-semibold text-text-muted">延展话题</p>
            <p className="mt-1.5 text-sm font-semibold text-text">{item.angle}</p>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">“{item.starter}”</p>
          </div>
        ))}

        {taskResults.map((result) => (
          <div key={result.goalId} className="rounded-2xl bg-bg-warm/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-text">{goalDescById[result.goalId] ?? result.goalId}</p>
              <Badge tone={result.status === "done" ? "accent" : "default"}>{TASK_STATUS_LABEL[result.status]}</Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{result.reason}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

export function ReportView({
  report,
  wordCount,
  sentenceCount,
  taskGoals,
  onRepracticeExpressions,
}: ReportViewProps) {
  if (!report) {
    return null;
  }

  const shortReport = !hasEnoughContent(report, wordCount, sentenceCount);

  return (
    <section className="animate-fade-up space-y-4 py-2">
      <header className="pb-1">
        <p className="eyebrow">Speaking Review</p>
        <h2 className="mt-2 text-[28px] font-black tracking-tight text-text">这次复盘</h2>
        <p className="mt-1.5 max-w-[44ch] text-sm leading-relaxed text-text-secondary">
          不追求满屏建议。今天先带走一个能用出来的表达。
        </p>
      </header>

      <SummarySection report={report} wordCount={wordCount} sentenceCount={sentenceCount} />
      <ProgressEvidenceSection items={report.reusedExpressions} />
      <CoreExpressionSection report={report} shortReport={shortReport} />
      <NextStepSection
        report={report}
        shortReport={shortReport}
        onRepracticeExpressions={onRepracticeExpressions}
      />
      <MoreSuggestions
        report={report}
        wordCount={wordCount}
        sentenceCount={sentenceCount}
        taskGoals={taskGoals}
      />

      <p className="px-4 pt-1 text-center text-xs leading-relaxed text-text-muted">
        练口语不是一次学很多，而是下次真的多说一句。
      </p>
    </section>
  );
}
