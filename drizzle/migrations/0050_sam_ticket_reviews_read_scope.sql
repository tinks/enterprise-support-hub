DROP POLICY IF EXISTS "Authenticated can read sam reviews" ON public.sam_ticket_reviews;

CREATE POLICY "Editors can read sam reviews"
ON public.sam_ticket_reviews
FOR SELECT
TO authenticated
USING (public.can_edit(auth.uid()));