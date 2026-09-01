import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Copy, Check, Beaker, ExternalLink, Timer } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { CLEAN_DATA_START_DATE, CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";
import { median, percentile, formatDuration } from "@/lib/durationStats";
import { summarizeCsat, isRatingCounted, useCsatFilters, useCsatOverrides } from "@/lib/csat";
import { CsatFilterMenu } from "@/components/csat/CsatFilterMenu";
import { isSlaExcluded } from "@/lib/slaExclusions";
import { computeAnatomy } from "@/lib/resolutionAnatomy";
import { useTableSort, SortableHead } from "@/components/issues/useTableSort";
import { useCanEdit } from "@/hooks/useCanEdit";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { PLAN_LABEL, planScopeNote, inPlanScope, type PlanScope } from "@/lib/planTier";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend,
} from "recharts";

type Row = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  product_area: string | null;
  classification: string | null;
  tags: string[] | null;
  plan_tier: string | null;
  owner: string | null;
  customer_key: string | null;
  customer_resolution_method: string | null;
  rsa_override: boolean | null;
  lifecycle_status: string;
  state: string | null;
  intercom_created_at: string | null;
  finalized_at: string | null;
  transferred_at: string | null;
  time_to_resolve_s: number | null;
  time_to_first_admin_reply_s: number | null;
  reopen_count: number | null;
  csat_rating: number | null;
  csat_rater_is_internal: boolean | null;
  custom_attributes: Record<string, unknown> | null;
};

// The four Intercom custom attributes the Hub owns. Product area and ticket
// type also land on dedicated columns; severity and the engineering-escalation
// flag live only in custom_attributes.
const ATTR_SEVERITY = "Severity";
const ATTR_ESCALATED = "Escalated to Engineering";

function attr(r: Row, key: string): string {
  const v = (r.custom_attributes ?? {})[key];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}


type Account = { account_key: string; label: string; is_test: boolean };
type ChangelogRow = { id: string; entry_date: string; title: string; area: string | null; tags: string[] | null };
type EscalationRow = { id: string; created_at: string; hub_state: string; state_changed_at: string | null; linear_key: string | null };

const SECTIONS = [
  { key: "headline", label: "Headline" },
  { key: "themes", label: "Theme trends" },
  { key: "spikes", label: "Spikes" },
  { key: "customers", label: "Customer picture" },
  { key: "quality", label: "Quality" },
  { key: "shipped", label: "Shipped and process" },
  { key: "watch", label: "What to watch next month" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const UNSET = "— not set —";
const intercomUrl = (id: string) => `https://app.intercom.com/a/inbox/_/inbox/conversation/${id}`;

function monthOptions(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  let cur = startOfMonth(new Date());
  while (cur >= CLEAN_DATA_START_DATE) {
    out.push({ key: format(cur, "yyyy-MM"), label: format(cur, "MMMM yyyy") });
    cur = subMonths(cur, 1);
  }
  return out;
}

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${((n / d) * 100).toFixed(0)}%`;
}

function deltaLabel(cur: number, prev: number): string {
  const d = cur - prev;
  if (d === 0) return "0";
  const sign = d > 0 ? "+" : "−";
  const rel = prev > 0 ? ` (${sign}${Math.round((Math.abs(d) / prev) * 100)}%)` : "";
  return `${sign}${Math.abs(d)}${rel}`;
}

type MixRow = { name: string; cur: number; prev: number; share: number };

function buildMix(cur: Row[], prev: Row[], field: "product_area" | "classification"): MixRow[] {
  const c = new Map<string, number>();
  const p = new Map<string, number>();
  for (const r of cur) {
    const k = r[field] || UNSET;
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  for (const r of prev) {
    const k = r[field] || UNSET;
    p.set(k, (p.get(k) ?? 0) + 1);
  }
  const keys = new Set([...c.keys(), ...p.keys()]);
  const total = cur.length || 1;
  return [...keys]
    .map((name) => ({ name, cur: c.get(name) ?? 0, prev: p.get(name) ?? 0, share: ((c.get(name) ?? 0) / total) * 100 }))
    .sort((a, b) => b.cur - a.cur || a.name.localeCompare(b.name));
}

export default function MonthlyLookback() {
  const { canEdit } = useCanEdit();
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState<string>(() => {
    const last = subMonths(startOfMonth(new Date()), 1);
    const key = format(last, "yyyy-MM");
    return key;
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [changelog, setChangelog] = useState<ChangelogRow[]>([]);
  const [escalations, setEscalations] = useState<EscalationRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedSlack, setCopiedSlack] = useState(false);
  const [csatFilters, setCsatFilters] = useCsatFilters();
  const { overrides: csatOverrides } = useCsatOverrides();
  const [closedByTicket, setClosedByTicket] = useState<Record<string, number> | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [planScope, setPlanScope] = useState<PlanScope>("all");

  const monthStart = useMemo(() => startOfMonth(new Date(`${month}-01T00:00:00Z`)), [month]);
  const monthEnd = useMemo(() => endOfMonth(monthStart), [monthStart]);
  const prevStart = useMemo(() => startOfMonth(subMonths(monthStart, 1)), [monthStart]);
  const monthLabel = format(monthStart, "MMMM yyyy");
  const prevLabel = format(prevStart, "MMM yyyy");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("v3_customer_accounts").select("account_key,label,is_test");
      setAccounts((data ?? []) as Account[]);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setClosedByTicket(null);
      try {
        const fromIso = prevStart.toISOString();
        const toIso = monthEnd.toISOString();
        const all: Row[] = [];
        const PAGE = 1000;
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select(
              "id,intercom_conversation_id,subject,subject_override,product_area,classification,tags,plan_tier,owner,customer_key,customer_resolution_method,rsa_override,lifecycle_status,state,intercom_created_at,finalized_at,transferred_at,time_to_resolve_s,time_to_first_admin_reply_s,reopen_count,csat_rating,csat_rater_is_internal,custom_attributes",
            )
            .gte("intercom_created_at", fromIso)
            .lte("intercom_created_at", toIso)
            .order("intercom_created_at", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as Row[];
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }

        const [cl, esc, nt] = await Promise.all([
          supabase
            .from("changelog_entries")
            .select("id,entry_date,title,area,tags")
            .gte("entry_date", format(monthStart, "yyyy-MM-dd"))
            .lte("entry_date", format(monthEnd, "yyyy-MM-dd"))
            .order("entry_date", { ascending: true }),
          supabase
            .from("dev_escalations")
            .select("id,created_at,hub_state,state_changed_at,linear_key")
            .lte("created_at", toIso),
          supabase.from("esh_lookback_notes").select("section_key,note_text").eq("month", month),
        ]);

        if (cancelled) return;
        setRows(all);
        setChangelog((cl.data ?? []) as ChangelogRow[]);
        setEscalations((esc.data ?? []) as EscalationRow[]);
        const map: Record<string, string> = {};
        for (const n of nt.data ?? []) map[(n as any).section_key] = (n as any).note_text ?? "";
        setNotes(map);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [month, refreshKey]);

  const testKeys = useMemo(
    () => new Set(accounts.filter((a) => a.is_test).map((a) => a.account_key)),
    [accounts],
  );
  const accountLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.account_key, a.label);
    return m;
  }, [accounts]);

  const inMonth = (r: Row, start: Date, end: Date) => {
    if (!r.intercom_created_at) return false;
    const t = new Date(r.intercom_created_at).getTime();
    return t >= start.getTime() && t <= end.getTime();
  };

  // Plan scope: "all" | "enterprise" | "sse". Applied before every other cut,
  // so headline, themes, spikes, customers, quality and the narrative all run
  // over the same population.
  const inPlan = (r: Row) => inPlanScope(r.plan_tier, planScope);

  const curAll = useMemo(
    () => rows.filter((r) => inMonth(r, monthStart, monthEnd) && inPlan(r)),
    [rows, monthStart, monthEnd, planScope],
  );
  const prevAll = useMemo(
    () => rows.filter((r) => inMonth(r, prevStart, endOfMonth(prevStart)) && inPlan(r)),
    [rows, prevStart, planScope],
  );

  // Reporting population: created in the month, inside the Enterprise support
  // population (shared slaExclusions predicate), not transferred out.
  const inPop = (r: Row) =>
    r.lifecycle_status !== "transferred_out" && !isSlaExcluded(r, { testAccountKeys: testKeys });
  const cur = useMemo(() => curAll.filter(inPop), [curAll, testKeys]);
  const prev = useMemo(() => prevAll.filter(inPop), [prevAll, testKeys]);

  const curClosed = useMemo(() => cur.filter((r) => r.finalized_at), [cur]);
  const prevClosed = useMemo(() => prev.filter((r) => r.finalized_at), [prev]);
  const stillOpen = useMemo(() => cur.filter((r) => !r.finalized_at), [cur]);

  // Closure-rule leaks check all four Hub-owned Intercom attributes, not just
  // the two that have dedicated columns. Sam is the AI agent: it never sees the
  // closure form, so a Sam-owned ticket missing fields is not a human leak.
  // Counted separately so the number is visible rather than silently dropped.
  const missingFields = (r: Row): string[] => {
    const out: string[] = [];
    if (!attr(r, ATTR_SEVERITY)) out.push("severity");
    if (!r.product_area) out.push("product area");
    if (!r.classification) out.push("ticket type");
    if (!attr(r, ATTR_ESCALATED)) out.push("escalated to engineering");
    return out;
  };
  const allGapRows = useMemo(
    () => curClosed.filter((r) => missingFields(r).length > 0),
    [curClosed],
  );
  const gapRows = useMemo(() => allGapRows.filter((r) => r.owner !== "Sam"), [allGapRows]);
  const samGapCount = allGapRows.length - gapRows.length;

  // Escalated-to-engineering cut over closed tickets, this month vs prior.
  const escToEng = useMemo(() => {
    const yes = (list: Row[]) => list.filter((r) => attr(r, ATTR_ESCALATED).toLowerCase() === "yes").length;
    const unset = curClosed.filter((r) => !attr(r, ATTR_ESCALATED)).length;
    return { cur: yes(curClosed), prev: yes(prevClosed), unset, closedN: curClosed.length };
  }, [curClosed, prevClosed]);




  // Theme mix runs over CLOSED tickets only. Product area and ticket type are
  // set at closure, so an open ticket has no theme yet — mixing them in would
  // report a large fake "not set" bucket that only measures how many tickets
  // are still in flight.
  const areaMix = useMemo(() => buildMix(curClosed, prevClosed, "product_area"), [curClosed, prevClosed]);
  const typeMix = useMemo(() => buildMix(curClosed, prevClosed, "classification"), [curClosed, prevClosed]);

  const spikes = useMemo(() => {
    const prevTotal = prevClosed.length || 1;
    const curTotal = curClosed.length || 1;
    return areaMix
      .filter((m) => m.name !== UNSET)
      .map((m) => ({
        ...m,
        prevShare: (m.prev / prevTotal) * 100,
        shareDelta: (m.cur / curTotal) * 100 - (m.prev / prevTotal) * 100,
        isNew: m.prev === 0 && m.cur > 0,
      }))
      .filter((m) => Math.abs(m.shareDelta) >= 3 || (m.isNew && m.cur >= 3))
      .sort((a, b) => Math.abs(b.shareDelta) - Math.abs(a.shareDelta));
  }, [areaMix, curClosed.length, prevClosed.length]);

  const accountRows = useMemo(() => {
    const m = new Map<string, { key: string; label: string; cur: number; prev: number }>();
    const bump = (r: Row, which: "cur" | "prev") => {
      const key = r.customer_key || "unresolved";
      const e = m.get(key) ?? { key, label: accountLabel.get(key) ?? key, cur: 0, prev: 0 };
      e[which] += 1;
      m.set(key, e);
    };
    for (const r of cur) bump(r, "cur");
    for (const r of prev) bump(r, "prev");
    return [...m.values()].filter((x) => x.cur > 0).sort((a, b) => b.cur - a.cur || a.label.localeCompare(b.label));
  }, [cur, prev, accountLabel]);

  const concentration = useMemo(() => {
    const top5 = accountRows.slice(0, 5).reduce((a, b) => a + b.cur, 0);
    const top10 = accountRows.slice(0, 10).reduce((a, b) => a + b.cur, 0);
    return { top5, top10, accounts: accountRows.length };
  }, [accountRows]);

  const planMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of cur) m.set(r.plan_tier || "unknown", (m.get(r.plan_tier || "unknown") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [cur]);

  const quality = useMemo(() => {
    const times = curClosed.map((r) => r.time_to_resolve_s).filter((v): v is number => typeof v === "number" && v > 0);
    const prevTimes = prevClosed.map((r) => r.time_to_resolve_s).filter((v): v is number => typeof v === "number" && v > 0);
    const frt = cur.map((r) => r.time_to_first_admin_reply_s).filter((v): v is number => typeof v === "number" && v > 0);
    const csat = summarizeCsat(curClosed as any, csatOverrides, csatFilters);
    const ratings = curClosed
      .filter((r) => isRatingCounted(r as any, csatOverrides, csatFilters))
      .map((r) => r.csat_rating as number);
    const reopened = curClosed.filter((r) => (r.reopen_count ?? 0) > 0).length;
    return {
      medResolve: median(times),
      p90Resolve: times.length >= 10 ? percentile(times, 90) : null,
      prevMedResolve: median(prevTimes),
      medFrt: median(frt),
      avgCsat: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      csatN: ratings.length,
      csatExcluded: csat.internalExcluded + csat.overriddenExcluded,
      reopened,
      closedN: curClosed.length,
    };
  }, [cur, curClosed, prevClosed, csatOverrides, csatFilters]);

  const activeStats = useMemo(() => {
    if (!closedByTicket) return null;
    const vals: number[] = [];
    let removed = 0;
    for (const r of curClosed) {
      const total = r.time_to_resolve_s;
      if (typeof total !== "number" || total <= 0) continue;
      const closedS = closedByTicket[r.intercom_conversation_id] ?? 0;
      removed += closedS;
      vals.push(Math.max(0, total - closedS));
    }
    return { med: median(vals), p90: vals.length >= 10 ? percentile(vals, 90) : null, removed, n: vals.length };
  }, [closedByTicket, curClosed]);

  const loadActiveClock = async () => {
    setActiveLoading(true);
    try {
      const ids = curClosed.map((r) => r.id);
      const out: Record<string, number> = {};
      const CHUNK = 40;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("intercom_tickets_v3")
          .select("intercom_conversation_id,raw_payload")
          .in("id", slice);
        if (error) throw error;
        for (const r of data ?? []) {
          try {
            const a = computeAnatomy((r as any).raw_payload);
            out[(r as any).intercom_conversation_id] = a.closedS ?? 0;
          } catch {
            /* a payload we can't walk contributes no closed time */
          }
        }
      }
      setClosedByTicket(out);
      toast.success("Active clock computed from payload timelines");
    } catch (e: any) {
      toast.error(`Active clock failed: ${e?.message ?? e}`);
    } finally {
      setActiveLoading(false);
    }
  };

  const shippedByArea = useMemo(() => {
    const m = new Map<string, ChangelogRow[]>();
    for (const c of changelog) {
      const k = c.area || "General";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [changelog]);

  const escStats = useMemo(() => {
    const s = monthStart.getTime();
    const e = monthEnd.getTime();
    const opened = escalations.filter((x) => {
      const t = new Date(x.created_at).getTime();
      return t >= s && t <= e;
    }).length;
    const closed = escalations.filter((x) => {
      if (x.hub_state !== "closed" || !x.state_changed_at) return false;
      const t = new Date(x.state_changed_at).getTime();
      return t >= s && t <= e;
    }).length;
    const openAtEnd = escalations.filter((x) => {
      const t = new Date(x.created_at).getTime();
      if (t > e) return false;
      const ct = x.hub_state === "closed" && x.state_changed_at ? new Date(x.state_changed_at).getTime() : null;
      return ct == null || ct > e;
    }).length;
    return { opened, closed, openAtEnd };
  }, [escalations, monthStart, monthEnd]);

  const saveNote = async (section: SectionKey, text: string) => {
    setNotes((n) => ({ ...n, [section]: text }));
    const { data: sess } = await supabase.auth.getUser();
    const { error } = await supabase.from("esh_lookback_notes").upsert(
      {
        month,
        section_key: section,
        note_text: text,
        updated_by: sess.user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "month,section_key" },
    );
    if (error) toast.error(`Note not saved: ${error.message}`);
  };

  const areaSort = useTableSort(areaMix, {
    name: (r) => r.name,
    cur: (r) => r.cur,
    prev: (r) => r.prev,
    delta: (r) => r.cur - r.prev,
    share: (r) => r.share,
  });
  const typeSort = useTableSort(typeMix, {
    name: (r) => r.name,
    cur: (r) => r.cur,
    prev: (r) => r.prev,
    delta: (r) => r.cur - r.prev,
    share: (r) => r.share,
  });
  const acctSort = useTableSort(accountRows.slice(0, 15), {
    label: (r) => r.label,
    cur: (r) => r.cur,
    prev: (r) => r.prev,
    delta: (r) => r.cur - r.prev,
  });

  const chartData = useMemo(
    () => areaMix.filter((m) => m.name !== UNSET).slice(0, 10).map((m) => ({ area: m.name, [monthLabel]: m.cur, [prevLabel]: m.prev })),
    [areaMix, monthLabel, prevLabel],
  );

  const narrative = useMemo(() => {
    const L: string[] = [];
    L.push(`# ${PLAN_LABEL[planScope]} support lookback — ${monthLabel}`);
    L.push("");
    L.push(`_Plan scope: ${planScopeNote(planScope)}._`);
    L.push("");
    L.push(`**Volume.** ${curAll.length} tickets created (${cur.length} in the reporting population after exclusions), vs ${prevAll.length} in ${prevLabel} — ${deltaLabel(curAll.length, prevAll.length)}. ${curClosed.length} closed, ${stillOpen.length} still open at time of writing.`);
    if (notes.headline) L.push("", notes.headline);
    L.push("", "## Theme trends", "");
    L.push(`Themes are set at closure, so the mix below is over the ${curClosed.length} closed tickets (${prevLabel}: ${prevClosed.length}).`, "");
    for (const m of areaMix.slice(0, 8)) {
      L.push(`- ${m.name}: ${m.cur} (${m.share.toFixed(0)}% of month, ${prevLabel} ${m.prev}, ${deltaLabel(m.cur, m.prev)})`);
    }
    L.push("", "Ticket types: " + typeMix.slice(0, 8).map((m) => `${m.name} ${m.cur}`).join(", ") + ".");
    if (notes.themes) L.push("", notes.themes);
    L.push("", "## Spikes", "");
    if (!spikes.length) L.push("- No product area moved more than 3 points of share vs the prior month.");
    for (const s of spikes.slice(0, 6)) {
      L.push(`- ${s.name}: ${s.share.toFixed(0)}% of month vs ${s.prevShare.toFixed(0)}% in ${prevLabel} (${s.shareDelta > 0 ? "+" : "−"}${Math.abs(s.shareDelta).toFixed(0)} pts)${s.isNew ? " — new this month" : ""}`);
    }
    if (notes.spikes) L.push("", notes.spikes);
    L.push("", "## Customer picture", "");
    L.push(`- ${concentration.accounts} distinct accounts raised tickets; the top 5 drove ${concentration.top5} of ${cur.length} (${pct(concentration.top5, cur.length)}), the top 10 ${pct(concentration.top10, cur.length)}.`);
    L.push(`- Plan mix: ${planMix.map(([k, v]) => `${k} ${v}`).join(", ")}.`);
    for (const a of accountRows.slice(0, 8)) L.push(`- ${a.label}: ${a.cur} (${prevLabel} ${a.prev})`);
    L.push("- Customer size and lifecycle stage are not tracked in the account registry, so no claim is made about them.");
    if (notes.customers) L.push("", notes.customers);
    L.push("", "## Quality", "");
    L.push(`- Median time to resolve ${formatDuration(quality.medResolve)}${quality.p90Resolve ? ` · P90 ${formatDuration(quality.p90Resolve)}` : ""} (${prevLabel} median ${formatDuration(quality.prevMedResolve)}).`);
    if (activeStats) L.push(`- Active clock (closed time removed): median ${formatDuration(activeStats.med)}${activeStats.p90 ? ` · P90 ${formatDuration(activeStats.p90)}` : ""}.`);
    L.push(`- Median time to first reply ${formatDuration(quality.medFrt)}.`);
    L.push(`- CSAT ${quality.avgCsat == null ? "—" : quality.avgCsat.toFixed(2)} (n=${quality.csatN}${quality.csatExcluded ? `, ${quality.csatExcluded} excluded as internal or overridden` : ""}).`);
    L.push(`- ${quality.reopened} of ${quality.closedN} closed tickets were reopened at least once (${pct(quality.reopened, quality.closedN)}).`);
    if (notes.quality) L.push("", notes.quality);
    L.push("", "## Shipped and process", "");
    L.push(`- ${changelog.length} changelog entries recorded this month.`);
    for (const [area, items] of shippedByArea.slice(0, 8)) L.push(`- ${area}: ${items.length} — ${items.slice(0, 4).map((i) => i.title).join("; ")}`);
    L.push(`- Dev escalations: ${escStats.opened} opened, ${escStats.closed} closed, ${escStats.openAtEnd} open at month end.`);
    L.push(`- Escalated to engineering: ${escToEng.cur} of ${escToEng.closedN} closed tickets (${pct(escToEng.cur, escToEng.closedN)}), ${prevLabel} ${escToEng.prev}${escToEng.unset ? ` · ${escToEng.unset} closed without the flag set` : ""}.`);
    if (notes.shipped) L.push("", notes.shipped);
    L.push("", "## Data quality", "");
    L.push(`- ${gapRows.length} of ${curClosed.length} closed tickets are missing at least one of severity, product area, ticket type or escalated to engineering (${pct(gapRows.length, curClosed.length)})${samGapCount ? `, excluding ${samGapCount} Sam-owned ticket${samGapCount === 1 ? "" : "s"} that never pass through the closure form` : ""}.`);

    L.push("", "## What to watch", "");
    L.push(notes.watch || "- (add commentary)");
    return L.join("\n");
  }, [
    monthLabel, prevLabel, curAll.length, prevAll.length, cur.length, curClosed, stillOpen.length,
    areaMix, typeMix, spikes, concentration, planMix, accountRows, quality, activeStats,
    changelog.length, shippedByArea, escStats, escToEng, gapRows.length, notes, planScope,

  ]);

  // Slack mrkdwn digest: short, copy/paste-ready. Same numbers as the narrative,
  // trimmed to the top 3 areas, types and accounts plus up to 5 shipped items.
  const slackPost = useMemo(() => {
    const L: string[] = [];
    const topAreas = areaMix.filter((m) => m.name !== UNSET).slice(0, 3);
    const topTypes = typeMix.filter((m) => m.name !== UNSET).slice(0, 3);
    const topAccounts = accountRows.filter((a) => a.key !== "unresolved").slice(0, 3);
    const shipped = [...changelog]
      .sort((a, b) => (b.entry_date || "").localeCompare(a.entry_date || ""))
      .slice(0, 5);
    const arrow = (c: number, p: number) => (c === p ? "→" : c > p ? "▲" : "▼");

    L.push(`*${monthLabel} enterprise support summary* — ${PLAN_LABEL[planScope]}`);
    L.push("");
    L.push("*Key metrics* (vs " + prevLabel + ")");
    L.push(`• Tickets created: *${curAll.length}* ${arrow(curAll.length, prevAll.length)} (${prevLabel} ${prevAll.length}, ${deltaLabel(curAll.length, prevAll.length)})`);
    L.push(`• Closed: *${curClosed.length}* · still open: ${stillOpen.length}`);
    L.push(`• Median resolve: *${formatDuration(quality.medResolve)}* ${arrow(quality.prevMedResolve ?? 0, quality.medResolve ?? 0)} (${prevLabel} ${formatDuration(quality.prevMedResolve)})`);
    L.push(`• Median first reply: *${formatDuration(quality.medFrt)}*`);
    L.push(`• CSAT: *${quality.avgCsat == null ? "—" : quality.avgCsat.toFixed(2)}* (n=${quality.csatN}) · reopened ${pct(quality.reopened, quality.closedN)}`);
    L.push("");
    L.push("*Top issue areas* (closed tickets)");
    if (!topAreas.length) L.push("• No categorised closed tickets this month.");
    for (const m of topAreas) L.push(`• ${m.name}: *${m.cur}* (${m.share.toFixed(0)}%, ${prevLabel} ${m.prev})`);
    L.push("");
    L.push("*Top ticket types*");
    if (!topTypes.length) L.push("• Not set on closed tickets this month.");
    for (const m of topTypes) L.push(`• ${m.name}: *${m.cur}* (${prevLabel} ${m.prev})`);
    L.push("");
    L.push("*Top customers*");
    if (!topAccounts.length) L.push("• No attributed accounts this month.");
    for (const a of topAccounts) L.push(`• ${a.label}: *${a.cur}* (${prevLabel} ${a.prev})`);
    L.push(`_${concentration.accounts} accounts total; top 5 drove ${pct(concentration.top5, cur.length)} of volume._`);
    L.push("");
    L.push("*What shipped*");
    if (!shipped.length) L.push("• No changelog entries this month.");
    for (const c of shipped) L.push(`• ${c.title}${c.area ? ` (${c.area})` : ""}`);
    if (changelog.length > shipped.length) L.push(`_+${changelog.length - shipped.length} more changelog entries._`);
    if (notes.watch) L.push("", "*What to watch*", notes.watch);
    return L.join("\n");
  }, [
    monthLabel, prevLabel, planScope, curAll.length, prevAll.length, curClosed.length, stillOpen.length,
    quality, areaMix, typeMix, accountRows, concentration, cur.length, changelog, notes.watch,
  ]);

  const copyNarrative = async () => {
    await navigator.clipboard.writeText(narrative);
    setCopied(true);
    toast.success("Lookback copied — paste into Slack or Notion");
    setTimeout(() => setCopied(false), 1800);
  };

  const copySlack = async () => {
    await navigator.clipboard.writeText(slackPost);
    setCopiedSlack(true);
    toast.success("Slack summary copied");
    setTimeout(() => setCopiedSlack(false), 1800);
  };


  const NoteBox = ({ section }: { section: SectionKey }) => (
    <Textarea
      value={notes[section] ?? ""}
      onChange={(e) => setNotes((n) => ({ ...n, [section]: e.target.value }))}
      onBlur={(e) => saveNote(section, e.target.value)}
      disabled={!canEdit}
      placeholder={canEdit ? "Commentary for this section — saved per month and included in the copy-out." : "Read-only"}
      className="mt-3 text-sm min-h-[70px]"
    />
  );

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Beaker className="h-3.5 w-3.5" /> Sandbox · v3
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">Monthly lookback</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Narrative month review: theme trends, customer cuts, spikes, and what shipped. Built from{" "}
              <code className="text-xs">intercom_tickets_v3</code> with the shared exclusion, CSAT and resolution
              engines, so it cannot drift from Analytics v3. Data floor: {CLEAN_DATA_START_LABEL}. Plan scope:{" "}
              <span className="font-medium text-foreground">{PLAN_LABEL[planScope]}</span> — every section below and the
              copy-out follow it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PlanScopeSelect value={planScope} onChange={setPlanScope} />
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <CsatFilterMenu filters={csatFilters} onChange={setCsatFilters} />
            <Button variant="outline" size="sm" onClick={copySlack} disabled={loading}>
              {copiedSlack ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />} Copy Slack summary
            </Button>
            <Button variant="outline" size="sm" onClick={copyNarrative} disabled={loading}>
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />} Copy as narrative
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive"><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading {monthLabel} and {prevLabel}…
          </div>
        )}

        {/* Headline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{monthLabel} headline</CardTitle>
            <CardDescription>
              Volume is every ticket created in the month. The reporting population removes transferred-out tickets and
              anything the shared SLA exclusion predicate marks as outside Enterprise support.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Tickets created", value: String(curAll.length), sub: `${prevLabel}: ${prevAll.length} · ${deltaLabel(curAll.length, prevAll.length)}` },
                { label: "Reporting population", value: String(cur.length), sub: `${curAll.length - cur.length} excluded` },
                { label: "Closed", value: String(curClosed.length), sub: `${pct(curClosed.length, cur.length)} of population` },
                { label: "Still open", value: String(stillOpen.length), sub: "no closure form yet" },
                { label: "Categorised (closed)", value: pct(curClosed.length - gapRows.length, curClosed.length), sub: `${gapRows.length} missing area or type` },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="text-2xl font-semibold mt-1">{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
                </div>
              ))}
            </div>
            <NoteBox section="headline" />
          </CardContent>
        </Card>

        {/* Theme trends */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Theme trends</CardTitle>
            <CardDescription>
              Product area and ticket type for {monthLabel} against {prevLabel}, over the {curClosed.length} closed
              tickets ({prevLabel}: {prevClosed.length}). Both fields are set at closure, so tickets still open carry no
              theme and are left out rather than counted as uncategorised.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="area" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey={prevLabel} fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey={monthLabel} fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-sm font-medium mb-2">Product area</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead sortKey="name" sort={areaSort.sort} onToggle={areaSort.toggle}>Area</SortableHead>
                      <SortableHead sortKey="cur" sort={areaSort.sort} onToggle={areaSort.toggle} className="text-left w-[90px]">{monthLabel.split(" ")[0]}</SortableHead>
                      <SortableHead sortKey="prev" sort={areaSort.sort} onToggle={areaSort.toggle} className="text-left w-[90px]">{prevLabel.split(" ")[0]}</SortableHead>
                      <SortableHead sortKey="delta" sort={areaSort.sort} onToggle={areaSort.toggle} className="text-left w-[110px]">Delta</SortableHead>
                      <SortableHead sortKey="share" sort={areaSort.sort} onToggle={areaSort.toggle} className="text-left w-[90px]">Share</SortableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {areaSort.sorted.map((m) => (
                      <TableRow key={m.name}>
                        <TableCell className="text-sm">
                          {m.name === UNSET ? <span className="text-muted-foreground">{UNSET}</span> : (
                            <Link className="hover:underline" to={`/inbox-v3?q=${encodeURIComponent(m.name)}`}>{m.name}</Link>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{m.cur}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.prev}</TableCell>
                        <TableCell className="text-sm">{deltaLabel(m.cur, m.prev)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.share.toFixed(0)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Ticket type</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead sortKey="name" sort={typeSort.sort} onToggle={typeSort.toggle}>Type</SortableHead>
                      <SortableHead sortKey="cur" sort={typeSort.sort} onToggle={typeSort.toggle} className="text-left w-[90px]">{monthLabel.split(" ")[0]}</SortableHead>
                      <SortableHead sortKey="prev" sort={typeSort.sort} onToggle={typeSort.toggle} className="text-left w-[90px]">{prevLabel.split(" ")[0]}</SortableHead>
                      <SortableHead sortKey="delta" sort={typeSort.sort} onToggle={typeSort.toggle} className="text-left w-[110px]">Delta</SortableHead>
                      <SortableHead sortKey="share" sort={typeSort.sort} onToggle={typeSort.toggle} className="text-left w-[90px]">Share</SortableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {typeSort.sorted.map((m) => (
                      <TableRow key={m.name}>
                        <TableCell className="text-sm">{m.name === UNSET ? <span className="text-muted-foreground">{UNSET}</span> : m.name}</TableCell>
                        <TableCell className="text-sm font-medium">{m.cur}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.prev}</TableCell>
                        <TableCell className="text-sm">{deltaLabel(m.cur, m.prev)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.share.toFixed(0)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <NoteBox section="themes" />
          </CardContent>
        </Card>

        {/* Spikes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Spikes</CardTitle>
            <CardDescription>
              Areas whose share of the month moved 3 points or more against {prevLabel}, plus areas new this month with
              3 or more tickets. Computed, not eyeballed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {spikes.length === 0 ? (
              <div className="text-sm text-muted-foreground">No area moved more than 3 points of share. The month's mix matches {prevLabel}.</div>
            ) : (
              <div className="space-y-2">
                {spikes.map((s) => (
                  <div key={s.name} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="text-sm">
                      <span className="font-medium">{s.name}</span>
                      {s.isNew && <Badge variant="secondary" className="ml-2">new this month</Badge>}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {s.cur} tickets ({s.share.toFixed(0)}% of month) vs {s.prev} ({s.prevShare.toFixed(0)}%) in {prevLabel}
                      </div>
                    </div>
                    <div className={`text-sm font-medium ${s.shareDelta > 0 ? "text-destructive" : "text-emerald-600"}`}>
                      {s.shareDelta > 0 ? "+" : "−"}{Math.abs(s.shareDelta).toFixed(0)} pts
                    </div>
                  </div>
                ))}
              </div>
            )}
            <NoteBox section="spikes" />
          </CardContent>
        </Card>

        {/* Customers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer picture</CardTitle>
            <CardDescription>
              Account, plan tier, and concentration. Customer size and lifecycle stage are not tracked in the registry,
              so this section makes no claim about them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Distinct accounts</div>
                <div className="text-2xl font-semibold mt-1">{concentration.accounts}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Top 5 accounts</div>
                <div className="text-2xl font-semibold mt-1">{pct(concentration.top5, cur.length)}</div>
                <div className="text-xs text-muted-foreground mt-1">{concentration.top5} of {cur.length} tickets</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Plan mix</div>
                <div className="text-sm mt-2 space-y-0.5">
                  {planMix.map(([k, v]) => <div key={k}>{k}: <span className="font-medium">{v}</span></div>)}
                </div>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead sortKey="label" sort={acctSort.sort} onToggle={acctSort.toggle}>Account</SortableHead>
                  <SortableHead sortKey="cur" sort={acctSort.sort} onToggle={acctSort.toggle} className="text-left w-[110px]">{monthLabel.split(" ")[0]}</SortableHead>
                  <SortableHead sortKey="prev" sort={acctSort.sort} onToggle={acctSort.toggle} className="text-left w-[110px]">{prevLabel.split(" ")[0]}</SortableHead>
                  <SortableHead sortKey="delta" sort={acctSort.sort} onToggle={acctSort.toggle} className="text-left w-[110px]">Delta</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {acctSort.sorted.map((a) => (
                  <TableRow key={a.key}>
                    <TableCell className="text-sm">{a.label}</TableCell>
                    <TableCell className="text-sm font-medium">{a.cur}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.prev}</TableCell>
                    <TableCell className="text-sm">{deltaLabel(a.cur, a.prev)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <NoteBox section="customers" />
          </CardContent>
        </Card>

        {/* Quality */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Quality</CardTitle>
                <CardDescription>
                  Resolution, first reply, reopens and CSAT over tickets created in {monthLabel}. CSAT applies the shared
                  integrity rules (internal raters and overrides removed).
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadActiveClock} disabled={activeLoading || !curClosed.length}>
                {activeLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Timer className="h-4 w-4 mr-2" />}
                Load active clock
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Median resolve", value: formatDuration(quality.medResolve), sub: `${prevLabel}: ${formatDuration(quality.prevMedResolve)}` },
                { label: "P90 resolve", value: formatDuration(quality.p90Resolve), sub: quality.p90Resolve == null ? "needs 10+ closed" : `${quality.closedN} closed` },
                { label: "Median first reply", value: formatDuration(quality.medFrt), sub: "time to first admin reply" },
                { label: "CSAT", value: quality.avgCsat == null ? "—" : quality.avgCsat.toFixed(2), sub: `n=${quality.csatN}${quality.csatExcluded ? ` · ${quality.csatExcluded} excluded` : ""}` },
                { label: "Reopened", value: `${quality.reopened}`, sub: `${pct(quality.reopened, quality.closedN)} of closed` },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="text-2xl font-semibold mt-1">{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
                </div>
              ))}
            </div>

            {activeStats && (
              <div className="mt-4 rounded-lg border p-3 text-sm">
                <div className="font-medium">Active clock — closed time removed</div>
                <div className="text-muted-foreground mt-1">
                  Median {formatDuration(activeStats.med)}
                  {activeStats.p90 ? ` · P90 ${formatDuration(activeStats.p90)}` : ""} over {activeStats.n} tickets.{" "}
                  {formatDuration(activeStats.removed)} of closed-then-reopened time removed in total, derived from the
                  payload timelines by the resolution-anatomy engine.
                </div>
              </div>
            )}
            <NoteBox section="quality" />
          </CardContent>
        </Card>

        {/* Shipped */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Shipped and process</CardTitle>
            <CardDescription>
              Pulled from the changelog and the dev escalation board rather than typed by hand.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-5">
              {[
                { label: "Changelog entries", value: String(changelog.length) },
                { label: "Escalations opened", value: String(escStats.opened) },
                { label: "Escalations closed", value: String(escStats.closed) },
                { label: "Open at month end", value: String(escStats.openAtEnd) },
                {
                  label: "Escalated to engineering",
                  value: `${escToEng.cur} / ${escToEng.closedN}`,
                  sub: `${pct(escToEng.cur, escToEng.closedN)} of closed · ${prevLabel} ${escToEng.prev}${escToEng.unset ? ` · ${escToEng.unset} unset` : ""}`,
                },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="text-2xl font-semibold mt-1">{s.value}</div>
                  {"sub" in s && s.sub ? <div className="text-[11px] text-muted-foreground mt-1">{s.sub}</div> : null}
                </div>

              ))}
            </div>
            <div className="space-y-3">
              {shippedByArea.map(([area, items]) => (
                <div key={area}>
                  <div className="text-sm font-medium">{area} <span className="text-muted-foreground font-normal">({items.length})</span></div>
                  <ul className="mt-1 space-y-0.5">
                    {items.map((i) => (
                      <li key={i.id} className="text-sm text-muted-foreground">
                        <span className="tabular-nums text-xs mr-2">{format(new Date(i.entry_date), "MMM d")}</span>
                        {i.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!changelog.length && <div className="text-sm text-muted-foreground">No changelog entries in {monthLabel}.</div>}
            </div>
            <NoteBox section="shipped" />
          </CardContent>
        </Card>

        {/* Categorisation worklist */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Closure-rule leaks</CardTitle>
            <CardDescription>
              Closed tickets from {monthLabel} missing any of the four Intercom attributes the Hub owns: severity,
              affected product area, ticket type, escalated to engineering. These are meant to be set at closure, so
              each of these closed through a path that skipped the form — clean these rather than caveating the month.
              Sam-owned tickets are excluded: the AI agent never sees the closure form
              {samGapCount ? `, and ${samGapCount} such ticket${samGapCount === 1 ? " is" : "s are"} filtered out this month` : ""}.
            </CardDescription>

          </CardHeader>
          <CardContent>
            {gapRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">Every closed ticket in {monthLabel} carries all four fields.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead className="w-[170px]">Intercom</TableHead>
                    <TableHead className="w-[260px]">Missing</TableHead>
                    <TableHead className="w-[140px]">Owner</TableHead>
                    <TableHead className="w-[150px]">Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gapRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{r.subject_override || r.subject || "—"}</TableCell>
                      <TableCell className="text-sm">
                        <a
                          className="inline-flex items-center gap-1 hover:underline text-muted-foreground"
                          href={intercomUrl(r.intercom_conversation_id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.intercom_conversation_id} <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell className="text-sm">{missingFields(r).join(" + ")}</TableCell>

                      <TableCell className="text-sm text-muted-foreground">{r.owner || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.finalized_at ? format(new Date(r.finalized_at), "MMM d, HH:mm") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Watch */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What to watch next month</CardTitle>
            <CardDescription>Your commentary; it travels with the numbers in the copy-out.</CardDescription>
          </CardHeader>
          <CardContent><NoteBox section="watch" /></CardContent>
        </Card>

        {/* Slack summary preview */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Slack summary</CardTitle>
                <CardDescription>
                  Short copy/paste post: key metrics with the change vs {prevLabel}, top 3 issue areas, ticket types and
                  customers, and up to 5 recent changelog items. Follows the plan scope and CSAT filters above.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={copySlack} disabled={loading}>
                {copiedSlack ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />} Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/40 rounded-md p-3 leading-relaxed">
              {slackPost}
            </pre>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
