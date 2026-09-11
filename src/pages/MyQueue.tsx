import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, RefreshCw, Info, ExternalLink, CalendarIcon, Check } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { IssueDetailSheet, IssueStat } from "@/components/issues/IssueDetailSheet";
import { TicketDetailContent } from "@/components/issues/TicketDetailContent";
import {
  idColumn,
  subjectColumn,
  contactColumn,
  customerColumn,
  ageColumn,
} from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";
import { useDashboardTeammates } from "@/hooks/useDashboardTeammates";
import { useCanEdit } from "@/hooks/useCanEdit";
import { displaySubject, SUBJECT_SELECT } from "@/lib/subjectDisplay";
import { normalizeOwner } from "@/lib/normalizeOwner";
import {
  type DevEscalation,
  CADENCE_CHIPS,
  cadenceLabel,
  defaultCadenceMs,
  hasWorkaround,
  isDevDone,
  linearUrl,
  needsChase,
  needsFixAck,
  nextFollowupMs,
} from "@/lib/devEscalation";

/**
 * My Queue — the personal operational flight deck.
 *
 * READ-ONLY over v3 reporting truth: it never writes a queue state anywhere.
 * Every bucket below is derived at render time from columns that already exist
 * on `intercom_tickets_v3`, so nothing here can move a reported number.
 *
 * "Who holds the ball" comes from Intercom's own conversation statistics
 * (`last_contact_reply_at` vs `last_admin_reply_at`) carried in `raw_payload`.
 * That is the same authorial signal the SLA engine classifies from the message
 * timeline, but read from the persisted summary so the queue needs no extra
 * Intercom fetch. Tickets whose payload carries no statistics are shown in a
 * separate "No activity data" bucket rather than guessed at.
 */

type Row = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  subject_ai: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner: string | null;
  customer_key: string | null;
  state: string | null;
  plan_tier: string | null;
  custom_attributes: Record<string, unknown> | null;
  intercom_created_at: string | null;
  intercom_updated_at: string | null;
  eng_wait_start_at: string | null;
  eng_wait_end_at: string | null;
  raw_payload: Record<string, any> | null;
};

type Bucket = "action" | "dev_resolved" | "dev_wait" | "eng" | "customer" | "stale" | "unknown";

const BUCKET_META: Record<Bucket, { label: string; blurb: string; pill: string; row?: string }> = {
  action: {
    label: "Action needed",
    blurb: "The customer spoke last — the ball is with us.",
    pill: "bg-destructive/15 text-destructive border-destructive/40",
    row: "bg-destructive/5 hover:bg-destructive/10",
  },
  dev_resolved: {
    label: "Dev resolved",
    blurb: "Engineering closed the Linear issue — verify the fix, tell the customer, then acknowledge.",
    pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
    row: "bg-emerald-500/5 hover:bg-emerald-500/10",
  },
  dev_wait: {
    label: "Waiting on dev",
    blurb: "A Linear issue is in flight. Chase engineering when the follow-up is due.",
    pill: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/40",
  },
  eng: {
    label: "Waiting on engineering",
    blurb: "An engineering wait clock is open on this ticket.",
    pill: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/40",
  },
  stale: {
    label: "Ready for follow-up",
    blurb: "We replied last and nothing has moved for 3+ days.",
    pill: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/50",
    row: "bg-amber-500/5 hover:bg-amber-500/10",
  },
  customer: {
    label: "Waiting on customer",
    blurb: "We replied last and the ticket is still fresh.",
    pill: "bg-muted text-muted-foreground border-border",
  },
  unknown: {
    label: "No activity data",
    blurb: "No Intercom statistics on this row yet — state cannot be derived.",
    pill: "bg-muted text-muted-foreground border-border",
  },
};

const BUCKET_ORDER: Bucket[] = [
  "action",
  "dev_resolved",
  "dev_wait",
  "eng",
  "stale",
  "customer",
  "unknown",
];

const STALE_MS = 3 * 86_400_000;
const ANY = "__any__";

/** Intercom stats timestamps are unix seconds. */
function statMs(row: Row, key: string): number | null {
  const raw = row.raw_payload?.statistics?.[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

function attr(row: Row, key: string): string | null {
  const v = row.custom_attributes?.[key as keyof typeof row.custom_attributes];
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

type QueueRow = Row & {
  bucket: Bucket;
  lastContactMs: number | null;
  lastAdminMs: number | null;
  /** Time since whichever side spoke last. Drives "how long has this sat". */
  waitingSinceMs: number | null;
  severity: string | null;
  productArea: string | null;
  ticketType: string | null;
  gaps: string[];
  /** Live dev escalation row, if this conversation has one. */
  esc: DevEscalation | null;
  /** True when the engineering chase for this escalation is overdue. */
  chaseDue: boolean;
};

function classify(row: Row, esc: DevEscalation | null): QueueRow {
  const lastContactMs = statMs(row, "last_contact_reply_at");
  const lastAdminMs = statMs(row, "last_admin_reply_at");
  const hasStats = !!row.raw_payload?.statistics;

  const engOpen = !!row.eng_wait_start_at && !row.eng_wait_end_at;
  const ballWithUs =
    lastContactMs !== null && (lastAdminMs === null || lastContactMs > lastAdminMs);

  // A dev escalation only steers the bucket while it is actually live: an
  // acknowledged fix hands the ticket straight back to the conversational rules,
  // and so does a recorded workaround — but only while engineering is still
  // working, so a shipped fix always resurfaces as "Dev resolved".
  const devLive =
    !!esc && (isDevDone(esc) ? needsFixAck(esc) : !hasWorkaround(esc));

  let bucket: Bucket;
  let waitingSinceMs: number | null;

  if (ballWithUs) {
    bucket = "action";
    waitingSinceMs = lastContactMs;
  } else if (devLive && esc) {
    bucket = isDevDone(esc) ? "dev_resolved" : "dev_wait";
    waitingSinceMs = new Date(
      esc.dev_followed_up_at ?? esc.created_at ?? row.intercom_updated_at ?? Date.now(),
    ).getTime();
  } else if (!hasStats) {
    bucket = "unknown";
    waitingSinceMs = row.intercom_updated_at ? new Date(row.intercom_updated_at).getTime() : null;
  } else if (engOpen) {
    bucket = "eng";
    waitingSinceMs = new Date(row.eng_wait_start_at as string).getTime();
  } else {
    waitingSinceMs = lastAdminMs ?? (row.intercom_updated_at ? new Date(row.intercom_updated_at).getTime() : null);
    const idle = waitingSinceMs !== null && Date.now() - waitingSinceMs >= STALE_MS;
    bucket = idle ? "stale" : "customer";
  }

  const severity = attr(row, "Severity");
  const productArea = attr(row, "Affected Product Area") ?? attr(row, "Product Area");
  const ticketType = attr(row, "Ticket type") ?? attr(row, "Type");

  const gaps: string[] = [];
  if (!severity) gaps.push("Severity");
  if (!productArea) gaps.push("Affected product area");
  if (!ticketType) gaps.push("Ticket type");

  return {
    ...row,
    bucket,
    lastContactMs,
    lastAdminMs,
    waitingSinceMs,
    severity,
    productArea,
    ticketType,
    gaps,
    esc,
    chaseDue: !!esc && needsChase(esc),
  };
}

function StatCard({
  label,
  value,
  hint,
  active,
  onClick,
  sub,
}: {
  label: string;
  value: number;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`rounded-md border p-3 text-left transition-colors ${
        active ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
      }`}
    >
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub ? <div className="text-[10px] text-amber-600 dark:text-amber-400">{sub}</div> : null}
    </button>
  );
}

export default function MyQueue() {
  const { owner: ownerParam } = useParams();
  const navigate = useNavigate();
  const { items: teammates } = useDashboardTeammates();
  const { accountLabel } = useCustomerLabels();
  const { canEdit } = useCanEdit();

  const [me, setMe] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [escalations, setEscalations] = useState<Map<string, DevEscalation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<Bucket | "all" | "gaps" | "chase">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingDev, setSavingDev] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Default owner: the signed-in teammate, matched on the local part of the
  // work email against the roster. Falls back to the URL param.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? "";
      setMyEmail(email || null);
      const local = email.split("@")[0] ?? "";
      const first = local.split(/[._-]/)[0] ?? "";
      setMe(first ? first.charAt(0).toUpperCase() + first.slice(1) : null);
    });
  }, []);

  const rosterNames = useMemo(() => teammates.map((t) => t.label), [teammates]);

  const activeOwner = useMemo(() => {
    if (ownerParam) {
      const match = rosterNames.find((n) => n.toLowerCase() === ownerParam.toLowerCase());
      return match ?? ownerParam.charAt(0).toUpperCase() + ownerParam.slice(1);
    }
    if (me && rosterNames.some((n) => n.toLowerCase() === me.toLowerCase())) return me;
    return me ?? "";
  }, [ownerParam, me, rosterNames]);

  /**
   * Live dev-escalation state for a set of conversations. Read-only over the
   * Linear mirror; only the Hub-owned follow-up fields are ever written back.
   */
  async function loadEscalations(ids: string[]) {
    if (!ids.length) {
      setEscalations(new Map());
      return;
    }
    const { data, error: err } = await supabase
      .from("dev_escalations")
      .select(
        "id,intercom_conversation_id,hub_state,linear_key,linear_title,linear_state,linear_state_type,linear_assignee,linear_url_override,created_at,dev_followed_up_at,dev_followed_up_by,dev_next_followup_at,dev_followup_source,dev_fix_ack_at,dev_fix_ack_by",
      )
      .in("intercom_conversation_id", ids);
    if (err) {
      setError(err.message);
      return;
    }
    const map = new Map<string, DevEscalation>();
    for (const e of (data ?? []) as unknown as DevEscalation[]) {
      map.set(e.intercom_conversation_id, e);
    }
    setEscalations(map);
  }

  useEffect(() => {
    if (!activeOwner) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from("intercom_tickets_v3")
      .select(
        `id,intercom_conversation_id,${SUBJECT_SELECT},contact_name,contact_email,owner,customer_key,state,plan_tier,custom_attributes,intercom_created_at,intercom_updated_at,eng_wait_start_at,eng_wait_end_at,raw_payload`,
      )
      .in("lifecycle_status", ["open", "reopened_after_finalize"])
      .or("is_test_ticket.is.null,is_test_ticket.eq.false")
      .order("intercom_updated_at", { ascending: false })
      .limit(500)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setRows([]);
          setLoading(false);
          return;
        }
        const mine = ((data ?? []) as unknown as Row[]).filter(
          (r) => (normalizeOwner(r.owner) ?? "").toLowerCase() === activeOwner.toLowerCase(),
        );
        setRows(mine);
        loadEscalations(mine.map((r) => r.intercom_conversation_id)).finally(() => {
          if (!cancelled) setLoading(false);
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeOwner, reloadKey]);

  const queue = useMemo(
    () => rows.map((r) => classify(r, escalations.get(r.intercom_conversation_id) ?? null)),
    [rows, escalations],
  );

  const selected = useMemo(
    () => queue.find((r) => r.id === selectedId) ?? null,
    [queue, selectedId],
  );

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      action: 0,
      dev_resolved: 0,
      dev_wait: 0,
      eng: 0,
      stale: 0,
      customer: 0,
      unknown: 0,
    };
    let gaps = 0;
    let chase = 0;
    for (const r of queue) {
      c[r.bucket] += 1;
      if (r.gaps.length) gaps += 1;
      if (r.bucket === "dev_wait" && r.chaseDue) chase += 1;
    }
    return { ...c, gaps, chase, total: queue.length };
  }, [queue]);

  /** Hub-owned write: chase stamp + next due date. Never touches Linear or Intercom. */
  async function markFollowedUp(esc: DevEscalation, overrideMs?: number | null, dueDate?: Date) {
    setSavingDev(true);
    const now = new Date();
    const due =
      dueDate ??
      new Date(now.getTime() + (overrideMs ?? defaultCadenceMs(esc)));
    const { error: err } = await supabase
      .from("dev_escalations")
      .update({
        dev_followed_up_at: now.toISOString(),
        dev_followed_up_by: myEmail,
        dev_next_followup_at: due.toISOString(),
        dev_followup_source: overrideMs || dueDate ? "manual" : "auto",
      })
      .eq("id", esc.id);
    setSavingDev(false);
    if (err) {
      toast.error(`Could not save the follow-up: ${err.message}`);
      return;
    }
    toast.success(`Follow-up logged — next chase ${format(due, "d MMM HH:mm")}`);
    await loadEscalations(rows.map((r) => r.intercom_conversation_id));
  }

  /** Human sign-off that a shipped/canceled fix has been handled with the customer. */
  async function setFixAck(esc: DevEscalation, ack: boolean) {
    setSavingDev(true);
    const { error: err } = await supabase
      .from("dev_escalations")
      .update({
        dev_fix_ack_at: ack ? new Date().toISOString() : null,
        dev_fix_ack_by: ack ? myEmail : null,
      })
      .eq("id", esc.id);
    setSavingDev(false);
    if (err) {
      toast.error(`Could not save the acknowledgement: ${err.message}`);
      return;
    }
    toast.success(ack ? "Dev fix acknowledged" : "Acknowledgement cleared");
    await loadEscalations(rows.map((r) => r.intercom_conversation_id));
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue
      .filter((r) => {
        if (bucketFilter === "gaps") return r.gaps.length > 0;
        if (bucketFilter === "chase") return r.bucket === "dev_wait" && r.chaseDue;
        if (bucketFilter !== "all" && r.bucket !== bucketFilter) return false;
        return true;
      })
      .filter((r) => {
        if (!q) return true;
        return (
          displaySubject(r).toLowerCase().includes(q) ||
          (r.contact_email ?? "").toLowerCase().includes(q) ||
          (r.contact_name ?? "").toLowerCase().includes(q) ||
          r.intercom_conversation_id.includes(q) ||
          (r.esc?.linear_key ?? "").toLowerCase().includes(q) ||
          accountLabel(r.customer_key).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ai = BUCKET_ORDER.indexOf(a.bucket);
        const bi = BUCKET_ORDER.indexOf(b.bucket);
        if (ai !== bi) return ai - bi;
        return (a.waitingSinceMs ?? Infinity) - (b.waitingSinceMs ?? Infinity);
      });
  }, [queue, search, bucketFilter, accountLabel]);

  const columns: IssueColumn<QueueRow>[] = [
    {
      key: "bucket",
      header: "State",
      width: "w-[170px]",
      sortValue: (r) => BUCKET_ORDER.indexOf(r.bucket),
      cell: (r) => (
        <div className="space-y-1">
          <Badge variant="outline" className={`text-[10px] ${BUCKET_META[r.bucket].pill}`}>
            {BUCKET_META[r.bucket].label}
          </Badge>
          {r.bucket === "dev_wait" && r.chaseDue ? (
            <div className="text-[10px] text-amber-600 dark:text-amber-400">Chase due</div>
          ) : null}
          {r.bucket === "dev_resolved" ? (
            <div className="text-[10px] text-muted-foreground">Verify &amp; close out</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "dev",
      header: "Dev escalation",
      width: "w-[180px]",
      cellClassName: "text-xs",
      sortValue: (r) => r.esc?.linear_key ?? null,
      cell: (r) => {
        const e = r.esc;
        if (!e || !e.linear_key) return <span className="text-muted-foreground">—</span>;
        const url = linearUrl(e);
        const due = nextFollowupMs(e);
        return (
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1 truncate">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(ev) => ev.stopPropagation()}
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {e.linear_key}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span>{e.linear_key}</span>
              )}
              {e.linear_state ? (
                <Badge variant="secondary" className="text-[10px]">
                  {e.linear_state}
                </Badge>
              ) : null}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {e.linear_assignee ?? "Unassigned"}
              {isDevDone(e)
                ? e.dev_fix_ack_at
                  ? " · acknowledged"
                  : " · needs sign-off"
                : due
                  ? ` · next chase ${format(new Date(due), "d MMM")}`
                  : ""}
            </div>
          </div>
        );
      },
    },
    {
      key: "waiting",
      header: "Waiting",
      width: "w-[110px]",
      headerTitle: "Time since whichever side spoke last",
      cellClassName: "text-xs tabular-nums",
      sortValue: (r) => (r.waitingSinceMs == null ? null : Date.now() - r.waitingSinceMs),
      cell: (r) =>
        r.waitingSinceMs == null ? (
          "—"
        ) : (
          <div>
            <div>{formatDistanceToNowStrict(new Date(r.waitingSinceMs))}</div>
            <div className="text-[10px] text-muted-foreground">
              {format(new Date(r.waitingSinceMs), "d MMM HH:mm")}
            </div>
          </div>
        ),
    },
    idColumn<QueueRow>((r) => r.intercom_conversation_id),
    subjectColumn<QueueRow>(
      (r) => displaySubject(r),
      (r) => (r.gaps.length ? `Missing: ${r.gaps.join(", ")}` : null),
      {
        conversationId: (r) => r.intercom_conversation_id,
        subjectRow: (r) => r,
        onSaved: () => setReloadKey((k) => k + 1),
      },
    ),
    contactColumn<QueueRow>(
      (r) => r.contact_name,
      (r) => r.contact_email,
    ),
    customerColumn<QueueRow>((r) => r.customer_key, accountLabel),
    {
      key: "severity",
      header: "Severity",
      width: "w-[100px]",
      cellClassName: "text-xs",
      sortValue: (r) => r.severity,
      cell: (r) =>
        r.severity ? (
          <Badge variant="secondary" className="text-[10px]">
            S{r.severity}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    ageColumn<QueueRow>((r) =>
      r.intercom_created_at ? new Date(r.intercom_created_at).getTime() : null,
    ),
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">My queue</h1>
            <p className="text-sm text-muted-foreground">
              Every open v3 ticket owned by {activeOwner || "you"}, grouped by who holds the ball.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={activeOwner}
              onValueChange={(v) => navigate(`/my-queue/${v.toLowerCase()}`)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Choose a teammate" />
              </SelectTrigger>
              <SelectContent>
                {(rosterNames.includes(activeOwner) || !activeOwner
                  ? rosterNames
                  : [activeOwner, ...rosterNames]
                ).map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Could not load the queue: {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard
            label="Open tickets"
            value={counts.total}
            active={bucketFilter === "all"}
            onClick={() => setBucketFilter("all")}
          />
          {BUCKET_ORDER.map((b) => (
            <StatCard
              key={b}
              label={BUCKET_META[b].label}
              hint={BUCKET_META[b].blurb}
              value={counts[b]}
              sub={b === "dev_wait" && counts.chase ? `${counts.chase} need a chase` : undefined}
              active={bucketFilter === b}
              onClick={() => setBucketFilter(b)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search subject, contact, customer, Linear key or Intercom ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-[380px]"
          />
          <Button
            variant={bucketFilter === "gaps" ? "default" : "outline"}
            size="sm"
            onClick={() => setBucketFilter(bucketFilter === "gaps" ? "all" : "gaps")}
          >
            Missing fields ({counts.gaps})
          </Button>
          <Button
            variant={bucketFilter === "chase" ? "default" : "outline"}
            size="sm"
            onClick={() => setBucketFilter(bucketFilter === "chase" ? "all" : "chase")}
          >
            Chase dev ({counts.chase})
          </Button>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-auto">
            <Info className="h-3 w-3" /> Read-only over v3 reporting data — only Hub follow-up notes
            are written, never Intercom or Linear.
          </span>
        </div>

        <IssueTable<QueueRow>
          rows={visible}
          columns={columns}
          getRowKey={(r) => r.id}
          loading={loading}
          emptyMessage={
            counts.total === 0
              ? `No open tickets are owned by ${activeOwner || "this teammate"}.`
              : "No tickets match this filter."
          }
          rowClassName={(r) => BUCKET_META[r.bucket].row}
          onRowClick={(r) => setSelectedId(r.id)}
        />

        <IssueDetailSheet
          open={!!selected}
          onOpenChange={(o) => !o && setSelectedId(null)}
          title={selected ? displaySubject(selected) : ""}
          conversationId={selected?.intercom_conversation_id ?? null}
          wide
          raw
        >
          {selected ? (
            <TicketDetailContent
              conversationId={selected.intercom_conversation_id}
              subjectRow={selected}
              rawPayload={selected.raw_payload}
              currentSeverity={selected.severity}
              currentOwner={selected.owner}
              currentProductArea={selected.productArea}
              currentTicketType={selected.ticketType}
              escalatedToEngineering={
                (selected.custom_attributes?.["Escalated to Engineering"] as string | undefined) ?? null
              }
              blurb={BUCKET_META[selected.bucket].blurb}
              onChanged={() => setReloadKey((k) => k + 1)}
              badges={
                <>
                  <Badge variant="outline" className={`text-[10px] ${BUCKET_META[selected.bucket].pill}`}>
                    {BUCKET_META[selected.bucket].label}
                  </Badge>
                  {selected.chaseDue ? (
                    <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40">
                      Chase due
                    </Badge>
                  ) : null}
                  {selected.gaps.length ? (
                    <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/40">
                      Missing: {selected.gaps.join(", ")}
                    </Badge>
                  ) : null}
                </>
              }
              stats={
                <>
                  <IssueStat label="Customer" value={accountLabel(selected.customer_key)} />
                  <IssueStat label="Contact" value={selected.contact_email} />
                  <IssueStat label="Plan" value={selected.plan_tier} />
                  <IssueStat
                    label="Customer last replied"
                    value={
                      selected.lastContactMs
                        ? format(new Date(selected.lastContactMs), "d MMM yyyy HH:mm")
                        : "—"
                    }
                  />
                  <IssueStat
                    label="We last replied"
                    value={
                      selected.lastAdminMs
                        ? format(new Date(selected.lastAdminMs), "d MMM yyyy HH:mm")
                        : "—"
                    }
                  />
                  <IssueStat
                    label="Opened"
                    value={
                      selected.intercom_created_at
                        ? format(new Date(selected.intercom_created_at), "d MMM yyyy")
                        : "—"
                    }
                  />
                </>
              }
              escalation={
                selected.esc ? (
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Engineering escalation</div>
                    {selected.esc.linear_state ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {selected.esc.linear_state}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>
                      {selected.esc.linear_key ? (
                        linearUrl(selected.esc) ? (
                          <a
                            href={linearUrl(selected.esc) as string}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {selected.esc.linear_key} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          selected.esc.linear_key
                        )
                      ) : (
                        "No Linear issue linked"
                      )}
                      {selected.esc.linear_assignee ? ` · ${selected.esc.linear_assignee}` : " · Unassigned"}
                    </div>
                    <div>Cadence: {cadenceLabel(selected.esc)}</div>
                    <div>
                      Last chase:{" "}
                      {selected.esc.dev_followed_up_at
                        ? `${format(new Date(selected.esc.dev_followed_up_at), "d MMM yyyy HH:mm")}${
                            selected.esc.dev_followed_up_by ? ` · ${selected.esc.dev_followed_up_by}` : ""
                          }`
                        : "Never"}
                    </div>
                    <div>
                      Next chase due:{" "}
                      {nextFollowupMs(selected.esc)
                        ? format(new Date(nextFollowupMs(selected.esc) as number), "d MMM yyyy HH:mm")
                        : "—"}
                      {selected.chaseDue ? " · overdue" : ""}
                    </div>
                  </div>

                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={savingDev}
                        onClick={() => markFollowedUp(selected.esc as DevEscalation)}
                      >
                        Mark followed up
                      </Button>
                      {CADENCE_CHIPS.map((c) => (
                        <Button
                          key={c.label}
                          size="sm"
                          variant="outline"
                          disabled={savingDev}
                          onClick={() => markFollowedUp(selected.esc as DevEscalation, c.ms)}
                        >
                          {c.label}
                        </Button>
                      ))}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline" disabled={savingDev}>
                            <CalendarIcon className="h-3.5 w-3.5 mr-1" /> Custom date
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            onSelect={(d) =>
                              d && markFollowedUp(selected.esc as DevEscalation, null, d)
                            }
                            className="p-3 pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Follow-up tracking is read-only for your role.
                    </div>
                  )}

                  {isDevDone(selected.esc) ? (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      <div className="text-xs text-muted-foreground">
                        {selected.esc.dev_fix_ack_at
                          ? `Fix acknowledged ${format(new Date(selected.esc.dev_fix_ack_at), "d MMM yyyy HH:mm")}${
                              selected.esc.dev_fix_ack_by ? ` · ${selected.esc.dev_fix_ack_by}` : ""
                            }`
                          : "Engineering closed this issue — verify the fix and tell the customer."}
                      </div>
                      {canEdit ? (
                        selected.esc.dev_fix_ack_at ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingDev}
                            onClick={() => setFixAck(selected.esc as DevEscalation, false)}
                          >
                            Undo
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={savingDev}
                            onClick={() => setFixAck(selected.esc as DevEscalation, true)}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" /> Acknowledge dev fix
                          </Button>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </div>
                ) : null
              }
            />
          ) : null}
        </IssueDetailSheet>
      </div>
    </AppLayout>
  );
}
