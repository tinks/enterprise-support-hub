CREATE TABLE public.new_ticket_alerts (
  intercom_conversation_id text PRIMARY KEY,
  slack_channel_id text NOT NULL,
  slack_ts text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.new_ticket_alerts TO authenticated;
GRANT ALL ON public.new_ticket_alerts TO service_role;
ALTER TABLE public.new_ticket_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "new_ticket_alerts_select_authenticated" ON public.new_ticket_alerts FOR SELECT TO authenticated USING (true);