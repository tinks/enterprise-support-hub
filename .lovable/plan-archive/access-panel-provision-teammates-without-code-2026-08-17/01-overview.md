# Access panel — provision teammates without code

Today signups are closed, so adding a person means asking me to create the account. This adds an **Access** card in Settings (admin-only) where you manage the approved-people list yourself.

## How it works

1. You add an email to the allowlist (must end in `@lovable.dev`; the panel rejects anything else).
2. One click on **Provision** creates their account in the backend and marks the row `active`.
3. They sign in with Google using that address — the Google identity attaches to the account you created. No password, no invite email.
4. **Remove access** (with a confirmation dialog) deletes their account and marks the row `revoked`. They can no longer sign in; the row stays as a record of who had access and when.

Signup stays closed, so nobody outside the list can ever create an account — the allowlist is the only way in.

## Why not auto-provision on first sign-in

With self-signup disabled the backend rejects an unknown Google user before any app code runs, so there's no hook to auto-approve them. Re-enabling signup would reopen the original security finding. The one-click Provision keeps signup closed and still leaves you fully in control from the UI.
