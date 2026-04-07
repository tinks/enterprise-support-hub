

## Fix back button to use browser history

### Problem
The back button on the conversation detail page always navigates to `/conversations`, even when you came from `/test-review`. It should go back to wherever you came from.

### Changes

**`src/pages/ConversationDetail.tsx`**
- Replace `navigate("/conversations")` with `navigate(-1)` in both back button instances (the main one at line 773 and the "not found" one at line 454)
- `navigate(-1)` uses the browser history stack, so it correctly returns to `/test-review`, `/conversations`, or wherever the user navigated from

### Files to edit
- `src/pages/ConversationDetail.tsx`

