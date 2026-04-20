

## The fix isn't complete — same class of duplicate is still happening

### What I found

Today, after my last fix, this duplicate was created:
- Gmail thread `19dab3b3b122c2d3` ("Dragonpass x Lovable | Kick-off Call") was already linked to Intercom `215473947146973`.
- Diana replied via Intercom → email looped back through the Google Group → Intercom created a **second ticket** `215473990768864`.
- The webhook fired. My overwrite guard correctly refused to re-stamp the Gmail thread ✅
- Then my "manual_conversations subject lookup" tier ran — but it only checks `manual_conversations`. The original record is in `gmail_conversations`, so it found nothing → fell through and **created a new manual row** `2c32a2ab…` ❌

Same pattern hit 4 conversations in the last week (3 of them before the fix, 1 today). The miss is structural: I added a lookup against the wrong table.

### Why my last fix only half-worked

The "duplicate Intercom ticket" case has two flavors:
1. **Original lives in `manual_conversations`** → my new tier handles it ✅
2. **Original lives in `gmail_conversations`** → my new tier doesn't check there → still creates a manual duplicate ❌

The overwrite guard catches (2) at the Gmail-stamp step but doesn't stop the manual-row creation that follows it.

### Fix — three changes

**1. Extend the existing-record lookup to also check `gmail_conversations` by normalized subject**

In `intercom-webhook` after the Gmail subject linker hits a `subject_link_conflict` (or any time we'd otherwise fall through to manual creation), do one more lookup:

- Query `gmail_conversations` for rows in the last 14 days where normalized subject matches AND `intercom_conversation_id IS NOT NULL`.
- If exactly one distinct existing `intercom_conversation_id` matches: log `subject_match_existing_gmail`, return `{ ok: true, message: "Duplicate Intercom ticket for existing Gmail thread", existingThreadId, existingIntercomId }`. Skip manual creation.

**2. Wire the conflict path into the same skip**

When the overwrite guard fires (`subject_link_conflict` / `email_link_conflict`), today it returns early — good. But before this fix, that early return was never reached for the Dragonpass case because the subject linker found *no* unlinked thread to stamp (all siblings already had a different non-null intercom id), so it just fell through to manual creation. Make sure the "existing linked thread on this normalized subject" check runs **even when the subject linker finds nothing to stamp**, not only as a guard before stamping.

Concretely: replace today's two-step flow (subject linker → manual creation) with: subject linker → if any candidate thread on this normalized subject exists with a non-null intercom id different from ours → log `subject_match_existing_gmail` and return. Otherwise → manual_conversations lookup → manual creation.

**3. Data cleanup for the 4 known dupes**

Delete the 4 duplicate manual rows since the originals already exist in `gmail_conversations`:
- `2c32a2ab-2d82-4e85-ac88-63ad0a407412` (Dragonpass)
- `1e44d53b-8f72-4eb3-bca6-5c71024816c4` (Preview reverting)
- `2d6ca7d2-e282-4e19-b03c-6d60a6fc9b6e` (Lovable Settings Pane)
- `73b8b9a6-fcb1-4f21-a30c-38f4cdd8f0e3` (Session Timeout)

Each delete also removes their `manual_messages` and `conversation_audit_logs`. The Gmail rows already carry the original Intercom ticket; replies on the duplicate Intercom tickets won't surface in our DB, but that's acceptable (they're duplicates Intercom shouldn't have created).

### Files

- Edit: `supabase/functions/intercom-webhook/index.ts` — add gmail_conversations subject lookup tier; restructure flow so the "existing linked record" check runs before manual creation regardless of whether the subject linker stamped anything.
- Data: 4 DELETEs across `manual_conversations` + cascading `manual_messages` / `conversation_audit_logs`.
- Update `mem://logic/duplicate-intercom-ticket-detection`: lookup tier covers BOTH `manual_conversations` and `gmail_conversations`.
- Update `.lovable/project-knowledge.md` and FlowDiagram: linker priority order is now email → subject in Gmail → "is this thread/subject already represented anywhere with a different ticket?" → manual lookup → create.

### Out of scope

- Auto-merging the duplicate Intercom tickets in Intercom (no public API).
- Subject fuzzy matching beyond Re/Fwd/Fw strip + lowercase + whitespace collapse.
- A "duplicate detected" UI badge.

### Confirm before I run

1. Delete the 4 duplicate manual rows listed above (originals stay in `gmail_conversations`)?
2. Add the `gmail_conversations` subject lookup tier and restructure the fallthrough so future duplicates get blocked at the same step?

