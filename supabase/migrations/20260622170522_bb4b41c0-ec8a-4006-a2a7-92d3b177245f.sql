
CREATE TABLE public.inbox_v2_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_conversation_id text NOT NULL UNIQUE,
  subject text,
  contact_name text,
  contact_email text,
  owner text,
  product_area text,
  classification text,
  status text,
  intercom_created_at timestamptz,
  intercom_updated_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.inbox_v2_tickets TO authenticated;
GRANT ALL ON public.inbox_v2_tickets TO service_role;

ALTER TABLE public.inbox_v2_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inbox v2 tickets"
  ON public.inbox_v2_tickets FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_inbox_v2_tickets_updated_at
  BEFORE UPDATE ON public.inbox_v2_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_inbox_v2_tickets_updated ON public.inbox_v2_tickets (intercom_updated_at DESC);
CREATE INDEX idx_inbox_v2_tickets_owner ON public.inbox_v2_tickets (owner);
CREATE INDEX idx_inbox_v2_tickets_product_area ON public.inbox_v2_tickets (product_area);
CREATE INDEX idx_inbox_v2_tickets_classification ON public.inbox_v2_tickets (classification);
CREATE INDEX idx_inbox_v2_tickets_status ON public.inbox_v2_tickets (status);
