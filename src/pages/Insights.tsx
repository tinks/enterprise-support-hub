import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, startOfMonth, subMonths } from "date-fns";
import { Sparkles, RefreshCw, Loader2, ChevronRight } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface Bucket {
  name: string;
  description: string;
  ticket_count: number;
  product_areas: Record<string, number>;
  example_subjects: string[];
  ticket_ids: string[];
}

interface Insight {
  id: string;
  month: string;
  source: string;
  generated_at: string;
  ticket_count: number;
  buckets: Bucket[];
  product_area_summary: Record<string, number>;
  overall_summary: string;
}

interface TicketRow {
  id: string;
  subject: string | null;
  contact_name: string | null;
  status: string | null;
}

function buildMonthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = startOfMonth(subMonths(now, i));
    opts.push({ value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") });
  }
  return opts;
}

const Insights = () => {
  const { toast } = useToast();
  const monthOptions = useMemo(buildMonthOptions, []);
  const defaultMonth = monthOptions[1]?.value || monthOptions[0].value; // last completed month
  const [month, setMonth] = useState<string>(defaultMonth);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [openBucket, setOpenBucket] = useState<Bucket | null>(null);
  const [bucketTickets, setBucketTickets] = useState<TicketRow[]>([]);

  const loadInsight = async (m: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("monthly_insights")
      .select("*")
      .eq("month", m)
      .eq("source", "intercom")
      .maybeSingle();
    setLoading(false);
    if (error) {
      toast({ title: "Failed to load insights", description: error.message, variant: "destructive" });
      return;
    }
    setInsight(data as unknown as Insight | null);
  };

  useEffect(() => { loadInsight(month); }, [month]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-intercom-month", {
        body: { month },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({ title: "Insights generated", description: `${(data as { ticket_count: number }).ticket_count} tickets analyzed.` });
      await loadInsight(month);
    } catch (e) {
      toast({ title: "Generation failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const openBucketDetail = async (b: Bucket) => {
    setOpenBucket(b);
    setBucketTickets([]);
    if (!b.ticket_ids?.length) return;
    const { data } = await supabase
      .from("manual_conversations")
      .select("id, subject, contact_name, status")
      .in("id", b.ticket_ids);
    setBucketTickets((data || []) as TicketRow[]);
  };

  const productAreaSorted = useMemo(() => {
    if (!insight) return [];
    return Object.entries(insight.product_area_summary).sort((a, b) => b[1] - a[1]);
  }, [insight]);
  const maxPa = productAreaSorted[0]?.[1] || 1;

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" />
                Insights
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                AI-clustered topic buckets across all Intercom tickets for the selected month.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={generate} disabled={generating || loading}>
                {generating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyzing…</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2" />{insight ? "Regenerate" : "Generate"}</>
                )}
              </Button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…
            </div>
          )}

          {!loading && !insight && (
            <Card>
              <CardContent className="p-10 text-center space-y-3">
                <Sparkles className="h-10 w-10 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No insights yet for this month. Click Generate to run the analysis.
                </p>
              </CardContent>
            </Card>
          )}

          {!loading && insight && (
            <>
              <Card>
                <CardContent className="p-6 space-y-3">
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold">{insight.ticket_count}</span>
                    <span className="text-sm text-muted-foreground">Intercom tickets analyzed</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      Generated {format(new Date(insight.generated_at), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                  {insight.overall_summary && (
                    <p className="text-sm leading-relaxed text-foreground whitespace-pre-line pt-2 border-t">
                      {insight.overall_summary}
                    </p>
                  )}
                </CardContent>
              </Card>

              <div>
                <h2 className="text-lg font-semibold mb-3">Topic buckets</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {insight.buckets.map(b => (
                    <Card key={b.name} className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => openBucketDetail(b)}>
                      <CardContent className="p-5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-foreground">{b.name}</h3>
                          <Badge variant="secondary">{b.ticket_count}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{b.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(b.product_areas)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 4)
                            .map(([area, n]) => (
                              <Badge key={area} variant="outline" className="text-xs">{area} · {n}</Badge>
                            ))}
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-1 pt-1">
                          {b.example_subjects.slice(0, 3).map((s, i) => (
                            <li key={i} className="truncate">▸ {s}</li>
                          ))}
                        </ul>
                        <div className="text-xs text-primary flex items-center gap-1 pt-1">
                          View all {b.ticket_count} <ChevronRight className="h-3 w-3" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-3">By product area</h2>
                <Card>
                  <CardContent className="p-5 space-y-2">
                    {productAreaSorted.map(([area, count]) => (
                      <div key={area} className="flex items-center gap-3">
                        <div className="w-32 text-sm truncate">{area}</div>
                        <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 bg-primary/70"
                            style={{ width: `${(count / maxPa) * 100}%` }}
                          />
                        </div>
                        <div className="w-10 text-right text-sm font-medium">{count}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      <Sheet open={!!openBucket} onOpenChange={(v) => !v && setOpenBucket(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {openBucket && (
            <>
              <SheetHeader>
                <SheetTitle>{openBucket.name}</SheetTitle>
                <p className="text-xs text-muted-foreground pt-1">{openBucket.description}</p>
              </SheetHeader>
              <div className="mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">{openBucket.ticket_count} tickets</p>
                <ul className="space-y-2">
                  {bucketTickets.map(t => (
                    <li key={t.id} className="text-sm border rounded p-2 hover:bg-accent/40">
                      <Link to={`/conversations/${t.id}?source=manual`} className="block">
                        <div className="font-medium truncate">{(t.subject || "(no subject)").replace(/<[^>]+>/g, "")}</div>
                        <div className="text-xs text-muted-foreground flex gap-2 mt-0.5">
                          {t.contact_name && <span className="truncate">{t.contact_name}</span>}
                          {t.status && <span>· {t.status}</span>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
};

export default Insights;
