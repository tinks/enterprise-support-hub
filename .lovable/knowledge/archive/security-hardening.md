# Archive: security hardening notes

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L715

**VERIFIED (2026-08-26).** Bad-signature POST → 401 (negative case, checked). 13 live deliveries after deploy all logged `status=200`, 613–1931 ms. `intercom_webhook_failures` = 0 rows. **UNVERIFIED:** the 24-hour 503/504/520 count against the 19-failure baseline — that window has not elapsed. Replay of a stored dead-letter payload is also UNVERIFIED (no failure row has occurred yet to replay), and no replay UI exists yet.

## L1899

Verification (21 Sep 2026): typecheck and build clean. Alex K (`alexandra.kosovic@lovable.dev`, Slack `U0AQWBY6TU3`, role `csm`) was added to `teammates` and her gap row resolved — `relay_attribution_gaps` now has 0 open rows. **UNVERIFIED:** the Add-person dialog end to end, the provision branch, the role checkboxes, inline ID save and the dashboard switch were not exercised in a browser this pass (no authenticated session available).

## L1910

Verification: migration applied, generated types refreshed, typecheck clean. **UNVERIFIED:** the attribution-only checkbox, Grant access button and add-person default were not exercised in an authenticated browser this pass.

## L2632

**Verified 11 Sep 2026** with the anon key against the live project: upload to `customer-attachments` → 403 `new row violates row-level security policy`; upload to `public-assets` → 403; delete `public-assets/lovable-logo.png` → 403 `Access denied`; public read of `lovable-logo.png` → 200; public read of `knowledge-sync/project-knowledge.md` → 200. **UNVERIFIED:** an admin-session upload to `public-assets` (no admin session was minted; nothing in the app writes to that bucket from the client — `rg "storage\." src/` returns nothing).

## L2687

**Verified 21 Sep 2026:** typecheck/build clean; all three functions redeployed; `pg_policies` confirms the new SELECT predicate. **UNVERIFIED:** a live Slack upload of a rejected file type, and a read-only account hitting *Analyze by ID* (no non-editor session was available at build time).

## L2697

**Verified 21 Sep 2026:** all three functions redeployed; build clean. **UNVERIFIED:** a live rejected-extension Slack upload, and an *Analyze by ID* run against an unsynced conversation ID.
