import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Save, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { intercomUrl } from "@/lib/intercom";
import { SeverityShowdown, SeverityBacktest, OverrideReasonRollup } from "@/components/severity/SeverityTraining";

/**
 * Calibration surface for the severity classifier.
 *
 * It answers one question honestly: where does the AI disagree with us, and is
 * the rubric text or the model at fault? Nothing here writes to Intercom.
 */

type Proposal = {
  id: string;
  intercom_conversation_id: string;
  pass: string;
  proposed_severity: number;
  confidence: string;
  rationale: string;
  status: string;
  final_severity: number | null;
  rubric_version: number | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  decided_at: string | null;
};

type Rubric = { id: string; version: number; body: string; status: string; label: string | null };

const SEVS = [1, 2, 3, 4];

export default function SeverityAi() {
  const { isAdmin } = useIsAdmin();
  const [loading, setLoading] = useState(true);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Proposal[]>([]);
  const [days, setDays] = useState(30);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const [r, p] = await Promise.all([
      supabase.from("severity_rubric_versions").select("id, version, body, status, label").eq("status", "active").maybeSingle(),
      supabase.from("severity_proposals").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    ]);
    const rub = (r.data as Rubric | null) ?? null;
    setRubric(rub);
    setDraft(rub?.body ?? "");
    setRows(((p.data ?? []) as unknown) as Proposal[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const decided = useMemo(
    () => rows.filter((r) => (r.status === "accepted" || r.status === "overridden") && r.final_severity != null),
    [rows],
  );

  const agreement = decided.length
    ? Math.round((decided.filter((r) => r.proposed_severity === r.final_severity).length / decided.length) * 100)
    : null;

  const offBy = useMemo(() => {
    let one = 0, two = 0;
    for (const r of decided) {
      const d = Math.abs(r.proposed_severity - (r.final_severity as number));
      if (d === 1) one += 1;
      else if (d >= 2) two += 1;
    }
    return { one, two };
  }, [decided]);

  const matrix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of decided) m[`${r.proposed_severity}-${r.final_severity}`] = (m[`${r.proposed_severity}-${r.final_severity}`] ?? 0) + 1;
    return m;
  }, [decided]);

  const cost = useMemo(() => {
    const inTok = rows.reduce((a, r) => a + (r.input_tokens ?? 0), 0);
    const outTok = rows.reduce((a, r) => a + (r.output_tokens ?? 0), 0);
    return { calls: rows.length, inTok, outTok };
  }, [rows]);

  const disagreements = useMemo(
    () => decided.filter((r) => r.proposed_severity !== r.final_severity).slice(0, 50),
    [decided],
  );

  const saveRubric = async () => {
    if (!rubric || draft.trim() === "") return;
    setSaving(true);
    setSaveNote(null);
    const nextVersion = rubric.version + 1;
    const { data: userData } = await supabase.auth.getUser();
    // Retire first: the partial unique index allows exactly one active row.
    const retire = await supabase
      .from("severity_rubric_versions")
      .update({ status: "retired" })
      .eq("id", rubric.id);
    if (retire.error) {
      setSaveNote(`Save failed — ${retire.error.message}`);
      setSaving(false);
      return;
    }
    const ins = await supabase.from("severity_rubric_versions").insert({
      version: nextVersion,
      body: draft,
      status: "active",
      label: label || null,
      created_by: userData.user?.id ?? null,
    });
    if (ins.error) {
      // Put the old one back rather than leaving the Hub with no active rubric.
      await supabase.from("severity_rubric_versions").update({ status: "active" }).eq("id", rubric.id);
      setSaveNote(`Save failed — ${ins.error.message}`);
    } else {
      setSaveNote(`Saved as rubric v${nextVersion}. New proposals use it immediately.`);
      setLabel("");
      await load();
    }
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-2xl font-semibold">Severity AI</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Calibration for the severity classifier. The AI never writes to Intercom — every number here
            was either accepted or corrected by a person.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Window</span>
          {[7, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} className="h-7 text-xs" onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Stat label="Proposals" value={String(rows.length)} />
          <Stat label="Human-decided" value={String(decided.length)} />
          <Stat label="Agreement" value={agreement == null ? "—" : `${agreement}%`} />
          <Stat label="Off by 1 / 2+" value={`${offBy.one} / ${offBy.two}`} />
        </div>

        <SeverityShowdown />

        <OverrideReasonRollup />

        <SeverityBacktest rubricBody={draft || rubric?.body || ""} />

        <div className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium mb-3">Proposed vs final</h2>
          {decided.length === 0 ? (
            <p className="text-xs text-muted-foreground">No human decisions in this window yet.</p>
          ) : (
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="p-2 text-left text-muted-foreground font-normal">AI \ final</th>
                  {SEVS.map((s) => <th key={s} className="p-2 w-14 text-muted-foreground font-normal">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {SEVS.map((p) => (
                  <tr key={p}>
                    <td className="p-2 text-muted-foreground">Severity {p}</td>
                    {SEVS.map((f) => {
                      const n = matrix[`${p}-${f}`] ?? 0;
                      return (
                        <td
                          key={f}
                          className={`p-2 text-center rounded ${n === 0 ? "text-muted-foreground" : p === f ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium" : "bg-destructive/10 text-destructive font-medium"}`}
                        >
                          {n}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium mb-3">Disagreements ({disagreements.length})</h2>
          {disagreements.length === 0 ? (
            <p className="text-xs text-muted-foreground">None in this window.</p>
          ) : (
            <div className="space-y-2">
              {disagreements.map((d) => (
                <div key={d.id} className="text-xs border-b border-border pb-2 last:border-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={intercomUrl(d.intercom_conversation_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono hover:underline inline-flex items-center gap-1"
                    >
                      {d.intercom_conversation_id} <ExternalLink className="h-3 w-3" />
                    </a>
                    <Badge variant="outline" className="text-[10px]">AI {d.proposed_severity} → team {d.final_severity}</Badge>
                    <span className="text-muted-foreground">{d.confidence} · {d.pass} · rubric v{d.rubric_version ?? "?"}</span>
                    <span className="text-muted-foreground">
                      {d.decided_at ? format(new Date(d.decided_at), "PP") : ""}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1">{d.rationale}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium mb-2">Cost</h2>
          <p className="text-xs text-muted-foreground">
            {cost.calls} proposals stored · {cost.inTok.toLocaleString()} input tokens ·{" "}
            {cost.outTok.toLocaleString()} output tokens over {days} days. Unchanged tickets are skipped without a
            model call, so stored rows are an upper bound on calls.
          </p>
        </div>

        <div className="rounded-md border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Rubric {rubric ? `v${rubric.version}` : ""}{" "}
              {rubric?.label ? <span className="text-xs text-muted-foreground">· {rubric.label}</span> : null}
            </h2>
            {!isAdmin && <span className="text-xs text-muted-foreground">Admin role required to edit</span>}
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!isAdmin}
            className="min-h-[280px] font-mono text-xs"
          />
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Change note (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9 w-[320px] text-xs"
              />
              <Button size="sm" disabled={saving || draft === rubric?.body} onClick={saveRubric}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save as new version</>}
              </Button>
              {saveNote && <span className="text-xs text-muted-foreground">{saveNote}</span>}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Saving retires the current version and activates a new one. Past proposals keep the version that produced them.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
