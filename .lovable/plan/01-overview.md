# Deep search across the Hub

Today every search box in the Hub is scoped: Inbox v3 searches loaded rows, Escalations searches its own population, Backlog searches titles. Nothing searches *across* surfaces, and nothing searches inside conversation bodies, notes, or custom attributes. That is why SCA-3522 was invisible until the board's gate was widened.

The fix is a separate **Deep search** surface — not a replacement for the per-page filters, which stay exactly as they are.

## What it would find

One box, one query, results grouped by what they are:

- **v3 tickets** — subject, Hub subject override, contact name/email/domain, tags, product area, classification, CSAT remark, every custom attribute (including Linear Issue and Escalated Issue), and the full message body text of the conversation.
- **Notes** — portable conversation notes and dev-escalation notes.
- **Dev escalations** — Linear key, Linear title, state, assignee, Hub note.
- **Backlog items** — title, description, linked ref.
- **Customer registry** — account label, domains, aliases, notes.
- **Severity proposals** — model rationale and your override reasons.
- **Legacy sources** — Gmail and manual conversations plus their message bodies.

Searching `SCA-3522`, `mckinsey`, `rate limit`, a Slack channel id, a workspace UUID, or a phrase someone wrote in a note all return the same way: a ranked list with a highlighted snippet and a link straight to the ticket, escalation, or backlog item.

## Cost is not the problem here

The population is small: 629 v3 tickets carrying 5.6 MB of raw payload, ~9,600 legacy manual messages, plus a few hundred rows across the smaller tables. A full Postgres text index over all of it is roughly 15-25 MB and answers in milliseconds. There is no reason to make this an expensive on-demand crawl.

The design below builds one **search index table**, refreshed on a schedule and on demand, rather than fanning a query out across nine tables at query time. That keeps the query fast and predictable, and it means partial-token matching (`SCA-35`, `mckins`) works without scanning JSON on every keystroke.

## Recommendation

Build it in three phases, shipping something usable at the end of phase 1.

- **Phase 1** — index + search RPC + `/search` page covering v3 tickets (including conversation bodies), notes, escalations, backlog, and the customer registry.
- **Phase 2** — add legacy Gmail and manual conversations and their messages.
- **Phase 3** — Cmd+K palette entry so deep search is reachable from any page.
