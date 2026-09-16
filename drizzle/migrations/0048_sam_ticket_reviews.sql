CREATE TABLE public.sam_ticket_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL UNIQUE,
  failure_category text,
  review_note text,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sam_ticket_reviews TO authenticated;
GRANT ALL ON public.sam_ticket_reviews TO service_role;

ALTER TABLE public.sam_ticket_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read sam reviews"
  ON public.sam_ticket_reviews FOR SELECT TO authenticated USING (true);

CREATE POLICY "Editors can insert sam reviews"
  ON public.sam_ticket_reviews FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));

CREATE POLICY "Editors can update sam reviews"
  ON public.sam_ticket_reviews FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

CREATE POLICY "Editors can delete sam reviews"
  ON public.sam_ticket_reviews FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));

CREATE TRIGGER sam_ticket_reviews_updated_at
  BEFORE UPDATE ON public.sam_ticket_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
