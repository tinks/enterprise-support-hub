
DROP POLICY IF EXISTS "Deny public delete manual_conversations" ON public.manual_conversations;
CREATE POLICY "Allow public delete manual_conversations" ON public.manual_conversations FOR DELETE TO public USING (true);

DROP POLICY IF EXISTS "Deny public delete manual_messages" ON public.manual_messages;
CREATE POLICY "Allow public delete manual_messages" ON public.manual_messages FOR DELETE TO public USING (true);
