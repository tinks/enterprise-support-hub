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
 * Automated Hub/Slack bookkeeping notes are noise on the panel — the Slack
 * permalink note the Hub itself posts is never what a human needs to read.
 */
function isAutomatedNote(author: string, text: string): boolean {
  if (/lovable support/i.test(author)) return true;
  return /slack\.com\/archives\//i.test(text);
}

/**
 * The two cards worth showing at a glance: how the ticket opened, and the most
 * recent thing either side actually said, plus the newest human internal note.
 * Returns only what exists.
 */
export function ticketComments(raw: Record<string, any> | null | undefined): {
  initial: TicketComment | null;
  latest: TicketComment | null;
  note: TicketComment | null;
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
  let note: TicketComment | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const type = p?.part_type;
    if (type !== "comment" && type !== "note") continue;
    const text = stripHtml(p?.body);
    if (!text) continue;
    const author = authorName(p?.author);

    if (type === "comment" && !latest) {
      latest = {
        kind: "latest",
        author,
        authorType: p?.author?.type ?? null,
        text,
        atMs: ms(p?.created_at),
      };
    } else if (type === "note" && !note && !isAutomatedNote(author, text)) {
      note = {
        kind: "note",
        author,
        authorType: p?.author?.type ?? null,
        text,
        atMs: ms(p?.created_at),
      };
    }
    if (latest && note) break;
  }

  return { initial, latest, note };
}
