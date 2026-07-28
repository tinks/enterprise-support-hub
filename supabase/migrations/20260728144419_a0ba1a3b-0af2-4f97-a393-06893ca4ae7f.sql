DROP POLICY IF EXISTS "v3_channel_account_map readable by authenticated" ON public.v3_channel_account_map;
CREATE POLICY "v3_channel_account_map readable by authenticated"
  ON public.v3_channel_account_map FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "v3_ticket_attributes readable by authenticated" ON public.v3_ticket_attributes;
CREATE POLICY "v3_ticket_attributes readable by authenticated"
  ON public.v3_ticket_attributes FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.v3_channel_account_map FROM anon;
REVOKE SELECT ON public.v3_ticket_attributes FROM anon;