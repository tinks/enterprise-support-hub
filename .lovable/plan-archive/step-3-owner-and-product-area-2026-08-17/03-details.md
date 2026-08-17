## Technical detail

### Edge function — `supabase/functions/esh-write-action/index.ts`

Add two names to `KNOWN_ACTIONS` and two handlers. Nothing else in the app gains write access.

- `set_product_area` — payload `{ productArea, expectedCurrent }`. Validated against the list in `settings.product_areas`, so the Hub can never invent a value the taxonomy does not contain. Intercom call: `PUT /conversations/{id}` with `custom_attributes: { "Affected Product Area": value }` — the same key `_shared/v3.ts` `extractFields()` already reads, so the next sync agrees instead of reverting.
- `set_owner` — payload `{ teammateName | intercomAdminId, expectedCurrent }`. Resolves through `teammates.intercom_admin_id` (active only). Intercom call: `POST /conversations/{id}/parts` with `message_type: "assignment"`, `type: "admin"`, `admin_id` = the acting teammate, `assignee_id` = the target. Refuses if the target has no admin id — the Hub does not record an owner Intercom cannot hold.
- **Conflict pre-read** (shared): GET the conversation, compare the live value to `expectedCurrent`. Mismatch → `blocked`, 409, audit row, local row untouched. `expectedCurrent: null` means "was empty".
- Mirror step extends the existing update to `product_area`, `admin_assignee_id`, and `owner` (resolved through `settings.admin_owner_map`, the same mapping `sync-v3-closed` uses at line 306–308) — all read back off the verification GET, never from the request payload.

Both names must be added to `settings.esh_write_allowed_actions` for the writes to run — a separate, deliberate data change, not part of the deploy.

### Frontend

- New `src/components/issues/OwnerWriteControl.tsx` and `ProductAreaWriteControl.tsx`, both modelled on `SeverityWriteControl.tsx`: `useCanEdit` gate, refusal rendered inline (`refused` vs `failed` worded differently), local state moved only on success.
- The stale-value case gets its own outcome kind: "Refused — Intercom now holds X. Reload to see current." Distinct from a kill-switch refusal, because the user action differs.
- Wired into `Triage.tsx` and `InboxV3.tsx` detail sheets. No table, filter, or column changes.

### Out of scope

Bulk / multi-select writes. Any other Intercom field. Changing what the sync functions own. Notes, tags, lifecycle, replies (steps 4–6).

### Verification before step 4 starts

1. Positive: owner set on a real ticket with no owner; product area set on a real ticket with none. Re-read shows Intercom and the Hub agree.
2. Positive on a **populated** field — an actual overwrite, which severity never exercised.
3. Negative: kill switch off → refusal in the UI, `blocked` row in `esh_ticket_actions`.
4. Negative: action removed from the allowlist → refusal, `blocked` row.
5. Negative: value changed in Intercom between page load and write → stale-value refusal, `blocked` row, local row unchanged.
6. Attribution: the assignment part in Intercom shows the acting teammate as author, not a bot admin.

Test tickets follow the yours/mine convention; at least one real ticket watched through the next sync cycle to confirm nothing reverts.

### Docs of record

Separate docs-only pass after the logic lands: `changelog_entries` row, `.lovable/project-knowledge.md` via `sync-knowledge-pending`, and the `esh-write-action` FlowDiagram node updated with the two new actions and the conflict rule. The rollout memory's step table moves step 3 to done and step 4 to next.
