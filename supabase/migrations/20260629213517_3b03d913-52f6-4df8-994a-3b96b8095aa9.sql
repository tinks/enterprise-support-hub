CREATE POLICY "Authenticated update intercom_tickets_v3" ON public.intercom_tickets_v3 FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
GRANT UPDATE ON public.intercom_tickets_v3 TO authenticated;
UPDATE public.intercom_tickets_v3 SET lifecycle_status = 'finalized' WHERE intercom_conversation_id = '215474632673153' AND lifecycle_status = 'reopened_after_finalize';