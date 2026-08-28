import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSlaBatch, type SlaBatchEnriched } from "@/hooks/useSlaBatch";
import {
  businessHoursBetween,
  evaluateCompliance,
  formatDuration,
  parseSeverity,
  type SlaResult,
  type TimelinePart,
} from "@/lib/slaMetrics";
import { displaySubject } from "@/lib/subjectDisplay";

/**
 * READ-ONLY verification surface for the proposed FRT "demand gate".
 *
 * NOTHING here changes the engine. It recomputes, side by side:
 *   current  = FRT measured from slaClockStartS (Enterprise Inbox anchor)
 *   proposed = FRT measured from frDemandS = first CUSTOMER-side part at/after
 *              the anchor (null when the thread never has one)
 * The anchor itself is untouched in both columns.
 */

const isCustomerSide = (p: TimelinePart) => p.actor === "customer" || p.actor === "shared_inbox";

function firstDemandTs(sla: SlaResult): number | null {
  const anchor = sla.slaClockStartS;
  if (anchor == null) return null;
  // If customer demand already exists when the ticket enters the inbox, the
  // anchor IS the demand point — identical to today's engine.
  if (sla.timeline.some((t) => isCustomerSide(t) && t.ts <= anchor)) return anchor;
  // Otherwise (support-initiated thread) wait for the first customer inbound.
  const p = sla.timeline.find((t) => isCustomerSide(t) && t.ts > anchor);
  return p ? p.ts : null;
}

// The reply that ANSWERS the demand: first public support reply at/after the
// demand point. An earlier outbound (the message that opened an agent-initiated
// thread) answered nothing and must not count as a 0s first response.
function responseTsFor(sla: SlaResult, demandS: number | null): number | null {
  if (demandS == null) return null;
  const p = sla.timeline.find(
    (t) => t.isPublicReply && (t.actor === "human_admin" || t.actor === "sam_ai") && t.ts >= demandS,
  );
  return p ? p.ts : null;
}


type DiffRow = {
  row: SlaBatchEnriched;
  severity: ReturnType<typeof parseSeverity>;
  demandS: number | null;
  currentBhS: number | null;
  currentCalS: number | null;
  proposedBhS: number | null;
  proposedCalS: number | null;
  currentMet: boolean | null;
  proposedMet: boolean | null;
  changed: boolean;
  flip: "none" | "breach_to_met" | "met_to_breach" | "to_unevaluable" | "to_evaluable";
};

export default function SlaFrtDiff() {
  const batch = useSlaBatch();
  const [showAllChanged, setShowAllChanged] = useState(false);

  const rows = useMemo<DiffRow[]>(() => {
    return batch.inScope.map((r) => {
      const sla = r.sla;
      const bh = r.policy.businessHours;
      const severity = parseSeverity(r.raw_payload?.custom_attributes?.["Severity"]);
      const demandS = firstDemandTs(sla);
      const supportTs = responseTsFor(sla, demandS);

      const currentCalS = sla.firstSupportReplyFromInboxS;
      const currentBhS = sla.firstSupportReplyFromInboxBusinessHoursS;

      let proposedCalS: number | null = null;
      let proposedBhS: number | null = null;
      if (demandS != null && supportTs != null) {
        proposedCalS = Math.max(0, supportTs - demandS);
        proposedBhS = businessHoursBetween(demandS, supportTs, bh);
      }

      let currentMet: boolean | null = null;
      let proposedMet: boolean | null = null;
      if (severity) {
        currentMet = evaluateCompliance(sla, severity, r.policy.targets).firstResponse.met;
        const shadow: SlaResult = {
          ...sla,
          firstSupportReplyFromInboxS: proposedCalS,
          firstSupportReplyFromInboxBusinessHoursS: proposedBhS,
        };
        proposedMet = evaluateCompliance(shadow, severity, r.policy.targets).firstResponse.met;
      }

      const changed = currentBhS !== proposedBhS || currentCalS !== proposedCalS;
      let flip: DiffRow["flip"] = "none";
      if (currentMet !== proposedMet) {
        if (currentMet === false && proposedMet === true) flip = "breach_to_met";
        else if (currentMet === true && proposedMet === false) flip = "met_to_breach";
        else if (proposedMet === null) flip = "to_unevaluable";
        else if (currentMet === null) flip = "to_evaluable";
      }

      return {
        row: r,
        severity,
        demandS,
        currentBhS,
        currentCalS,
        proposedBhS,
        proposedCalS,
        currentMet,
        proposedMet,
        changed,
        flip,
      };
    });
  }, [batch.inScope]);

  const summary = useMemo(() => {
    const customerOpened = rows.filter((r) => r.row.sla.initiatedBy === "customer");
    const agentOpened = rows.filter((r) => r.row.sla.initiatedBy === "agent");
    return {
      total: rows.length,
      customerOpened: customerOpened.length,
      agentOpened: agentOpened.length,
      customerOpenedChanged: customerOpened.filter((r) => r.changed).length,
      changed: rows.filter((r) => r.changed).length,
      flips: rows.filter((r) => r.flip !== "none").length,
      breachToMet: rows.filter((r) => r.flip === "breach_to_met").length,
      metToBreach: rows.filter((r) => r.flip === "met_to_breach").length,
      toUnevaluable: rows.filter((r) => r.flip === "to_unevaluable").length,
      toEvaluable: rows.filter((r) => r.flip === "to_evaluable").length,
      noDemand: rows.filter((r) => r.demandS == null).length,
      awaitingResponse: rows.filter((r) => r.demandS != null && r.proposedCalS == null).length,
      proposedZero: rows.filter((r) => r.proposedBhS === 0).length,
    };
  }, [rows]);

  const changedRows = useMemo(
    () =>
      rows
        .filter((r) => r.changed || r.flip !== "none")
        .sort((a, b) => (b.currentBhS ?? 0) - (a.currentBhS ?? 0)),
    [rows],
  );
  const visible = showAllChanged ? changedRows : changedRows.slice(0, 50);

  const invariantOk = summary.customerOpenedChanged === 0;

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-[1600px]">
        <div>
          <h1 className="text-2xl font-semibold">FRT demand-gate diff (read-only)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Shadow computation only — the engine, the Enterprise-Inbox anchor and every stored metric are
            unchanged. Proposed FRT measures from the first customer-side message at or after the anchor
            instead of from the anchor itself.
          </p>
        </div>

        {batch.loading ? (
          <div className="text-sm text-muted-foreground">Loading population…</div>
        ) : batch.error ? (
          <div className="text-sm text-destructive">{batch.error}</div>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Safety invariant</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={invariantOk ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
                  {invariantOk
                    ? `PASS — all ${summary.customerOpened} customer-opened tickets are bit-identical under the proposed rule.`
                    : `FAIL — ${summary.customerOpenedChanged} customer-opened tickets changed. Do not proceed.`}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ["In-scope tickets", summary.total],
                ["Customer-opened", summary.customerOpened],
                ["Agent-opened", summary.agentOpened],
                ["FRT value changed", summary.changed],
                ["Compliance flips", summary.flips],
                ["Breach → met", summary.breachToMet],
                ["Met → breach", summary.metToBreach],
                ["Becomes unevaluable", summary.toUnevaluable],
                ["Awaiting first response", summary.awaitingResponse],
                ["Proposed FRT = 0s", summary.proposedZero],
              ].map(([label, value]) => (
                <Card key={String(label)}>
                  <CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-2xl font-semibold">{String(value)}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Changed rows ({changedRows.length}) — no customer inbound after anchor: {summary.noDemand}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3 w-[320px]">Subject</th>
                      <th className="py-2 pr-3 w-[70px]">Sev</th>
                      <th className="py-2 pr-3 w-[100px]">Opened by</th>
                      <th className="py-2 pr-3 w-[140px]">Current FRT (bh)</th>
                      <th className="py-2 pr-3 w-[140px]">Proposed FRT (bh)</th>
                      <th className="py-2 pr-3 w-[160px]">Verdict</th>
                      <th className="py-2 pr-3 w-[120px]">Conversation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((d) => (
                      <tr key={d.row.id} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-3">
                          <div className="truncate max-w-[320px]" title={displaySubject(d.row)}>
                            {displaySubject(d.row)}
                          </div>
                        </td>
                        <td className="py-2 pr-3">{d.severity ?? "—"}</td>
                        <td className="py-2 pr-3 text-left">{d.row.sla.initiatedBy}</td>
                        <td className="py-2 pr-3 text-left">{formatDuration(d.currentBhS)}</td>
                        <td className="py-2 pr-3 text-left">
                          {d.demandS == null ? (
                            <span className="text-muted-foreground">no customer inbound</span>
                          ) : (
                            formatDuration(d.proposedBhS)
                          )}
                        </td>
                        <td className="py-2 pr-3 text-left">
                          {d.flip === "none" ? (
                            <span className="text-muted-foreground">unchanged verdict</span>
                          ) : (
                            <Badge variant={d.flip === "met_to_breach" ? "destructive" : "secondary"}>
                              {d.flip.replace(/_/g, " ")}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-left">
                          <a
                            className="text-primary hover:underline"
                            href={`https://app.intercom.com/a/apps/_/conversations/${d.row.intercom_conversation_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {d.row.intercom_conversation_id}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {changedRows.length > visible.length && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAllChanged(true)}>
                    Show all {changedRows.length}
                  </Button>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
