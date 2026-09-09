CREATE POLICY "deny_all_cron_auth" ON public.cron_auth
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_all_gmail_oauth_states" ON public.gmail_oauth_states
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.cron_auth IS 'Service-role only. Explicit deny-all RLS for anon/authenticated.';
COMMENT ON TABLE public.gmail_oauth_states IS 'Service-role only. Explicit deny-all RLS for anon/authenticated.';