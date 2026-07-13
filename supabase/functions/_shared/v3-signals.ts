// Extract raw customer-resolution signals from an Intercom conversation
// raw_payload. This is Phase 2a Track A: detect + store only. No attribution
// decisions are made here — callers write the returned values into the
// *_detected columns on intercom_tickets_v3.
//
// Signals:
//   - slack_channel_id_detected: earliest conversation_parts note of part_type
//     'note' whose author.type === 'bot' AND external_id starts with
//     'slack-url-'. Parse the Slack /archives/<CHANNELID> link (C[A-Z0-9]+).
//     Human/admin notes and any other Slack links are IGNORED — they usually
//     point at internal troubleshooting channels.
//   - workspace_id_detected: first /workspace_[a-z0-9]+/ match across source
//     body + every conversation_part body + notes. If multiple distinct
//     workspace ids are found, we keep the first but console.warn loudly with
//     the ticket/conv id and the full list.
//   - project_uuid_detected: first lovable.dev/projects/<uuid> match.
//
// Safe to run repeatedly. Never throws — bad shapes are logged and skipped.

export type V3Signals = {
  slack_channel_id_detected: string | null;
  workspace_id_detected: string | null;
  project_uuid_detected: string | null;
};

const SLACK_ARCHIVES_RE = /\/archives\/(C[A-Z0-9]+)/;
const WORKSPACE_RE = /workspace_[0-9a-z]{16,}/g;
const PROJECT_UUID_RE =
  /lovable\.dev\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function bodyOf(part: any): string {
  if (!part) return "";
  const b = part.body;
  return typeof b === "string" ? b : "";
}

export function extractV3Signals(
  rawPayload: any,
  ctx: { convId?: string } = {},
): V3Signals {
  const out: V3Signals = {
    slack_channel_id_detected: null,
    workspace_id_detected: null,
    project_uuid_detected: null,
  };
  if (!rawPayload || typeof rawPayload !== "object") return out;

  const parts: any[] = Array.isArray(rawPayload?.conversation_parts?.conversation_parts)
    ? rawPayload.conversation_parts.conversation_parts
    : [];

  // --- Slack channel (bot-authored slack-url-* notes only) ---
  // Parts arrive oldest-first from Intercom; take the first qualifying match.
  for (const p of parts) {
    try {
      if (p?.part_type !== "note") continue;
      if (p?.author?.type !== "bot") continue;
      const ext = typeof p?.external_id === "string" ? p.external_id : "";
      if (!ext.startsWith("slack-url-")) continue;
      const body = bodyOf(p);
      const m = body.match(SLACK_ARCHIVES_RE);
      if (m && m[1]) {
        out.slack_channel_id_detected = m[1];
        break;
      }
    } catch (e) {
      console.warn(
        `[v3-signals] slack-channel scan error conv=${ctx.convId ?? "?"}: ${(e as Error).message}`,
      );
    }
  }

  // --- Workspace id + project uuid (search all bodies) ---
  const bodies: string[] = [];
  const srcBody = rawPayload?.source?.body;
  if (typeof srcBody === "string") bodies.push(srcBody);
  for (const p of parts) {
    const b = bodyOf(p);
    if (b) bodies.push(b);
  }

  const workspaceIds = new Set<string>();
  let firstWorkspace: string | null = null;
  let firstProject: string | null = null;

  for (const b of bodies) {
    try {
      const wMatches = b.match(WORKSPACE_RE);
      if (wMatches) {
        for (const w of wMatches) {
          if (!firstWorkspace) firstWorkspace = w;
          workspaceIds.add(w);
        }
      }
      if (!firstProject) {
        const pm = b.match(PROJECT_UUID_RE);
        if (pm && pm[1]) firstProject = pm[1].toLowerCase();
      }
    } catch (e) {
      console.warn(
        `[v3-signals] body scan error conv=${ctx.convId ?? "?"}: ${(e as Error).message}`,
      );
    }
  }

  if (workspaceIds.size > 1) {
    console.warn(
      `[v3-signals] MULTIPLE distinct workspace ids in conv=${ctx.convId ?? "?"} — keeping first=${firstWorkspace} all=${JSON.stringify([...workspaceIds])}`,
    );
  }

  out.workspace_id_detected = firstWorkspace;
  out.project_uuid_detected = firstProject;
  return out;
}

// Persist the three detected columns for a ticket row. Idempotent.
// Logs — never throws — on error so callers can keep processing.
export async function writeV3Signals(
  supabase: any,
  ticketId: string,
  rawPayload: any,
  ctx: { convId?: string } = {},
): Promise<V3Signals> {
  const sig = extractV3Signals(rawPayload, ctx);
  const { error } = await supabase
    .from("intercom_tickets_v3")
    .update({
      slack_channel_id_detected: sig.slack_channel_id_detected,
      workspace_id_detected: sig.workspace_id_detected,
      project_uuid_detected: sig.project_uuid_detected,
    })
    .eq("id", ticketId);
  if (error) {
    console.error(
      `[v3-signals] update failed ticket=${ticketId} conv=${ctx.convId ?? "?"}: ${error.message}`,
    );
  }
  return sig;
}
