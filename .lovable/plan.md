

## Fix "Back to stats" navigation

**Problem**: The "Back to stats" button navigates to `/stats` which is a 404. The Stats page is mounted at `/`.

**Change**: In `src/pages/Conversations.tsx`, change `navigate("/stats")` to `navigate("/")`.

