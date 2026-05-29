CREATE TABLE public.slack_channel_account_map (
  slack_channel_id text PRIMARY KEY,
  account_domain text,
  account_label text NOT NULL,
  channel_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_channel_account_map TO authenticated;
GRANT ALL ON public.slack_channel_account_map TO service_role;

ALTER TABLE public.slack_channel_account_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read slack_channel_account_map"
  ON public.slack_channel_account_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert slack_channel_account_map"
  ON public.slack_channel_account_map FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update slack_channel_account_map"
  ON public.slack_channel_account_map FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete slack_channel_account_map"
  ON public.slack_channel_account_map FOR DELETE TO authenticated USING (true);
CREATE POLICY "Deny anon access slack_channel_account_map"
  ON public.slack_channel_account_map AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE TRIGGER update_slack_channel_account_map_updated_at
  BEFORE UPDATE ON public.slack_channel_account_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();