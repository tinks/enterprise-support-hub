## Goal

Add prev/next navigation to the conversation detail page so you can move through the inbox without going back.

## Approach

When you click into a conversation from the Inbox (or an Owner dashboard, which reuses Inbox), persist the currently visible, filtered+sorted list of conversation IDs to `sessionStorage` under a key like `inbox:list`. The detail page reads that list, finds the current ID, and exposes Prev / Next buttons that navigate to the neighboring entry (preserving the `?source=...` param per row).

This way Next honors whatever filters/search/sort the user had applied in the Inbox, instead of guessing an order from the DB.

## Changes

1. **`src/pages/Conversations.tsx`**
   - Build a flat ordered array of `{ id, source }` from the rendered rows (the same order the table shows: Slack mappings, gmail with subrows, manual rows).
   - On every row click that navigates to `/conversations/:id`, write that array to `sessionStorage` first, e.g. `sessionStorage.setItem("inbox:list", JSON.stringify(list))`.

2. **`src/pages/ConversationDetail.tsx`**
   - On mount, read `inbox:list` from `sessionStorage`. Find current `{ id, source }` by matching `useParams().id` + `useSearchParams().get("source")`.
   - Add a small Prev / Next control near the existing "Back" button (top of the page). Use `ChevronLeft` / `ChevronRight` icon buttons with keyboard shortcuts `[` / `]` (or `j` / `k`) for power use.
   - Disable Prev at index 0 and Next at the end. Hide entirely if no list is found in storage (e.g. user opened the URL directly).
   - Navigation target: `/conversations/${nextId}${nextSource ? \`?source=${nextSource}\` : ""}`.

## Out of scope

- Changing inbox sort/filter behavior.
- Auto-advancing on resolve, or any "skip resolved" logic — Next strictly follows the Inbox order at the time you opened the conversation.
- Server-side pagination across the boundary (if the Inbox is paginated and Next would cross a page, it just stops at the last loaded item).
