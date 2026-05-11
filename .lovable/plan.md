## Finding

The `/insights` route exists in the app and is correctly registered. The 404 is happening before the app loads because the published site visibility is currently `private`. Browser testing showed the URL redirects to Lovable’s workspace authentication bridge first, not to the app itself.

## Plan

1. Change the published site visibility from `private` to `public`.
2. Keep the app’s own login protection unchanged, so users still need to authenticate inside Enterprise Support Hub before seeing insights data.
3. Retest `https://enterprise-support-hub.lovable.app/insights` after the visibility change to confirm it reaches the app/login flow instead of Lovable’s 404 gate.

## Result

After this, the shareable link should be:

`https://enterprise-support-hub.lovable.app/insights`

Collaborators will be able to open the URL directly, then sign in to the app if needed.