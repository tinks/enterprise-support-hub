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

With 3 proposals and 1 decision recorded, Steps 3 and 4 have nothing to measure yet. Steps 1 and 2 are what start accumulating the corpus, so they are worth building now regardless. Step 3's numbers only become meaningful somewhere around 30–50 decided tickets; I will build it but will not present an agreement rate as trustworthy before then, and the panel will state the sample size next to every number.

## Paperwork

Per convention: `.lovable/project-knowledge.md` staged via `sync-knowledge-pending`, a `changelog_entries` row, and FlowDiagram nodes for the reason capture and the backtest function.
