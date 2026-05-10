import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MonthData, NormalizedTicket, sourceLabel, ticketHref } from "./useMonthData";

interface CustomerAgg {
  key: string;
  label: string;
  count: number;
  sources: Set<string>;
  bugs: number;
  features: number;
  csatSum: number;
  csatN: number;
  productAreas: Record<string, number>;
  tickets: NormalizedTicket[];
}

const buckets = [
  { label: "1", test: (n: number) => n === 1 },
  { label: "2", test: (n: number) => n === 2 },
  { label: "3", test: (n: number) => n === 3 },
  { label: "4–5", test: (n: number) => n >= 4 && n <= 5 },
  { label: "6–10", test: (n: number) => n >= 6 && n <= 10 },
  { label: "10+", test: (n: number) => n > 10 },
];

export function CustomersTab({ data }: { data: MonthData }) {
  const [openCust, setOpenCust] = useState<CustomerAgg | null>(null);

  const customers = useMemo<CustomerAgg[]>(() => {
    const map = new Map<string, CustomerAgg>();
    for (const t of data.tickets) {
      let c = map.get(t.customer_key);
      if (!c) {
        c = { key: t.customer_key, label: t.customer_label, count: 0, sources: new Set(), bugs: 0, features: 0, csatSum: 0, csatN: 0, productAreas: {}, tickets: [] };
        map.set(t.customer_key, c);
      }
      c.count++;
      c.sources.add(t.display_source);
      if (t.is_bug) c.bugs++;
      if (t.is_feature_request) c.features++;
      if (t.csat_rating) { c.csatSum += t.csat_rating; c.csatN++; }
      c.productAreas[t.product_area] = (c.productAreas[t.product_area] || 0) + 1;
      c.tickets.push(t);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [data.tickets]);

  const totalUnique = customers.length;
  const repeat = customers.filter(c => c.count >= 2).length;
  const single = customers.filter(c => c.count === 1).length;

  const histogram = buckets.map(b => ({ label: b.label, count: customers.filter(c => b.test(c.count)).length }));
  const histMax = Math.max(1, ...histogram.map(h => h.count));

  if (data.loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-5"><div className="text-3xl font-bold">{totalUnique}</div><div className="text-xs text-muted-foreground mt-1">Unique customers</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-3xl font-bold">{repeat}</div><div className="text-xs text-muted-foreground mt-1">Repeat customers (≥2 tickets)</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-3xl font-bold">{single}</div><div className="text-xs text-muted-foreground mt-1">Single-ticket customers</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3">Tickets per customer distribution</h3>
          <div className="space-y-2">
            {histogram.map(h => (
              <div key={h.label} className="flex items-center gap-3">
                <div className="w-12 text-sm">{h.label}</div>
                <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${(h.count / histMax) * 100}%` }} />
                </div>
                <div className="w-10 text-right text-sm font-medium">{h.count}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Customer</TableHead>
                <TableHead>Tickets</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Bugs</TableHead>
                <TableHead>FRs</TableHead>
                <TableHead>Avg CSAT</TableHead>
                <TableHead>Top product area</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.slice(0, 50).map(c => {
                const topPa = Object.entries(c.productAreas).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
                const csat = c.csatN ? (c.csatSum / c.csatN).toFixed(1) : "—";
                return (
                  <TableRow key={c.key} className="cursor-pointer" onClick={() => setOpenCust(c)}>
                    <TableCell className="font-medium truncate max-w-[220px]">{c.label}</TableCell>
                    <TableCell>{c.count}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {Array.from(c.sources).map(s => (
                          <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">{sourceLabel[s] || s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{c.bugs}</TableCell>
                    <TableCell>{c.features}</TableCell>
                    <TableCell>{csat}</TableCell>
                    <TableCell className="truncate max-w-[160px]">{topPa}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {customers.length > 50 && (
            <div className="p-3 text-xs text-muted-foreground border-t">Showing top 50 of {customers.length}</div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!openCust} onOpenChange={(v) => !v && setOpenCust(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {openCust && (
            <>
              <SheetHeader>
                <SheetTitle>{openCust.label}</SheetTitle>
                <p className="text-xs text-muted-foreground pt-1">{openCust.count} tickets this month</p>
              </SheetHeader>
              <ul className="mt-4 space-y-2">
                {openCust.tickets.map(t => (
                  <li key={t.id} className="text-sm border rounded p-2 hover:bg-accent/40">
                    <Link to={ticketHref(t)} className="block">
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-0.5 shrink-0">{sourceLabel[t.display_source]}</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{t.subject}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{t.product_area} · {new Date(t.created_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
