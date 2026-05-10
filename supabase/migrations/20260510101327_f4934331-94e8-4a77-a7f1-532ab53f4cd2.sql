CREATE TABLE public.monthly_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  source text NOT NULL DEFAULT 'intercom',
  generated_at timestamptz NOT NULL DEFAULT now(),
  ticket_count integer NOT NULL DEFAULT 0,
  buckets jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_area_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_summary text NOT NULL DEFAULT '',
  UNIQUE (month, source)
);

ALTER TABLE public.monthly_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read monthly_insights"
  ON public.monthly_insights FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert monthly_insights"
  ON public.monthly_insights FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update monthly_insights"
  ON public.monthly_insights FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete monthly_insights"
  ON public.monthly_insights FOR DELETE TO authenticated USING (true);