/**
 * The engine-v3 four-way resolution split, rendered as a stacked bar plus a
 * legend of shares. Used as a SUB-LINE under a resolution headline and inside
 * the trend tooltip — never as a KPI in its own right.
 *
 * Presentation only: every number comes from the persisted columns via
 * `summarizeSplit`, and rows the engine never stamped are reported as excluded
 * rather than folded in as zero.
 */
import {
  SPLIT_KEYS,
  SPLIT_LABEL,
  SPLIT_CLASS,
  SPLIT_TOOLTIP,
  type SplitSummary,
} from "@/lib/resolutionDisplay";
import { formatDuration } from "@/lib/durationStats";

export function ResolutionSplitBar({ summary }: { summary: SplitSummary }) {
  const w = summary.totals.window;
  if (w <= 0) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {SPLIT_KEYS.map((k) => (
        <div
          key={k}
          className={SPLIT_CLASS[k]}
          style={{ width: `${(summary.totals[k] / w) * 100}%` }}
          title={`${SPLIT_LABEL[k]} ${formatDuration(summary.totals[k])} — ${SPLIT_TOOLTIP[k]}`}
        />
      ))}
    </div>
  );
}

export function ResolutionSplitLine({
  summary,
  showBar = true,
  className = "",
}: {
  summary: SplitSummary;
  showBar?: boolean;
  className?: string;
}) {
  if (summary.n === 0) {
    return (
      <span className={`text-muted-foreground ${className}`}>
        Split unavailable — no finalized ticket in range carries the engine-v3 columns.
      </span>
    );
  }
  return (
    <div className={`space-y-1 ${className}`}>
      {showBar && <ResolutionSplitBar summary={summary} />}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
        {SPLIT_KEYS.map((k) => {
          const pct = summary.share[k];
          return (
            <span key={k} className="inline-flex items-center gap-1" title={SPLIT_TOOLTIP[k]}>
              <span className={`inline-block h-2 w-2 rounded-sm ${SPLIT_CLASS[k]}`} />
              {SPLIT_LABEL[k]} {pct == null ? "—" : `${pct.toFixed(0)}%`}
            </span>
          );
        })}
        <span>n = {summary.n.toLocaleString()}</span>
        {summary.noSplit > 0 && <span>· {summary.noSplit} without split</span>}
      </div>
    </div>
  );
}
