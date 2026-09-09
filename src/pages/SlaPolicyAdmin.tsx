import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Loader2, Plus, Save, ShieldOff, X } from "lucide-react";
import { formatDuration } from "@/lib/slaMetrics";

type DbClock = "business" | "wall";
type Metric = "first_response" | "resolution" | "cadence" | "triage";

type CellState = {
  /** value typed by the user, in `unit` */
  amount: string;
  unit: "seconds" | "minutes" | "hours";
  clock: DbClock;
  noTarget: boolean;
};

type BhState = {
  tz: string;
  workDays: number[];
  dayStartHour: string;
  dayEndHour: string;
  holidays: string[];
};

const SEVERITIES = [1, 2, 3, 4] as const;
const GRID_METRICS: { key: Exclude<Metric, "triage">; label: string }[] = [
  { key: "first_response", label: "First response time" },
  { key: "cadence", label: "Communication cadence" },
  { key: "resolution", label: "Resolution" },
];

// JS getUTCDay() numbering — matches DEFAULT_BUSINESS_HOURS.workDays (0 = Sun)
const WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 0, label: "Sun" },
];

const TIMEZONES = [
  "Europe/Berlin", "Europe/London", "Europe/Stockholm", "UTC",
  "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney",
];

const cellKey = (metric: string, severity: number | null) => `${metric}:${severity ?? "null"}`;

function secondsToCell(sec: number | null, clock: DbClock): CellState {
  if (sec == null) return { amount: "", unit: "minutes", clock, noTarget: true };
  if (sec % 3600 === 0) return { amount: String(sec / 3600), unit: "hours", clock, noTarget: false };
  if (sec % 60 === 0) return { amount: String(sec / 60), unit: "minutes", clock, noTarget: false };
  return { amount: String(sec), unit: "seconds", clock, noTarget: false };
}

function cellToSeconds(c: CellState): number | null {
  if (c.noTarget) return null;
  const n = Number(c.amount);
  if (!Number.isFinite(n)) return NaN;
  const mult = c.unit === "hours" ? 3600 : c.unit === "minutes" ? 60 : 1;
  return Math.round(n * mult);
}

const SlaPolicyAdmin = () => {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState<any | null>(null);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [bh, setBh] = useState<BhState | null>(null);
  const [newHoliday, setNewHoliday] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data: versions, error: vErr } = await supabase
      .from("sla_policy_versions" as any)
      .select("id,effective_from,status,business_hours,label,updated_at")
      .eq("status", "provisional")
      .order("effective_from", { ascending: false })
      .limit(1);
    if (vErr) {
      setLoadError(vErr.message);
      setLoading(false);
      return;
    }
    const v: any = (versions ?? [])[0];
    if (!v) {
      setLoadError("No provisional policy version found.");
      setLoading(false);
      return;
    }
    const { data: targets, error: tErr } = await supabase
      .from("sla_policy_targets" as any)
      .select("metric,severity,target_seconds,clock")
      .eq("version_id", v.id);
    if (tErr) {
      setLoadError(tErr.message);
      setLoading(false);
      return;
    }
    const next: Record<string, CellState> = {};
    for (const m of GRID_METRICS) {
      for (const sev of SEVERITIES) {
        const row: any = (targets ?? []).find(
          (t: any) => t.metric === m.key && Number(t.severity) === sev,
        );
        next[cellKey(m.key, sev)] = secondsToCell(
          row ? row.target_seconds : null,
          (row?.clock as DbClock) ?? "business",
        );
      }
    }
    const triage: any = (targets ?? []).find((t: any) => t.metric === "triage");
    next[cellKey("triage", null)] = secondsToCell(
      triage ? triage.target_seconds : null,
      (triage?.clock as DbClock) ?? "business",
    );

    const j = v.business_hours ?? {};
    setBh({
      tz: typeof j.tz === "string" ? j.tz : "Europe/Berlin",
      workDays: Array.isArray(j.work_days) ? j.work_days.map(Number) : [1, 2, 3, 4, 5],
      dayStartHour: String(j.day_start_hour ?? 9),
      dayEndHour: String(j.day_end_hour ?? 24),
      holidays: Array.isArray(j.holidays) ? j.holidays.map(String) : [],
    });
    setCells(next);
    setVersion(v);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setCell = (key: string, patch: Partial<CellState>) =>
    setCells((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const businessDayHours = useMemo(() => {
    if (!bh) return 0;
    return Number(bh.dayEndHour) - Number(bh.dayStartHour);
  }, [bh]);

  const validate = (): string[] => {
    const errs: string[] = [];
    const check = (label: string, key: string) => {
      const c = cells[key];
      if (!c) return;
      if (c.noTarget) return;
      if (c.amount.trim() === "") {
        errs.push(`${label}: enter a target or explicitly select “No target”.`);
        return;
      }
      const sec = cellToSeconds(c);
      if (sec == null || !Number.isFinite(sec) || sec <= 0) {
        errs.push(`${label}: target must be a positive number.`);
      }
    };
    for (const m of GRID_METRICS) {
      for (const sev of SEVERITIES) check(`${m.label} · Sev ${sev}`, cellKey(m.key, sev));
    }
    check("Triage", cellKey("triage", null));

    if (!bh) errs.push("Business hours not loaded.");
    else {
      const s = Number(bh.dayStartHour);
      const e = Number(bh.dayEndHour);
      if (!Number.isFinite(s) || s < 0 || s > 24) errs.push("Day start hour must be 0–24.");
      if (!Number.isFinite(e) || e < 0 || e > 24) errs.push("Day end hour must be 0–24.");
      if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
        errs.push("Day end hour must be greater than day start hour.");
      }
      if (bh.workDays.length === 0) errs.push("Select at least one working day.");
      if (!bh.tz.trim()) errs.push("Timezone is required.");
      for (const h of bh.holidays) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) errs.push(`Holiday “${h}” is not YYYY-MM-DD.`);
      }
    }
    return errs;
  };

  const save = async () => {
    if (!version || !bh) return;
    const errs = validate();
    if (errs.length) {
      toast.error(errs[0], { description: errs.length > 1 ? `+ ${errs.length - 1} more issue(s)` : undefined });
      return;
    }
    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id ?? null;

    const rows = GRID_METRICS.flatMap((m) =>
      SEVERITIES.map((sev) => ({
        version_id: version.id,
        metric: m.key,
        severity: sev,
        target_seconds: cellToSeconds(cells[cellKey(m.key, sev)]),
        clock: cells[cellKey(m.key, sev)].clock,
      })),
    );

    const { error: tErr } = await supabase
      .from("sla_policy_targets" as any)
      .upsert(rows as any, { onConflict: "version_id,metric,severity" });
    if (tErr) {
      toast.error("Saving targets failed: " + tErr.message);
      setSaving(false);
      return;
    }

    // Triage has severity NULL: Postgres treats NULLs as distinct in the
    // UNIQUE(version_id, metric, severity) constraint, so upsert would
    // duplicate. Match the row explicitly instead.
    const triageCell = cells[cellKey("triage", null)];
    const triagePayload = {
      version_id: version.id,
      metric: "triage",
      severity: null,
      target_seconds: cellToSeconds(triageCell),
      clock: triageCell.clock,
    };
    const { data: existingTriage } = await supabase
      .from("sla_policy_targets" as any)
      .select("id")
      .eq("version_id", version.id)
      .eq("metric", "triage")
      .is("severity", null)
      .maybeSingle();
    const triageRes = existingTriage
      ? await supabase
          .from("sla_policy_targets" as any)
          .update(triagePayload as any)
          .eq("id", (existingTriage as any).id)
      : await supabase.from("sla_policy_targets" as any).insert(triagePayload as any);
    if (triageRes.error) {
      toast.error("Saving triage target failed: " + triageRes.error.message);
      setSaving(false);
      return;
    }


    const { error: vErr } = await supabase
      .from("sla_policy_versions" as any)
      .update({
        business_hours: {
          tz: bh.tz,
          work_days: [...bh.workDays].sort((a, b) => a - b),
          day_start_hour: Number(bh.dayStartHour),
          day_end_hour: Number(bh.dayEndHour),
          holidays: bh.holidays,
        },
        updated_by: uid,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", version.id);
    if (vErr) {
      toast.error("Saving business hours failed: " + vErr.message);
      setSaving(false);
      return;
    }

    toast.success("Provisional policy saved — reporting re-scores on next load.");
    setSaving(false);
    await load();
  };

  const renderCell = (key: string, label: string) => {
    const c = cells[key];
    if (!c) return null;
    const sec = c.noTarget ? null : cellToSeconds(c);
    const invalid = !c.noTarget && (c.amount.trim() === "" || sec == null || !Number.isFinite(sec) || sec <= 0);
    return (
      <div className="space-y-1.5 min-w-[190px]">
        <div className="flex items-center gap-1.5">
          <Input
            aria-label={`${label} target`}
            className="h-8 w-20"
            value={c.amount}
            disabled={c.noTarget}
            inputMode="decimal"
            onChange={(e) => setCell(key, { amount: e.target.value })}
          />
          <Select value={c.unit} onValueChange={(v) => setCell(key, { unit: v as CellState["unit"] })}>
            <SelectTrigger className="h-8 w-[92px]" disabled={c.noTarget}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seconds">sec</SelectItem>
              <SelectItem value="minutes">min</SelectItem>
              <SelectItem value="hours">hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Select
            value={c.clock}
            onValueChange={(v) => setCell(key, { clock: v as DbClock })}
          >
            <SelectTrigger className="h-8 w-[124px]" disabled={c.noTarget}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="business">Business</SelectItem>
              <SelectItem value="wall">Wall-clock</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={c.noTarget}
              onCheckedChange={(v) => setCell(key, { noTarget: !!v })}
            />
            No target
          </label>
        </div>
        <div className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
          {c.noTarget
            ? "No target (stored as NULL)"
            : invalid
              ? "Enter a positive value"
              : `${formatDuration(sec as number)} ${c.clock === "wall" ? "wall-clock" : "business hours"}`}
        </div>
      </div>
    );
  };

  if (adminLoading || loading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading policy…
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="p-8 max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldOff className="h-4 w-4" /> Not authorized
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Editing the SLA policy requires the admin role. Ask an admin to grant access in
              Settings → Roles.
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (loadError || !version || !bh) {
    return (
      <AppLayout>
        <div className="p-8 max-w-xl text-sm text-destructive">
          Failed to load policy: {loadError ?? "unknown error"}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 md:p-8 space-y-6 max-w-6xl">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">SLA policy</h1>
            <Badge variant="outline">{version.status}</Badge>
            {version.label && <span className="text-sm text-muted-foreground">{version.label}</span>}
          </div>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <div>
              <strong>Provisional policy — edits re-score reporting immediately.</strong> This is
              the calibration surface: changes are saved in place on the single provisional version.
              Effective-dated “commit / go-live” versioning comes later.
              <div className="text-xs text-muted-foreground mt-1">
                Effective from {new Date(version.effective_from).toISOString().slice(0, 10)}
                {version.updated_at ? ` · last updated ${new Date(version.updated_at).toLocaleString()}` : ""}
              </div>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Targets by severity</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px] text-left">Severity</TableHead>
                  {GRID_METRICS.map((m) => (
                    <TableHead key={m.key} className="text-left">{m.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {SEVERITIES.map((sev) => (
                  <TableRow key={sev} className="align-top">
                    <TableCell className="font-medium">Sev {sev}</TableCell>
                    {GRID_METRICS.map((m) => (
                      <TableCell key={m.key}>
                        {renderCell(cellKey(m.key, sev), `${m.label} Sev ${sev}`)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow className="align-top">
                  <TableCell className="font-medium">Triage</TableCell>
                  <TableCell colSpan={GRID_METRICS.length}>
                    <div className="space-y-1">
                      {renderCell(cellKey("triage", null), "Triage")}
                      <p className="text-xs text-muted-foreground">
                        Global target — applies to all severities (severity stored as NULL).
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              “No target” stores NULL (not evaluable) — required today for Sev 4 resolution and
              Sev 3/4 cadence.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business hours</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Select value={bh.tz} onValueChange={(v) => setBh({ ...bh, tz: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(TIMEZONES.includes(bh.tz) ? TIMEZONES : [bh.tz, ...TIMEZONES]).map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Day start hour</Label>
                <Input
                  className="h-9"
                  inputMode="numeric"
                  value={bh.dayStartHour}
                  onChange={(e) => setBh({ ...bh, dayStartHour: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Day end hour</Label>
                <Input
                  className="h-9"
                  inputMode="numeric"
                  value={bh.dayEndHour}
                  onChange={(e) => setBh({ ...bh, dayEndHour: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Working days</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((d) => (
                  <label key={d.n} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox
                      checked={bh.workDays.includes(d.n)}
                      onCheckedChange={(v) =>
                        setBh({
                          ...bh,
                          workDays: v
                            ? [...bh.workDays, d.n]
                            : bh.workDays.filter((x) => x !== d.n),
                        })
                      }
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>

            <div
              className={`text-sm ${businessDayHours > 0 ? "text-muted-foreground" : "text-destructive"}`}
            >
              Implied business day: <strong>{businessDayHours}h</strong> ({bh.workDays.length} working
              day{bh.workDays.length === 1 ? "" : "s"} per week)
            </div>

            <div className="space-y-2">
              <Label>Holidays</Label>
              <div className="flex items-center gap-2">
                <Input
                  className="h-9 w-[170px]"
                  placeholder="YYYY-MM-DD"
                  value={newHoliday}
                  onChange={(e) => setNewHoliday(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const v = newHoliday.trim();
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                      toast.error("Holiday must be YYYY-MM-DD");
                      return;
                    }
                    if (bh.holidays.includes(v)) {
                      toast.error("Holiday already listed");
                      return;
                    }
                    setBh({ ...bh, holidays: [...bh.holidays, v].sort() });
                    setNewHoliday("");
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
              {bh.holidays.length === 0 ? (
                <p className="text-xs text-muted-foreground">No holidays configured.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {bh.holidays.map((h) => (
                    <Badge key={h} variant="secondary" className="gap-1">
                      {h}
                      <button
                        aria-label={`Remove ${h}`}
                        onClick={() => setBh({ ...bh, holidays: bh.holidays.filter((x) => x !== h) })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Note: the engine does not consume the holiday calendar yet — stored for the next batch.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save provisional policy
          </Button>
          <Button variant="outline" onClick={load} disabled={saving}>Discard changes</Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default SlaPolicyAdmin;
