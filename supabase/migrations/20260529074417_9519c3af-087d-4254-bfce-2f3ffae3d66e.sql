
-- Explicitly deny anon/public access to sensitive tables.
-- Existing permissive policies are scoped to authenticated; these RESTRICTIVE
-- policies make the block explicit for scanners and defense-in-depth.

REVOKE ALL ON public.conversation_notes FROM anon, PUBLIC;
REVOKE ALL ON public.manual_conversations FROM anon, PUBLIC;
REVOKE ALL ON public.manual_messages FROM anon, PUBLIC;

CREATE POLICY "Deny anon access conversation_notes"
ON public.conversation_notes
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "Deny anon access manual_conversations"
ON public.manual_conversations
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY "Deny anon access manual_messages"
ON public.manual_messages
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);
