// backfill-v3-signals
// ---------------------------------------------------------------------------
// One-time (idempotent) backfill for the Phase 2a Track A signal columns on
// intercom_tickets_v3. Walks all rows with a raw_payload and populates:
//   - slack_channel_id_detected
//   - workspace_id_detected
//   - project_uuid_detected
//
// Time-boxed at ~120s per call, resumable via `after` cursor (uuid).
// Idempotent: re-running produces the same result. Rows without raw_payload
// (open-side rows) are skipped and left null.
//
// Request body (all optional):
//   { batch?: number = 200, limit?: number, after?: string,
//     force?: boolean = false }
//     - force=true reprocesses rows that already have any of the three
//       detected columns set. Default only processes rows where ALL three
//       are still null.
//
// Response:
//   { ok, processed, updated, skipped, errors, last_id, done,
//     detected_slack, detected_workspace, detected_project,
//     multi_workspace_tickets: [{ ticket_id, conv_id, workspaces }] }
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { V3_CORS_HEADERS, TIME_BUDGET_MS } from "../_shared/v3.ts";
import { extractV3Signals } from "../_shared/v3-signals.ts";
import { requireEditor } from "../_shared/require-editor.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: V3_CORS_HEADERS });

  const gate = await requireEditor(req, V3_CORS_HEADERS);
  if (!gate.ok) return gate.response;

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { batch?: number; limit?: number; after?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const batch = Math.max(1, Math.min(body.batch ?? 200, 500));
  const hardLimit = typeof body.limit === "number" ? Math.max(1, body.limit) : Number.MAX_SAFE_INTEGER;
  const force = !!body.force;
  let after: string | null = body.after ?? null;

  let processed = 0, updated = 0, skipped = 0, errors = 0;
  let detected_slack = 0, detected_workspace = 0, detected_project = 0;
  const multiWorkspaceTickets: Array<{ ticket_id: string; conv_id: string; workspaces: string[] }> = [];
  let lastId: string | null = after;
  let done = false;

  const WORKSPACE_RE_GLOBAL = /workspace_[a-z0-9]+/g;

  while (processed < hardLimit) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.log("[backfill-v3-signals] time budget hit");
      break;
    }

    let q = supabase
      .from("intercom_tickets_v3")
      .select("id, intercom_conversation_id, raw_payload, slack_channel_id_detected, workspace_id_detected, project_uuid_detected")
      .order("id", { ascending: true })
      .limit(batch);
    if (after) q = q.gt("id", after);
    if (!force) {
      q = q
        .is("slack_channel_id_detected", null)
        .is("workspace_id_detected", null)
        .is("project_uuid_detected", null);
    }

    const { data: rows, error } = await q;
    if (error) {
      console.error(`[backfill-v3-signals] fetch error: ${error.message}`);
      return json({ ok: false, error: error.message, processed, updated, skipped, errors, last_id: lastId }, 500);
    }
    if (!rows || rows.length === 0) { done = true; break; }

    for (const row of rows) {
      lastId = row.id;
      processed++;
      if (!row.raw_payload) {
        skipped++;
        continue;
      }
      try {
        const sig = extractV3Signals(row.raw_payload, { convId: row.intercom_conversation_id });

        // Loud multi-workspace check (extractV3Signals already console.warns,
        // but we also collect them for the response payload).
        const parts: any[] = Array.isArray(row.raw_payload?.conversation_parts?.conversation_parts)
          ? row.raw_payload.conversation_parts.conversation_parts
          : [];
        const bodies: string[] = [];
        if (typeof row.raw_payload?.source?.body === "string") bodies.push(row.raw_payload.source.body);
        for (const p of parts) if (typeof p?.body === "string") bodies.push(p.body);
        const uniq = new Set<string>();
        for (const b of bodies) {
          const m = b.match(WORKSPACE_RE_GLOBAL);
          if (m) for (const w of m) uniq.add(w);
        }
        if (uniq.size > 1) {
          multiWorkspaceTickets.push({
            ticket_id: row.id,
            conv_id: row.intercom_conversation_id,
            workspaces: [...uniq],
          });
        }

        const { error: upErr } = await supabase
          .from("intercom_tickets_v3")
          .update({
            slack_channel_id_detected: sig.slack_channel_id_detected,
            workspace_id_detected: sig.workspace_id_detected,
            project_uuid_detected: sig.project_uuid_detected,
          })
          .eq("id", row.id);
        if (upErr) {
          console.error(`[backfill-v3-signals] update ${row.id} conv=${row.intercom_conversation_id}: ${upErr.message}`);
          errors++;
          continue;
        }
        if (sig.slack_channel_id_detected) detected_slack++;
        if (sig.workspace_id_detected) detected_workspace++;
        if (sig.project_uuid_detected) detected_project++;
        updated++;
      } catch (e) {
        console.error(
          `[backfill-v3-signals] err ticket=${row.id} conv=${row.intercom_conversation_id}: ${(e as Error).message}`,
        );
        errors++;
      }
      if (processed >= hardLimit) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    }

    if (rows.length < batch) { done = true; break; }
    after = lastId;
  }

  return json({
    ok: true,
    processed,
    updated,
    skipped,
    errors,
    detected_slack,
    detected_workspace,
    detected_project,
    multi_workspace_tickets: multiWorkspaceTickets,
    last_id: lastId,
    done,
    elapsed_ms: Date.now() - startedAt,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...V3_CORS_HEADERS, "Content-Type": "application/json" },
  });
}
