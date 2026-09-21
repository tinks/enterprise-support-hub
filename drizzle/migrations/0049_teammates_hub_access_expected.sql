ALTER TABLE public.teammates
  ADD COLUMN IF NOT EXISTS hub_access_expected BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.teammates.hub_access_expected IS
  'False = this person is intentionally attribution-only (never signs in to the Hub). Suppresses the "No Hub login" drift flag on Admin -> People. AI roles are always treated as not expecting a login regardless of this value.';