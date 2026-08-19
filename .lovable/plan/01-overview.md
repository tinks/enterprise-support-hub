# Training foundation for the severity classifier

## The honest answer to your question

You are right that a complete loop matters, and right that disagreement carries more information than agreement. You are wrong about one word: **training**. Nothing here fine-tunes a model, and with the data you have today nothing could — `severity_proposals` currently holds 3 rows (2 open, 1 accepted). Fine-tuning a classifier wants hundreds to low thousands of clean labels, and even then it buys less than a good rubric does on a 4-class judgement task.

What actually makes a classifier like this improve, in order of leverage:

1. **A better rubric.** The model reads your rubric on every call. One sharpened line ("data loss to a paying enterprise workspace is always Sev 1, regardless of ticket count") changes every future call permanently. This is where nearly all the gain lives.
2. **Better examples in the prompt.** The function already pastes the 12 most recent human decisions into each call — short-term memory, effective and cheap, but it forgets anything older than the window.
3. **Fine-tuning.** Only worth considering after a few hundred labeled tickets, and probably never here.

So the foundation to build is not a training pipeline. It is a **labeled decision corpus plus a way to measure whether a rubric change helped**. Without measurement, editing the rubric is guessing with extra steps.

## Where the current loop leaks

Verified in `propose-severity` and `severity_proposals`:

- **No reason on disagreement.** An override records the number the human chose, never why. Your highest-value signal is discarded at the moment it is created.
- **Few-shot examples are the model's own words.** The example block is built from the AI's `evidence`/`rationale`, not the ticket. When the AI misread the ticket, the corrected example teaches the right number attached to the *wrong* description — it can reinforce the misreading.
- **No memory past 12 decisions.** Older corrections fall out of the window and vanish.
- **No way to tell whether a change helped.** There is no held-out set, no re-run, no before/after agreement number. Any rubric edit today is unfalsifiable.

## The showdown is the right instinct — and it's cheaper than you think

You don't need to hand-label anything. **503 of the 539 tickets in `intercom_tickets_v3` already carry a human Severity** in their Intercom custom attributes. That is a ready-made answer key: pick N at random, ask the classifier cold, compare. One run takes the corpus from 3 decisions to a few hundred, today.

Two honest caveats, both handled below:

- **The answer key is imperfect.** Some of those severities were set at close, in a hurry, or by whoever was nearest. Disagreements are therefore two-sided — sometimes the AI is wrong, sometimes the ticket is. The showdown surfaces both, and you adjudicate.
- **Keep it quarantined.** Backfill scores must not pollute the live proposal path, the override statistics, or the few-shot window until you have said a given row is a fair label. It lands in its own table and gets promoted by hand.

## What this plan builds

Four parts: the random showdown that bootstraps the corpus, capture of the disagreement reason on real decisions, real ticket text in the few-shot examples, and a backtest so every rubric edit is scored instead of guessed.

