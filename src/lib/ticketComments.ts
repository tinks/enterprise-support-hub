/**
 * Read-only extraction of the human-readable message cards shown on a ticket.
 *
 * Everything here comes from `intercom_tickets_v3.raw_payload`, which sync
 * already persists — no extra Intercom call, no write path, and nothing that
 * can move a reported number. Display only.
 *
 * Intercom shape:
 *   raw_payload.source.body                       → the opening message
 *   raw_payload.conversation_parts.conversation_parts[] → everything after it,
 *   where `part_type === "comment"` is a real reply (notes, assignments and
 *   state changes are deliberately excluded).
 */

export type TicketComment = {
  kind: "initial" | "latest" | "note";
  author: string;
  authorType: string | null;
  /** Plain text, already HTML-stripped and whitespace-collapsed. */
  text: string;
  atMs: number | null;
};

/** How much we show before the "Show more" toggle. */
export const COMMENT_CAP = 280;

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ms(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

function authorName(a: any): string {
  return (a?.name && String(a.name).trim()) || (a?.email && String(a.email).trim()) || "Unknown";
}

/**
 * The two cards worth showing at a glance: how the ticket opened, and the most
 * recent thing either side actually said. Returns only what exists.
 */
export function ticketComments(raw: Record<string, any> | null | undefined): {
  initial: TicketComment | null;
  latest: TicketComment | null;
} {
  const source = raw?.source;
  const initialText = stripHtml(source?.body);
  const initial: TicketComment | null = initialText
    ? {
        kind: "initial",
        author: authorName(source?.author),
        authorType: source?.author?.type ?? null,
        text: initialText,
        atMs: ms(raw?.created_at),
      }
    : null;

  const parts: any[] = raw?.conversation_parts?.conversation_parts ?? [];
  let latest: TicketComment | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p?.part_type !== "comment") continue;
    const text = stripHtml(p?.body);
    if (!text) continue;
    latest = {
      kind: "latest",
      author: authorName(p?.author),
      authorType: p?.author?.type ?? null,
      text,
      atMs: ms(p?.created_at),
    };
    break;
  }

  return { initial, latest };
}
