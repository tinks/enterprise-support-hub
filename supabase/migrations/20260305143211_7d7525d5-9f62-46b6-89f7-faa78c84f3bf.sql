
-- Settings table (single-row config)
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  monitored_channels TEXT NOT NULL DEFAULT '',
  intercom_inbox_id TEXT NOT NULL DEFAULT '',
  intercom_assignee_id TEXT NOT NULL DEFAULT '',
  slack_bot_user_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read/write settings (no auth required for admin tool)
CREATE POLICY "Allow all access to settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);

-- Conversation mappings table
CREATE TABLE public.conversation_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  intercom_conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.conversation_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to conversation_mappings" ON public.conversation_mappings FOR ALL USING (true) WITH CHECK (true);

-- Index for fast lookups
CREATE UNIQUE INDEX idx_conversation_mappings_slack ON public.conversation_mappings (slack_channel_id, slack_thread_ts);
CREATE INDEX idx_conversation_mappings_intercom ON public.conversation_mappings (intercom_conversation_id);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conversation_mappings_updated_at BEFORE UPDATE ON public.conversation_mappings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings row
INSERT INTO public.settings (monitored_channels, intercom_inbox_id, intercom_assignee_id, slack_bot_user_id)
VALUES ('', '', '', '');
