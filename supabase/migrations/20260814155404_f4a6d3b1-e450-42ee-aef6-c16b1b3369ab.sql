ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS esh_write_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS esh_write_allowed_actions text[] NOT NULL DEFAULT '{}'::text[];

CREATE TABLE public.esh_ticket_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  intercom_conversation_id text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','blocked','failed')),
  actor_user_id uuid,
  actor_email text,
  actor_teammate_name text,
  actor_intercom_admin_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  intercom_status integer,
  intercom_response jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX esh_ticket_actions_conv_idx ON public.esh_ticket_actions (intercom_conversation_id, created_at DESC);
CREATE INDEX esh_ticket_actions_created_idx ON public.esh_ticket_actions (created_at DESC);

GRANT SELECT ON public.esh_ticket_actions TO authenticated;
GRANT ALL ON public.esh_ticket_actions TO service_role;

ALTER TABLE public.esh_ticket_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read ticket action log"
  ON public.esh_ticket_actions FOR SELECT TO authenticated USING (true);