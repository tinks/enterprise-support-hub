---
name: Cross-thread link guard
description: Option 2 inverse-uniqueness guard in intercom-webhook that refuses to stamp a second Gmail thread on an Intercom ticket already linked to a different thread; posts shielded alerts to #enterprise-support-hub-alerts
type: feature
---

Location: `supabase/functions/intercom-webhook/index.ts`.

Two guard sites:
- **Email tier** (~line 410): after `gmail_conversations` email matches, checks for any prior link of `intercom_conversation_id` to a different `gmail_thread_id`. If found, returns 200 with `"refusing cross-thread link"` and does not write.
- **Subject tier** (~line 535): same check after subject-based match.

Both sites log `[cross_thread_link_conflict:email|subject]` and call `postGuardAlert()` which posts a `:shield:` block message to Slack channel `C0B9NSBM60H` (`#enterprise-support-hub-alerts`) using `SLACK_BOT_TOKEN` with per-message identity `username: "Support Hub Guard"`, `icon_emoji: ":shield:"`. Same bot as Support Hub Health — no extra invite needed.

`postGuardAlert` is wrapped in try/catch; Slack failures never block the guard return.

Historical conflict rate (Mar–Jun 2026): ~0.74 alerts/day — low noise, safe to send without throttling/digest.
