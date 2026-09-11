/**
 * Single reliable reader for the repo copy of `.lovable/project-knowledge.md`.
 *
 * It used to be fetched over HTTP at `/.lovable/project-knowledge.md`. That
 * works in the Vite dev server only: the file lives outside `public/`, so it is
 * never emitted into `dist/`, and dot-prefixed paths are commonly rejected by
 * hosts anyway. In preview/published builds the fetch 404s, which made the
 * Action Center drift card unreadable and "Sync from app" fail.
 *
 * A raw import bundles the markdown at build time (code-split, loaded on
 * demand), so there is no network request at all.
 */
export async function loadKnowledgeFile(): Promise<string> {
  const mod = await import("../../.lovable/project-knowledge.md?raw");
  const text = (mod as { default: string }).default ?? "";
  if (!text || text.length < 100) {
    throw new Error("Bundled project-knowledge.md is empty or too short to compare");
  }
  return text;
}
