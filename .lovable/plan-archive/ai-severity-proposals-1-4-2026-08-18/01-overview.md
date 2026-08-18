# AI severity proposals (1–4)

Two related activities, one engine:

1. **Triage pass** — as soon as a ticket lands with almost no information (subject + first customer message + product area if present), an AI proposes a severity 1–4 with a one-line rationale and a confidence.
2. **Reclassify pass** — later, with the full thread, the AI can re-propose. The new proposal supersedes the old one; both stay on the record so we can see whether early guesses hold up.

Nothing is ever written to Intercom by the AI. A proposal is a suggestion sitting next to the existing "Write to Intercom" control. A human clicks **Accept** (which runs the existing `esh-write-action` `set_severity` path) or sets a different value. Both outcomes are recorded as labelled training signal.

## Learning loop

Both mechanisms you picked:

- **Rubric** — your severity framework lives in the Hub as an editable, versioned document (admin-gated). Every proposal records which rubric version produced it.
- **Few-shot from history** — each prompt carries a small set of recent human decisions (accepted as-is, and especially overridden ones), so the model drifts toward how the team actually classifies. No training, no fine-tune; it adapts the moment you correct it.
- **Calibration panel** — agreement rate, a 4×4 proposed-vs-final matrix, and the disagreement list, so you can see where the rubric text needs editing rather than guessing.

## Cost control (explicit, since you asked)

- Cheap model by default (`google/gemini-3-flash-preview`), thread text hard-truncated (triage pass ~4k chars, reclass ~12k).
- **One proposal per ticket per content hash** — re-running an unchanged ticket is a no-op, not a new call.
- Per-call cap (max 25 tickets), and a daily call budget stored in settings; the function refuses past it rather than silently spending.
- Every proposal row stores model, token counts and pass type, so a "what did the classifier cost this month" query is a plain `SELECT`.
- Nightly re-scoring exists but ships **disabled**, with a hard cap on tickets per run. Manual button first; turn the cron on only after a month of cost data.

## Blocked item

I could not read the Notion rubric page — `app.notion.com` returns a login shell to the sandbox and this project has no `NOTION_API_KEY` secret. At build time either paste the rubric text into chat or paste it into the rubric editor after step 1; the plan seeds the rubric row with a placeholder until then.
