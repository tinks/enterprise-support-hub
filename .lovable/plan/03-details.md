## Step 0 — The showdown (AI vs. the ticket's existing severity)

New table `public.severity_eval_runs` (label, rubric version, model, N, created_by) and `public.severity_eval_items` (run id, `intercom_conversation_id`, `human_severity`, `ai_severity`, `confidence`, `rationale`, `input_excerpt`, `verdict` = `pending | ai_wrong | human_wrong | both_defensible`, `adjudication_note`, `adjudicated_by`). Deliberately **separate from `severity_proposals`** so a backfill can never be mistaken for a live triage decision or inflate the agreement stat on `/severity-ai`.

New edge function `run-severity-eval`: takes `{ n, pass, filters? }`, samples N tickets at random from `intercom_tickets_v3` that have a human Severity set (503 of 539 today), fetches each conversation, scores it with the **few-shot block disabled** (the point is a cold read, not imitation), and writes one item row per ticket. Respects `severity_ai_enabled` and the daily cap; the UI shows N against remaining headroom before you press go.

New `/severity-ai` tab **Showdown**: start a run (N = 10 / 25 / 50, triage or reclassify pass), then a results view — agreement %, the 4×4 matrix, and a disagreement list showing the ticket, both numbers, the AI's rationale, and three adjudication buttons: *AI was wrong*, *the ticket was wrong*, *both defensible*.

That last button matters. A run where the AI "loses" 30% of the time but half of those are tickets your team mis-severitied is a very different finding from a 30% loss where the AI is simply wrong — and only adjudication can tell them apart. Runs are re-runnable against a new rubric version, so this doubles as the before/after harness in Step 3.

Promotion rule: only items adjudicated `ai_wrong` become few-shot examples, and only with the human severity as the label. `human_wrong` items are excluded from training signal entirely and are worth a separate look as a data-quality list.

## Step 1 — Capture the disagreement (the negative signal)


One migration adding to `severity_proposals`: `override_reason_code text`, `override_reason_note text`.

Reason codes, kept short and pickable so they aggregate:
`wrong_impact_scope`, `wrong_urgency`, `missed_workaround`, `customer_tier`, `known_issue_duplicate`, `rubric_gap`, `ai_misread_ticket`, `other`.

UI: when the severity saved in `TicketFieldsPanel` (or via the proposal card) differs from a live proposal, the save is followed by a small prompt — one required code, one optional line. `recordSeverityDecision` carries both. Agreement stays one click: accept records nothing extra.

Deliberate boundary: the reason is captured only on a *real* decision, so every reason is attached to a ground-truth severity. No standalone "I disagree" button with no number behind it.

## Step 2 — Make the examples real

Today the few-shot block is built from `evidence`/`rationale` — the model's own summary. Change it to store and replay the actual input:

- Add `input_excerpt text` to `severity_proposals`, written at proposal time (the same truncated text already hashed, capped ~600 chars).
- `propose-severity` builds examples from `input_excerpt` → final severity → `(AI said N, corrected because <reason code>: <note>)`.
- Weight the window: take up to 12, but prefer overridden decisions over accepted ones, so corrections never get crowded out by easy agreements.

This is the change that makes disagreement compound instead of evaporate.

## Step 3 — Backtest, so rubric edits are measured not guessed

New edge function `backtest-severity`: given a draft rubric body and a set of past decided tickets, re-run the classifier against each **using the stored `input_excerpt`** (no Intercom calls, no new ticket data) with the few-shot block disabled, and report agreement vs. the human final severity — exact match, off-by-one, off-by-two.

On `/severity-ai`, an admin panel: edit rubric draft → "Backtest against N decided tickets" → a table of current-rubric agreement vs. draft agreement, plus the tickets whose verdict changed. Publishing a new rubric version is a separate, explicit click.

Costs are real and visible: a backtest is N model calls. The panel shows N and the daily-cap headroom before running, and the run respects `severity_ai_daily_call_cap`.

## Step 4 — Reason roll-up

On `/severity-ai`, a frequency table of override reason codes over a window, each row expandable to the tickets and notes behind it. A code that recurs is a rubric line waiting to be written — that is the human's cue to draft one and backtest it.

## What this is not

- No fine-tuning, no embeddings store, no model training. Called out because "training" is the wrong mental model here and building for it would be expensive theatre.
- No AI write path. Severity still reaches Intercom only through `esh-write-action` on a human click.
- No automatic rubric edits. The model never rewrites its own rubric; it only gets scored against one.

## Honest constraint on timing

Step 0 is what unblocks everything else: a single 50-ticket showdown gives Steps 3 and 4 something real to measure on day one, instead of waiting weeks for live triage decisions to accumulate. Steps 1 and 2 then keep the corpus growing from actual work.

Two things I will not claim: a showdown agreement rate is only as good as the adjudication behind it, so an un-adjudicated run gets labelled UNVERIFIED in the UI; and every number on that tab shows its sample size, because 10 tickets is an anecdote.

## Paperwork

Per convention: `.lovable/project-knowledge.md` staged via `sync-knowledge-pending`, a `changelog_entries` row, and FlowDiagram nodes for the showdown runner, the reason capture, and the backtest function.

