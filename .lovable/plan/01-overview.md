# AI-written subjects for v3 tickets

## The problem

Intercom sometimes gives no usable title. Verified: ticket `215475214997973` has the subject
`Intercom #215475214997973` and nothing else. Across `intercom_tickets_v3`, **282 tickets** carry
a placeholder subject (`Intercom #<id>`, blank, `(no subject)`, `untitled`); **19 of those are
currently open**.

## What gets built

A third subject layer that sits **between** Intercom's subject and your manual label, so the
existing override keeps winning and nothing about Intercom changes.

```text
display order:   manual override  >  AI subject  >  Intercom subject  >  "Untitled"
                 (human, wins)       (labeled AI)    (source truth, always readable)
```

- A new **AI subject** column beside the existing `subject_override`, with its own model,
  timestamp, and the content hash it was generated from. Sync never writes it; Intercom never
  receives it.
- **Automatic** generation for placeholder subjects only. A scheduled pass picks up qualifying
  **open** tickets and writes an AI subject with no human step — it shows immediately, marked
  as AI.
- **On-demand** generation for *any* ticket via a "Rewrite subject with AI" control in the
  ticket Update panel, including tickets whose Intercom subject is perfectly fine.
- **Manual override always wins.** Typing a label anywhere it is editable today still beats the
  AI subject, and the automatic pass skips any ticket that already has a manual override.
- **One-time backfill of open placeholder tickets only** (the 19 above). Closed tickets are
  deliberately left alone — closed-period reporting stays byte-identical.

## What deliberately does not change

- **No Intercom write.** No new write-through action; `esh-write-action` untouched.
- **The SLA engine keeps reading the raw Intercom subject** off `raw_payload.source` to infer
  email vs messenger intake. An AI label must never move a measurement.
- **Severity eval sampling keeps the raw subject** — eval inputs must reflect what the model saw.
- **Closed tickets are not rewritten**, by either the scheduled pass or the backfill.
