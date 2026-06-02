REVOKE SELECT ON public.pending_intercom_links FROM anon;
CREATE POLICY "Deny anon select pending_intercom_links" ON public.pending_intercom_links AS RESTRICTIVE FOR SELECT TO anon USING (false);