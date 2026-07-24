import { useEffect, useState } from "react";
import type { FunnelStepRow } from "./types";
import { defaultDateFrom, fetchFunnelSummary, todayIsoDate } from "./api";

type RangePreset = 7 | 30;

function formatConversion(value: number | null) {
  if (value === null) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function conversionToneClass(value: number | null) {
  if (value === null) {
    return "text-text-muted";
  }
  if (value >= 0.7) {
    return "text-emerald-700";
  }
  if (value >= 0.4) {
    return "text-amber-700";
  }
  return "text-red-700";
}

export function FunnelSection() {
  const [preset, setPreset] = useState<RangePreset>(7);
  const [steps, setSteps] = useState<FunnelStepRow[]>([]);
  const [extraEvents, setExtraEvents] = useState<FunnelStepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await fetchFunnelSummary({
          dateFrom: defaultDateFrom(preset),
          dateTo: todayIsoDate(),
        });
        if (!cancelled) {
          setSteps(result.steps ?? []);
          setExtraEvents(result.extra_events ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setSteps([]);
          setExtraEvents([]);
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preset]);

  const hasData = steps.some((step) => step.event_count > 0);

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">开口漏斗</h2>
          <p className="mt-1 text-xs text-text-muted">
            进入对话页 → 点「我准备好了」→ 说出第一句 → 完成会话 → 查看复盘
          </p>
        </div>
        <div className="flex gap-2">
          {([7, 30] as RangePreset[]).map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setPreset(days)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                preset === days
                  ? "border-text bg-text text-surface"
                  : "border-border bg-bg text-text-secondary hover:text-text"
              }`}
            >
              近 {days} 天
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}
      {loading ? <p className="text-sm text-text-muted">加载中…</p> : null}

      {!loading && !error ? (
        <>
          {!hasData ? (
            <p className="mb-3 text-sm text-text-muted">
              该区间还没有事件数据。前台完整走一次练习后这里就有数字了。
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-text-muted">
                <tr className="border-b border-border-subtle">
                  <th className="px-2 py-2">步骤</th>
                  <th className="px-2 py-2">触达人数</th>
                  <th className="px-2 py-2">事件次数</th>
                  <th className="px-2 py-2">上一步转化率</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step, index) => (
                  <tr key={step.event_name} className="border-b border-border-subtle/70">
                    <td className="px-2 py-2">
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg-warm text-xs text-text-secondary">
                        {index + 1}
                      </span>
                      {step.label}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{step.actor_count}</td>
                    <td className="px-2 py-2 tabular-nums text-text-secondary">{step.event_count}</td>
                    <td className={`px-2 py-2 tabular-nums ${conversionToneClass(step.conversion_from_prev)}`}>
                      {formatConversion(step.conversion_from_prev)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {extraEvents.length > 0 ? (
            <p className="mt-3 text-xs text-text-muted">
              其他事件：
              {extraEvents
                .map((row) => `${row.label} ${row.actor_count} 人 / ${row.event_count} 次`)
                .join(" · ")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
