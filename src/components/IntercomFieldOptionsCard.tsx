import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Loader2, AlertTriangle, Check } from "lucide-react";
import { useCanEdit } from "@/hooks/useCanEdit";

/**
 * Phase 1 of "Intercom-sourced field options": show what Intercom actually
 * offers for the list fields the Hub writes, next to the hand-maintained list
 * the Hub still validates against. Nothing is auto-corrected — drift is only
 * made visible. Validation still uses the hand-maintained lists (Phase 2 flips
 * that over, one field at a time).
 */

type OptionRow = {
  attr_key: string;
  option_value: string;
  sort_order: number;
  active: boolean;
  last_seen_at: string;
};

const PRODUCT_AREA_ATTR = "Affected Product Area";
const TICKET_TYPE_ATTR = "Ticket type";

function splitList(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function AttrPanel({
  attrKey,
  hubLabel,
  hubValues,
  rows,
  onAdopt,
  adopting,
  canEdit,
}: {
  attrKey: string;
  /** Describes the parallel hand-maintained list, when one still exists. */
  hubLabel: string;
  /** Omit when the field is fully cache-driven — then there is nothing to drift against. */
  hubValues?: string[];
  rows: OptionRow[];
  /** Present only for panels whose Hub list can be overwritten from Intercom. */
  onAdopt?: (values: string[]) => void;
  adopting?: boolean;
  canEdit?: boolean;
}) {
  const intercomActive = rows.filter((r) => r.active).map((r) => r.option_value);
  const retired = rows.filter((r) => !r.active).map((r) => r.option_value);
  const lastSeen = rows.length ? rows.map((r) => r.last_seen_at).sort().slice(-1)[0] : null;

  const compared = hubValues ?? null;
  const missingInHub = compared ? intercomActive.filter((v) => !compared.includes(v)) : [];
  const missingInIntercom = compared ? compared.filter((v) => !intercomActive.includes(v)) : [];
  const inSync = rows.length > 0 && missingInHub.length === 0 && missingInIntercom.length === 0;


  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{attrKey}</p>
          <p className="text-xs text-muted-foreground">
            {compared
              ? `Compared with ${hubLabel} (${compared.length} values) · Intercom: ${intercomActive.length} options`
              : `${hubLabel} · Intercom: ${intercomActive.length} options`}
          </p>
        </div>
        {rows.length === 0 ? (
          <Badge variant="outline">Never synced</Badge>
        ) : !compared ? (
          <Badge variant="outline" className="text-emerald-600 border-emerald-600/40">
            <Check className="h-3 w-3 mr-1" /> Intercom-sourced
          </Badge>
        ) : inSync ? (
          <Badge variant="outline" className="text-emerald-600 border-emerald-600/40">
            <Check className="h-3 w-3 mr-1" /> In sync
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-600 border-amber-600/40">
            <AlertTriangle className="h-3 w-3 mr-1" /> Drift
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {intercomActive.map((v) => (
          <Badge
            key={v}
            variant="secondary"
            className={missingInHub.includes(v) ? "border border-amber-600/50" : ""}
          >
            {v}
          </Badge>
        ))}
        {intercomActive.length === 0 && (
          <span className="text-xs text-muted-foreground">No cached options yet.</span>
        )}
      </div>

      {missingInHub.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          In Intercom, not in the Hub list: {missingInHub.join(", ")}
        </p>
      )}
      {missingInIntercom.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          In the Hub list, not offered by Intercom: {missingInIntercom.join(", ")}
        </p>
      )}
      {retired.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Retired by Intercom (kept for history): {retired.join(", ")}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        {lastSeen ? `Last seen in Intercom ${new Date(lastSeen).toLocaleString()}` : "Not yet fetched"}
      </p>
    </div>
  );
}

export default function IntercomFieldOptionsCard() {
  const { canEdit } = useCanEdit();
  const [rows, setRows] = useState<OptionRow[]>([]);
  const [productAreas, setProductAreas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [opts, settings] = await Promise.all([
      supabase.from("intercom_field_options" as any).select("*").order("sort_order"),
      supabase.from("settings").select("product_areas").limit(1).maybeSingle(),
    ]);
    setRows((opts.data ?? []) as unknown as OptionRow[]);
    setProductAreas(splitList(settings.data?.product_areas));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.functions.invoke("sync-intercom-fields", { body: {} });
    if (error) setError(error.message);
    await load();
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Intercom field options</CardTitle>
            <CardDescription>
              What Intercom actually offers for the list fields the Hub writes, compared with the
              Hub's remaining hand-maintained list. Writes to Intercom validate against this cache;
              drift shown here is informational and is never auto-corrected.
            </CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh from Intercom
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-xs text-destructive">Refresh failed: {error}</p>}
        <AttrPanel
          attrKey={PRODUCT_AREA_ATTR}
          hubLabel="settings.product_areas (legacy surfaces)"
          hubValues={productAreas}
          rows={rows.filter((r) => r.attr_key === PRODUCT_AREA_ATTR)}
        />
        <AttrPanel
          attrKey={TICKET_TYPE_ATTR}
          hubLabel="Writes validate directly against this cache"
          rows={rows.filter((r) => r.attr_key === TICKET_TYPE_ATTR)}
        />
      </CardContent>
    </Card>
  );
}
