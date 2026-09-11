import { supabase } from "@/integrations/supabase/client";

/**
 * Knowledge doc drift detection.
 *
 * The Action Center's "Knowledge doc approvals" signal only ever saw the
 * DATABASE side (`pending_content`). If a build edited
 * `.lovable/project-knowledge.md` on disk but never staged it, nothing in the
 * app noticed — the safety net silently read "clear".
 *
 * This module compares three copies of the same document:
 *   1. the repo file, served at /.lovable/project-knowledge.md
 *   2. `knowledge_documents.content`        (live, approved)
 *   3. `knowledge_documents.pending_content` (staged, awaiting approval)
 *
 * Drift = the repo file matches NEITHER the live nor the pending copy, i.e.
 * documentation changed on disk and was never staged for review.
 *
 * Read-only. No writes, no schema change.
 */

export const KNOWLEDGE_DOC_ID = "project-knowledge";
export const KNOWLEDGE_DOC_PATH = "/.lovable/project-knowledge.md";

export type KnowledgeDriftReading = {
  /** True when the repo file matches neither the live nor the pending copy. */
  drifted: boolean;
  /** True when a staged edit is waiting for approval. */
  hasPending: boolean;
  pendingAt: string | null;
  fileLength: number;
  liveLength: number;
  pendingLength: number | null;
  /** Signed character delta of file vs live, for a one-line explanation. */
  delta: number;
};

const normalize = (s: string) => s.replace(/\r\n/g, "\n").trim();

let cache: { at: number; value: Promise<KnowledgeDriftReading> } | null = null;
const TTL_MS = 5_000;

async function read(): Promise<KnowledgeDriftReading> {
  // 1. Repo file, bundled at build time (no network — works in dev, preview
  //    and published alike).
  const raw = await loadKnowledgeFile();
  const file = normalize(raw);

  // 2/3. Stored copies.
  const q = await supabase
    .from("knowledge_documents")
    .select("content,pending_content,pending_at")
    .eq("id", KNOWLEDGE_DOC_ID)
    .maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) throw new Error(`No knowledge_documents row for '${KNOWLEDGE_DOC_ID}'`);

  const live = normalize(q.data.content ?? "");
  const pendingRaw = q.data.pending_content ?? null;
  const pending = pendingRaw === null ? null : normalize(pendingRaw);

  const matchesLive = file === live;
  const matchesPending = pending !== null && file === pending;

  return {
    drifted: !matchesLive && !matchesPending,
    hasPending: pending !== null,
    pendingAt: q.data.pending_at ?? null,
    fileLength: file.length,
    liveLength: live.length,
    pendingLength: pending?.length ?? null,
    delta: file.length - live.length,
  };
}

/** Cached for 5s so the drift and approval signals share one pair of reads. */
export function loadKnowledgeDrift(): Promise<KnowledgeDriftReading> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const value = read();
  cache = { at: now, value };
  // A failure must not be cached as a permanent error.
  value.catch(() => {
    if (cache?.value === value) cache = null;
  });
  return value;
}
