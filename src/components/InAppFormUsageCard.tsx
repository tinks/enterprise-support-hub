import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MonitorSmartphone } from "lucide-react";
import { format, parseISO } from "date-fns";

type Row = {
  intercom_conversation_id: string;
  subject: string | null;
  contact_email: string | null;
  customer_key: string | null;
  intercom_created_at: string | null;
  in_app_form_source: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  tag: "Intercom tag",
  attribute: "Custom attribute",
  signature: "Form template match",
};

export default function InAppFormUsageCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, count } = await supabase
        .from("intercom_tickets_v3")
        .select(
          "intercom_conversation_id, subject, contact_email, customer_key, intercom_created_at, in_app_form_source",
          { count: "exact" },
        )
        .eq("is_in_app_form", true)
        .order("intercom_created_at", { ascending: false })
        .limit(200);
      setRows((data as Row[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
  }, []);

  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.intercom_created_at) continue;
      const k = r.intercom_created_at.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const bySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.in_app_form_source ?? "signature";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const accounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.customer_key ?? "unresolved", (m.get(r.customer_key ?? "unresolved") ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [rows]);

  const max = Math.max(1, ...byMonth.map(([, n]) => n));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4" /> In-app support form
        </CardTitle>
        <CardDescription>
          Tickets opened through the in-app request form. Detected from an Intercom tag or custom
          attribute where present, falling back to the current form template signature.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold">{total}</span>
              <span className="text-sm text-muted-foreground">tickets since the v3 data floor</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {bySource.map(([s, n]) => (
                <Badge key={s} variant="outline" className="text-xs">
                  {SOURCE_LABEL[s] ?? s} · {n}
                </Badge>
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">By month</div>
              {byMonth.length === 0 && <div className="text-sm text-muted-foreground">No submissions yet.</div>}
              {byMonth.map(([m, n]) => (
                <div key={m} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground">
                    {format(parseISO(`${m}-01`), "MMM yyyy")}
                  </span>
                  <div className="h-2 rounded bg-primary" style={{ width: `${(n / max) * 60}%` }} />
                  <span className="font-medium">{n}</span>
                </div>
              ))}
            </div>

            {accounts.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Top accounts</div>
                <div className="flex flex-wrap gap-1.5">
                  {accounts.map(([a, n]) => (
                    <Badge key={a} variant="secondary" className="text-xs">{a} · {n}</Badge>
                  ))}
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Most recent</div>
                <div className="space-y-1">
                  {rows.slice(0, 8).map((r) => (
                    <div key={r.intercom_conversation_id} className="flex items-center gap-3 text-xs">
                      <span className="w-20 shrink-0 text-muted-foreground">
                        {r.intercom_created_at ? format(parseISO(r.intercom_created_at), "d MMM") : "—"}
                      </span>
                      <span className="truncate flex-1">{r.subject ?? "(no subject)"}</span>
                      <span className="shrink-0 text-muted-foreground font-mono">
                        {r.intercom_conversation_id}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
