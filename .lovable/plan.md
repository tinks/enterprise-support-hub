

## Add authentication to fix broken app

### Problem
The security migration locked all tables to `authenticated`-only RLS policies, but the app has no login flow. Every query returns empty results because the anon key can't read anything.

### Solution
Add a login page with Google sign-in (managed by Lovable Cloud, no API keys needed) and email+password. Wrap all routes in a protected route component that redirects unauthenticated users to `/login`.

### Changes

**1. Configure social auth**
- Use the Configure Social Auth tool to set up Google sign-in with the Lovable managed OAuth flow
- Enable auto-confirm for email signups (this is an internal team tool, not public-facing)

**2. New file: `src/pages/Login.tsx`**
- Simple login page with email+password form and "Sign in with Google" button
- Uses `supabase.auth.signInWithPassword()` for email and `lovable.auth.signInWithOAuth("google")` for Google
- Styled to match the app's brand (coral/pink/purple gradient)
- No signup form needed initially — team members can be invited or sign up via Google

**3. New file: `src/components/ProtectedRoute.tsx`**
- Listens to `supabase.auth.onAuthStateChange()` and checks `getSession()`
- If no session, redirects to `/login`
- Shows a loading spinner while checking auth state

**4. Edit: `src/App.tsx`**
- Add `/login` route pointing to `Login.tsx`
- Wrap all other routes in `<ProtectedRoute>`

**5. Edit: `src/components/AppLayout.tsx`**
- Add a sign-out button to the sidebar (calls `supabase.auth.signOut()`)

### What this fixes
Once users sign in, their requests use the `authenticated` role, so all the existing RLS policies work correctly. Analytics, conversations, settings — everything loads again.

### Files to create/edit
- **New**: `src/pages/Login.tsx`
- **New**: `src/components/ProtectedRoute.tsx`
- **Edit**: `src/App.tsx` — add login route + protect other routes
- **Edit**: `src/components/AppLayout.tsx` — add sign-out button
- **Tool**: Configure Social Auth for Google
- **Tool**: Configure Auth to enable auto-confirm

