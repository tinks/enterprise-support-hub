
-- 1) Extend v3_customer_accounts
ALTER TABLE public.v3_customer_accounts
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS csm_owner text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}'::text[];

-- 2) v3_channel_account_map
CREATE TABLE IF NOT EXISTS public.v3_channel_account_map (
  slack_channel_id text PRIMARY KEY,
  account_key text NOT NULL REFERENCES public.v3_customer_accounts(account_key) ON UPDATE CASCADE ON DELETE RESTRICT,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.v3_channel_account_map TO authenticated;
GRANT ALL ON public.v3_channel_account_map TO service_role;

ALTER TABLE public.v3_channel_account_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "v3_channel_account_map readable by authenticated"
  ON public.v3_channel_account_map FOR SELECT
  USING (true);

CREATE POLICY "v3_channel_account_map admin write"
  ON public.v3_channel_account_map FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_v3_channel_account_map_updated_at
  BEFORE UPDATE ON public.v3_channel_account_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) intercom_tickets_v3 new columns
ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS customer_confidence text,
  ADD COLUMN IF NOT EXISTS customer_resolution_method text,
  ADD COLUMN IF NOT EXISTS custom_attributes jsonb;

CREATE INDEX IF NOT EXISTS intercom_tickets_v3_custom_attributes_gin
  ON public.intercom_tickets_v3 USING GIN (custom_attributes);

-- 4) v3_ticket_attributes
CREATE TABLE IF NOT EXISTS public.v3_ticket_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.intercom_tickets_v3(id) ON DELETE CASCADE,
  attr_key text NOT NULL,
  attr_value_text text,
  attr_value_num numeric,
  attr_value_bool boolean,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, attr_key)
);

CREATE INDEX IF NOT EXISTS v3_ticket_attributes_key_text_idx
  ON public.v3_ticket_attributes (attr_key, attr_value_text);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.v3_ticket_attributes TO authenticated;
GRANT ALL ON public.v3_ticket_attributes TO service_role;

ALTER TABLE public.v3_ticket_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "v3_ticket_attributes readable by authenticated"
  ON public.v3_ticket_attributes FOR SELECT
  USING (true);

CREATE POLICY "v3_ticket_attributes admin write"
  ON public.v3_ticket_attributes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
