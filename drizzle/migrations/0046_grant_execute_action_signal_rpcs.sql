GRANT EXECUTE ON FUNCTION public.v3_unattributed_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.v3_channel_proposals_pending() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.v3_unattributed_groups() FROM anon;
REVOKE EXECUTE ON FUNCTION public.v3_channel_proposals_pending() FROM anon;