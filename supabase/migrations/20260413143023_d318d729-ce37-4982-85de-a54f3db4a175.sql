CREATE TABLE public.conversation_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL,
  conversation_source text NOT NULL,
  action text NOT NULL,
  old_value text,
  new_value text,
  performed_by text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.conversation_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read conversation_audit_logs"
  ON public.conversation_audit_logs FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert conversation_audit_logs"
  ON public.conversation_audit_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Deny public update conversation_audit_logs"
  ON public.conversation_audit_logs FOR UPDATE
  USING (false);

CREATE POLICY "Deny public delete conversation_audit_logs"
  ON public.conversation_audit_logs FOR DELETE
  USING (false);

CREATE INDEX idx_audit_logs_conversation ON public.conversation_audit_logs (conversation_id, conversation_source);