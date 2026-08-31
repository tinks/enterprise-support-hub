-- Relay-only roster class: CSMs are on the roster for Slack relay attribution
-- but are NOT Intercom admins and must NOT count for First Response.
ALTER TABLE public.teammates ALTER COLUMN intercom_admin_id DROP NOT NULL;

ALTER TABLE public.teammates DROP CONSTRAINT IF EXISTS teammates_role_check;
ALTER TABLE public.teammates
  ADD CONSTRAINT teammates_role_check
  CHECK (role = ANY (ARRAY['support'::text, 'csm'::text, 'other'::text, 'ai'::text]));

-- A relay-only row must carry a Slack identity to be resolvable.
ALTER TABLE public.teammates DROP CONSTRAINT IF EXISTS teammates_identity_check;
ALTER TABLE public.teammates
  ADD CONSTRAINT teammates_identity_check
  CHECK (intercom_admin_id IS NOT NULL OR slack_user_id IS NOT NULL OR email IS NOT NULL);