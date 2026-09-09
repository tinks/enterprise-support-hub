CREATE TABLE public.pax_investigations (
  intercom_conversation_id text PRIMARY KEY,
  slack_channel_id text NOT NULL,
  slack_thread_ts text NOT NULL,
  slack_permalink text,
  note_state text NOT NULL DEFAULT 'pending',
  note_error text,
  note_linked_at timestamptz,
  requested_by uuid,
  requested_by_name text,
  requested_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pax_investigations_note_state_chk CHECK (note_state IN ('pending','linked','failed'))
);

GRANT SELECT ON public.pax_investigations TO authenticated;
GRANT ALL ON public.pax_investigations TO service_role;

ALTER TABLE public.pax_investigations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pax investigations"
ON public.pax_investigations FOR SELECT TO authenticated USING (true);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS pax_help_channel_id text,
  ADD COLUMN IF NOT EXISTS pax_request_template text;
