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
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BellOff, BellRing, Loader2, Plus, Trash2 } from "lucide-react";
import {
  coveringSlackIds,
  shiftsCovering,
  zonedParts,
  type FloatShift,
} from "@/lib/floatCoverage";

type ShiftRow = FloatShift & {
  id: string;
  note: string | null;
  active: boolean;
};

type Teammate = { name: string; slack_user_id: string | null; active: boolean };

const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Stockholm",
  "UTC",
  "Asia/Singapore",
  "Australia/Sydney",
];

const emptyDraft = () => ({
  slack_user_id: "",
  display_name: "",
  starts_on: new Date().toISOString().slice(0, 10),
  ends_on: new Date().toISOString().slice(0, 10),
  start_time: "12:00",
  end_time: "17:00",
  time_zone: "America/Los_Angeles",
  note: "",
});

const shortTz = (tz: string) => tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
const hhmm = (t: string) => t.slice(0, 5);

/** "Aug 1 – Aug 15" style range, rendered without timezone drift. */
function formatRange(startsOn: string, endsOn: string) {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

export default function FloatCoverage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [alwaysOn, setAlwaysOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  // Ticks every 30s so "on call right now" stays honest without a refresh.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [shiftRes, teamRes, settingsRes] = await Promise.all([
      supabase
        .from("float_coverage_shifts")
        .select("*")
        .order("starts_on", { ascending: true })
        .order("start_time", { ascending: true }),
      supabase
        .from("teammates")
        .select("name, slack_user_id, active, role")
        .eq("active", true)
        .eq("role", "support")
        .order("name"),
      supabase.from("settings").select("new_ticket_alert_mentions").limit(1).maybeSingle(),
    ]);
    if (shiftRes.error) toast.error(`Could not load shifts: ${shiftRes.error.message}`);
    setShifts((shiftRes.data ?? []) as ShiftRow[]);
    setTeammates((teamRes.data ?? []) as Teammate[]);
    setAlwaysOn(String(settingsRes.data?.new_ticket_alert_mentions ?? ""));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCallNow = useMemo(() => shiftsCovering(shifts, now), [shifts, now]);
  const alwaysOnIds = useMemo(
    () => alwaysOn.split(/[,\s]+/).filter(Boolean),
    [alwaysOn],
  );
  const pingedNow = useMemo(
    () => Array.from(new Set([...coveringSlackIds(shifts, now), ...alwaysOnIds])),
    [shifts, now, alwaysOnIds],
  );

  const nameFor = useCallback(
    (slackId: string) =>
      shifts.find((s) => s.slack_user_id === slackId)?.display_name ??
      teammates.find((t) => t.slack_user_id === slackId)?.name ??
      slackId,
    [shifts, teammates],
  );

  const addShift = async () => {
    if (!draft.slack_user_id.trim() || !draft.display_name.trim()) {
      toast.error("Pick a teammate, or enter a name and Slack user ID.");
      return;
    }
    if (draft.ends_on < draft.starts_on) {
      toast.error("End date is before the start date.");
      return;
    }
    if (draft.start_time === draft.end_time) {
      toast.error("Start and end time are the same — that covers nothing.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("float_coverage_shifts").insert({
      slack_user_id: draft.slack_user_id.trim(),
      display_name: draft.display_name.trim(),
      starts_on: draft.starts_on,
      ends_on: draft.ends_on,
      start_time: draft.start_time,
      end_time: draft.end_time,
      time_zone: draft.time_zone,
      note: draft.note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(`Could not add shift: ${error.message}`);
      return;
    }
    toast.success("Shift added");
    setDraft({ ...emptyDraft(), time_zone: draft.time_zone });
    void load();
  };

  const toggleActive = async (row: ShiftRow, next: boolean) => {
    const prev = shifts;
    setShifts((s) => s.map((r) => (r.id === row.id ? { ...r, active: next } : r)));
    const { error } = await supabase
      .from("float_coverage_shifts")
      .update({ active: next })
      .eq("id", row.id);
    if (error) {
      setShifts(prev);
      toast.error(`Could not update shift: ${error.message}`);
    }
  };

  const removeShift = async (row: ShiftRow) => {
    const { error } = await supabase.from("float_coverage_shifts").delete().eq("id", row.id);
    if (error) {
      toast.error(`Could not delete shift: ${error.message}`);
      return;
    }
    toast.success("Shift removed");
    void load();
  };

  const localNowLabel = (tz: string) => {
    const p = zonedParts(now, tz);
    const h = String(Math.floor(p.minutes / 60)).padStart(2, "0");
    const m = String(p.minutes % 60).padStart(2, "0");
    return `${h}:${m} ${shortTz(tz)}`;
  };

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Float coverage</h1>
          <p className="text-sm text-muted-foreground">
            Who gets @-mentioned on a new Enterprise Inbox ticket in{" "}
            <span className="font-mono">#enterprise-support-tickets</span>. Outside every shift the
            alert still posts — it just doesn't ping anyone.
          </p>
        </div>

        {/* Live status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {pingedNow.length > 0 ? (
                <BellRing className="h-4 w-4 text-primary" />
              ) : (
                <BellOff className="h-4 w-4 text-muted-foreground" />
              )}
              On call right now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : pingedNow.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody. A ticket arriving now posts to Slack with no mention.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {pingedNow.map((id) => {
                  const scheduled = onCallNow.some((s) => s.slack_user_id === id);
                  return (
                    <Badge key={id} variant={scheduled ? "default" : "secondary"}>
                      {nameFor(id)}
                      {!scheduled && " · always-on"}
                    </Badge>
                  );
                })}
              </div>
            )}
            {onCallNow.length > 0 && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {onCallNow.map((s) => (
                  <div key={s.id}>
                    {s.display_name}: {hhmm(s.start_time)}–{hhmm(s.end_time)} {shortTz(s.time_zone)} ·
                    now {localNowLabel(s.time_zone)}
                  </div>
                ))}
              </div>
            )}
            {alwaysOnIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Always-on list ({alwaysOnIds.length}) is pinged regardless of the schedule — edit it
                under Admin → Settings → New-ticket alert mentions.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Add shift */}
        {isAdmin && !adminLoading && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add a shift</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-1.5 xl:col-span-2">
                  <Label>Teammate</Label>
                  <Select
                    value={draft.slack_user_id || undefined}
                    onValueChange={(v) => {
                      const t = teammates.find((x) => x.slack_user_id === v);
                      setDraft((d) => ({
                        ...d,
                        slack_user_id: v,
                        display_name: t?.name ?? d.display_name,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a teammate" />
                    </SelectTrigger>
                    <SelectContent>
                      {teammates
                        .filter((t) => t.slack_user_id)
                        .map((t) => (
                          <SelectItem key={t.slack_user_id!} value={t.slack_user_id!}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Only teammates with a Slack user ID appear — add one under Admin → Settings →
                    Teammates.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Start date</Label>
                  <Input
                    type="date"
                    value={draft.starts_on}
                    onChange={(e) => setDraft((d) => ({ ...d, starts_on: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End date</Label>
                  <Input
                    type="date"
                    value={draft.ends_on}
                    onChange={(e) => setDraft((d) => ({ ...d, ends_on: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>From</Label>
                  <Input
                    type="time"
                    value={draft.start_time}
                    onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>To</Label>
                  <Input
                    type="time"
                    value={draft.end_time}
                    onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5 xl:col-span-2">
                  <Label>Timezone</Label>
                  <Select
                    value={draft.time_zone}
                    onValueChange={(v) => setDraft((d) => ({ ...d, time_zone: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 xl:col-span-3">
                  <Label>Note (optional)</Label>
                  <Input
                    value={draft.note}
                    placeholder="e.g. west coast float"
                    onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={addShift} disabled={saving} className="w-full">
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Add shift
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Dates are inclusive and times are local to the chosen timezone (DST-aware). An end
                time earlier than the start time means the shift runs past midnight. Overlaps are
                fine — everyone covering gets pinged. Weekends aren't skipped automatically; add
                separate rows for weekdays only.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Schedule */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No shifts yet. New-ticket alerts post without a mention.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px] text-left">Person</TableHead>
                    <TableHead className="w-[180px] text-left">Dates</TableHead>
                    <TableHead className="w-[140px] text-left">Hours</TableHead>
                    <TableHead className="w-[180px] text-left">Timezone</TableHead>
                    <TableHead className="w-[120px] text-left">Status</TableHead>
                    <TableHead className="text-left">Note</TableHead>
                    <TableHead className="w-[100px] text-left">Active</TableHead>
                    {isAdmin && <TableHead className="w-[60px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shifts.map((row) => {
                    const live = onCallNow.some((s) => s.id === row.id);
                    return (
                      <TableRow key={row.id} className={live ? "bg-muted/40" : undefined}>
                        <TableCell className="font-medium">{row.display_name}</TableCell>
                        <TableCell>{formatRange(row.starts_on, row.ends_on)}</TableCell>
                        <TableCell>
                          {hhmm(row.start_time)}–{hhmm(row.end_time)}
                          {row.end_time < row.start_time && (
                            <span className="ml-1 text-xs text-muted-foreground">+1d</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.time_zone}</TableCell>
                        <TableCell>
                          {live ? (
                            <Badge>On call</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.note ?? ""}</TableCell>
                        <TableCell>
                          <Switch
                            checked={row.active}
                            disabled={!isAdmin}
                            onCheckedChange={(v) => toggleActive(row, v)}
                          />
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeShift(row)}
                              aria-label={`Remove ${row.display_name} shift`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
