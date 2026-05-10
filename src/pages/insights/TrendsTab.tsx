import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { format, getDaysInMonth, parse, startOfMonth } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { MonthData, SourceKey, sourceLabel } from "./useMonthData";

const sources: SourceKey[] = ["intercom", "slack", "gmail", "other"];
const colors: Record<SourceKey, string> = {
  intercom: "hsl(var(--primary))",
  slack: "hsl(var(--destructive))",
  gmail: "hsl(220 70% 55%)",
  other: "hsl(var(--muted-foreground))",
};

export function TrendsTab({ data, month }: { data: MonthData; month: string }) {
  const series = useMemo(() => {
    const monthStart = startOfMonth(parse(month + "-01", "yyyy-MM-dd", new Date()));
    const days = getDaysInMonth(monthStart);
    const arr = Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const row: { day: number; total: number } & Record<SourceKey, number> = {
        day, total: 0, intercom: 0, slack: 0, gmail: 0, other: 0,
      };
      return row;
    });
    for (const t of data.tickets) {
      const d = new Date(t.created_at);
      if (d.getMonth() !== monthStart.getMonth() || d.getFullYear() !== monthStart.getFullYear()) continue;
      const idx = d.getDate() - 1;
      if (idx < 0 || idx >= arr.length) continue;
      arr[idx][t.display_source]++;
      arr[idx].total++;
    }
    return arr;
  }, [data.tickets, month]);

  const max = Math.max(1, ...series.map(s => s.total));

  // Day of week distribution
  const dow = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const t of data.tickets) counts[new Date(t.created_at).getDay()]++;
    return counts;
  }, [data.tickets]);
  const dowMax = Math.max(1, ...dow);
  const dowLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (data.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;

  const monthLabel = format(parse(month + "-01", "yyyy-MM-dd", new Date()), "MMMM yyyy");

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold">Daily volume — {monthLabel}</h3>
            <div className="flex gap-3 text-xs">
              {sources.map(s => (
                <span key={s} className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm" style={{ background: colors[s] }} />
                  {sourceLabel[s]}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-stretch gap-1 h-48">
            {series.map(s => (
              <div key={s.day} className="flex-1 h-full flex flex-col-reverse gap-px" title={`Day ${s.day}: ${s.total}`}>
                {sources.map(src => s[src] > 0 && (
                  <div key={src} style={{ height: `${(s[src] / max) * 100}%`, background: colors[src] }} />
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>1</span><span>{Math.ceil(series.length / 2)}</span><span>{series.length}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3">By day of week</h3>
          <div className="space-y-2">
            {dow.map((n, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 text-sm">{dowLabels[i]}</div>
                <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${(n / dowMax) * 100}%` }} />
                </div>
                <div className="w-10 text-right text-sm font-medium">{n}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
