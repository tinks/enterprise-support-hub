import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, Copy, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";

type Ticket = {
  intercom_id: string;
  subject: string;
  created_at: string | null;
  state: string | null;
  customer_key: string | null;
  owner: string | null;
  classification: string | null;
  excerpt: string;
};

type Theme = {
  name: string;
  description: string;
  category: "bug" | "support_gap" | "feature_request" | string;
  recommendation: string;
  ticket_ids: string[];
};

type Result = {
  topic: string;
  days: number;
  matched: number;
  analyzed: number;
  truncated: boolean;
  summary: string | null;
  themes: Theme[];
  tickets: Ticket[];
};

const CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug / product issue",
  support_gap: "Support / doc gap",
  feature_request: "Feature request",
};

const CATEGORY_CLASS: Record<string, string> = {
  bug: "bg-destructive/10 text-destructive border-destructive/30",
  support_gap: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  feature_request: "bg-primary/10 text-primary border-primary/30",
};

const WINDOWS = [
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last 12 months" },
];

function monthKey(iso: string | null): string {
  if (!iso) return "unknown";
  return iso.slice(0, 7);
}

export default function TopicDeepDive() {
  const [topic, setTopic] = useState("");
  const [days, setDays] = useState("90");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const byId = useMemo(() => {
    const m = new Map<string, Ticket>();
    for (const t of result?.tickets ?? []) m.set(t.intercom_id, t);
    return m;
  }, [result]);

  const trend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of result?.tickets ?? []) {
      const k = monthKey(t.created_at);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [result]);

  const maxMonth = Math.max(1, ...trend.map(([, n]) => n));

  const run = async () => {
    const q = topic.trim();
    if (!q) return;
    setRunning(true);
    setResult(null);
    setOpen({});
    const { data, error } = await supabase.functions.invoke("analyze-topic-trends", {
      body: { topic: q, days: Number(days) },
    });
    setRunning(false);
    if (error) {
      const msg = (data as { error?: string } | null)?.error ?? error.message;
      toast.error(`Analysis failed: ${msg}`);
      return;
    }
    if ((data as { error?: string })?.error) {
      toast.error((data as { error: string }).error);
      return;
    }
    setResult(data as Result);
  };

  const digest = () => {
    if (!result) return;
    const lines: string[] = [];
    lines.push(`*Topic deep dive — ${result.topic}* (last ${result.days} days)`);
    lines.push(
      `${result.matched} matching tickets${
        result.truncated ? `, ${result.analyzed} analysed` : ""
      }`,
    );
    if (result.summary) lines.push("", result.summary);
    lines.push("");
    result.themes.forEach((t, i) => {
      lines.push(
        `${i + 1}. *${t.name}* — ${t.ticket_ids.length} tickets · ${
          CATEGORY_LABEL[t.category] ?? t.category
        }`,
      );
      if (t.description) lines.push(`   ${t.description}`);
      if (t.recommendation) lines.push(`   → ${t.recommendation}`);
    });
    void navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Digest copied — paste into Slack");
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Pulls every ticket whose subject, messages, or attributes mention a topic within a date
        window, then clusters them into recurring themes with evidence. Read-only — nothing is
        written to Intercom or the ticket record.
      </p>

      <div className="flex flex-wrap gap-2">
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder="GitHub, SSO, database region, npm package…"
          className="flex-1 min-w-[260px]"
        />
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={run} disabled={running || !topic.trim()}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Analysing…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> Analyse topic
            </>
          )}
        </Button>
        {result && result.themes.length > 0 && (
          <Button variant="outline" onClick={digest}>
            <Copy className="h-4 w-4" /> Copy digest
          </Button>
        )}
      </div>

      {running && (
        <p className="text-sm text-muted-foreground">
          Reading tickets and clustering them — this usually takes 30-60 seconds.
        </p>
      )}

      {result && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-2xl font-semibold">{result.matched}</div>
              <div className="text-muted-foreground">tickets matched</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{result.themes.length}</div>
              <div className="text-muted-foreground">themes</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{result.analyzed}</div>
              <div className="text-muted-foreground">
                analysed{result.truncated ? " (capped)" : ""}
              </div>
            </div>
          </div>

          {trend.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="text-sm font-medium">Volume by month</div>
                <div className="flex items-end gap-3 h-28">
                  {trend.map(([m, n]) => (
                    <div key={m} className="flex flex-col items-center gap-1 flex-1">
                      <span className="text-xs text-muted-foreground">{n}</span>
                      <div
                        className="w-full bg-primary/70 rounded-t"
                        style={{ height: `${(n / maxMonth) * 80}px` }}
                      />
                      <span className="text-[10px] text-muted-foreground">{m}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {result.summary && (
            <Card>
              <CardContent className="p-4 text-sm leading-relaxed">{result.summary}</CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {result.themes.map((t, i) => {
              const expanded = !!open[i];
              return (
                <Card key={`${t.name}-${i}`}>
                  <CardContent className="p-4 space-y-3">
                    <button
                      type="button"
                      className="w-full text-left flex items-start gap-2"
                      onClick={() => setOpen((p) => ({ ...p, [i]: !p[i] }))}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 mt-1 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mt-1 shrink-0" />
                      )}
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t.name}</span>
                          <Badge variant="outline" className={CATEGORY_CLASS[t.category] ?? ""}>
                            {CATEGORY_LABEL[t.category] ?? t.category}
                          </Badge>
                          <Badge variant="secondary">{t.ticket_ids.length} tickets</Badge>
                        </div>
                        {t.description && (
                          <p className="text-sm text-muted-foreground">{t.description}</p>
                        )}
                        {t.recommendation && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">Recommendation: </span>
                            {t.recommendation}
                          </p>
                        )}
                      </div>
                    </button>

                    {expanded && (
                      <div className="border-t pt-3 space-y-2">
                        {t.ticket_ids.map((id) => {
                          const tk = byId.get(id);
                          return (
                            <div key={id} className="text-sm flex flex-wrap gap-x-3 gap-y-1">
                              <a
                                href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs inline-flex items-center gap-1 hover:underline"
                              >
                                {id} <ExternalLink className="h-3 w-3" />
                              </a>
                              <span className="flex-1 min-w-[200px]">{tk?.subject ?? ""}</span>
                              <span className="text-xs text-muted-foreground">
                                {tk?.customer_key ?? "—"} · {tk?.created_at?.slice(0, 10) ?? ""} ·{" "}
                                {tk?.state ?? ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {result.themes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No themes were produced for this topic and window.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
