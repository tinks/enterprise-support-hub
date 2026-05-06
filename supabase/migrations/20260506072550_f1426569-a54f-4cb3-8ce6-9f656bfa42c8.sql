CREATE POLICY "Allow authenticated update conversation_notes"
ON public.conversation_notes
FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);