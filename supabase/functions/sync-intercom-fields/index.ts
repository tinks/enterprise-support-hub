// sync-intercom-fields — Phase 1 of "Intercom-sourced field options".
//
// Reads the conversation data attributes from Intercom and caches the allowed
// option values for the list fields the Hub writes. It changes NO validation:
// esh-write-action and the UI still use their pinned/hand-maintained lists.
// The only job here is to make drift between Intercom and the Hub visible.
//
// Never deletes: an option Intercom stops returning is marked active = false so
// the historical set stays inspectable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";
  classifyHttpStatus,
  recordIntegrationHealth,
} from "../_shared/integration-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTERCOM_BASE = "https://api.intercom.io";
const INTERCOM_VERSION = "2.13"; // pinned to match the sync + write functions

// Only the attributes the Hub writes. Anything else Intercom exposes is ignored
// so the cache never grows into a mirror of the whole workspace config.
const TRACKED_ATTRS = ["Affected Product Area", "Ticket type"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const token = Deno.env.get("INTERCOM_API_TOKEN");
  if (!token) return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let res: Response;
  let text = "";
  try {
    res = await fetch(`${INTERCOM_BASE}/data_attributes?model=conversation`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Intercom-Version": INTERCOM_VERSION,
      },
    });
    text = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordIntegrationHealth(supabase, "intercom_fields_sync", "error", msg);
    return json({ error: msg }, 502);
  }

  if (!res.ok) {
    // Fetch failed: the cache is deliberately left exactly as it was rather than
    // emptied, so a bad token can never make the Hub think Intercom has no options.
    await recordIntegrationHealth(
      supabase,
      "intercom_fields_sync",
      classifyHttpStatus(res.status),
      `HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
    return json({ error: `Intercom returned ${res.status}`, body: text.slice(0, 500) }, 502);
  }

  let payload: { data?: Array<Record<string, unknown>> } = {};
  try {
    payload = JSON.parse(text);
  } catch {
    await recordIntegrationHealth(supabase, "intercom_fields_sync", "error", "unparseable response");
    return json({ error: "Unparseable response from Intercom" }, 502);
  }

  const attributes = Array.isArray(payload.data) ? payload.data : [];
  const nowIso = new Date().toISOString();
  const perAttr: Record<string, { seen: string[]; deactivated: string[]; missing: boolean }> = {};

  for (const attrKey of TRACKED_ATTRS) {
    const attr = attributes.find(
      (a) => String(a.label ?? a.name ?? "").trim().toLowerCase() === attrKey.toLowerCase(),
    );

    if (!attr) {
      // Attribute itself is gone from Intercom — loud, but non-destructive.
      perAttr[attrKey] = { seen: [], deactivated: [], missing: true };
      continue;
    }

    const options = Array.isArray(attr.options)
      ? (attr.options as unknown[])
          .map((o) =>
            typeof o === "string"
              ? o
              : String((o as Record<string, unknown>)?.value ?? (o as Record<string, unknown>)?.label ?? ""),
          )
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    if (options.length > 0) {
      const rows = options.map((value, i) => ({
        attr_key: attrKey,
        option_value: value,
        sort_order: i,
        active: true,
        last_seen_at: nowIso,
      }));
      const { error } = await supabase
        .from("intercom_field_options")
        .upsert(rows, { onConflict: "attr_key,option_value" });
      if (error) {
        await recordIntegrationHealth(supabase, "intercom_fields_sync", "error", error.message);
        return json({ error: error.message }, 500);
      }
    }

    // Anything cached for this attribute that Intercom no longer returns.
    const { data: cached } = await supabase
      .from("intercom_field_options")
      .select("option_value, active")
      .eq("attr_key", attrKey);

    const stale = (cached ?? [])
      .filter((r) => r.active && !options.includes(r.option_value))
      .map((r) => r.option_value);

    if (stale.length > 0) {
      await supabase
        .from("intercom_field_options")
        .update({ active: false })
        .eq("attr_key", attrKey)
        .in("option_value", stale);
    }

    perAttr[attrKey] = { seen: options, deactivated: stale, missing: false };
  }

  // --- Teams cache -----------------------------------------------------
  // Purely a display lookup (id -> name) for reassigned/transferred tickets.
  // Never deletes: teams Intercom stops returning are marked inactive.
  let teamsSynced = 0;
  let teamsError: string | null = null;
  try {
    const tRes = await fetch(`${INTERCOM_BASE}/teams`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Intercom-Version": INTERCOM_VERSION,
      },
    });
    const tText = await tRes.text();
    if (!tRes.ok) {
      teamsError = `HTTP ${tRes.status}: ${tText.slice(0, 200)}`;
    } else {
      const tPayload = JSON.parse(tText) as { teams?: Array<{ id?: unknown; name?: unknown }> };
      const teams = (tPayload.teams ?? [])
        .map((t) => ({ team_id: String(t.id ?? "").trim(), name: String(t.name ?? "").trim() }))
        .filter((t) => t.team_id && t.name);
      if (teams.length > 0) {
        const { error } = await supabase.from("intercom_teams").upsert(
          teams.map((t) => ({ ...t, active: true, last_seen_at: nowIso })),
          { onConflict: "team_id" },
        );
        if (error) teamsError = error.message;
        else {
          teamsSynced = teams.length;
          const ids = teams.map((t) => t.team_id);
          const { data: cachedTeams } = await supabase
            .from("intercom_teams")
            .select("team_id, active");
          const staleTeams = (cachedTeams ?? [])
            .filter((r) => r.active && !ids.includes(r.team_id))
            .map((r) => r.team_id);
          if (staleTeams.length > 0) {
            await supabase.from("intercom_teams").update({ active: false }).in("team_id", staleTeams);
          }
        }
      }
    }
  } catch (e) {
    teamsError = e instanceof Error ? e.message : String(e);
  }

  const anyMissing = Object.values(perAttr).some((p) => p.missing);
  await recordIntegrationHealth(
    supabase,
    "intercom_fields_sync",
    anyMissing ? "error" : "ok",
    anyMissing
      ? `Attribute(s) not returned by Intercom: ${Object.entries(perAttr)
          .filter(([, p]) => p.missing)
          .map(([k]) => k)
          .join(", ")}`
      : null,
  );

  return json({
    ok: true,
    synced_at: nowIso,
    attributes: perAttr,
    teams: { synced: teamsSynced, error: teamsError },
  });
});
