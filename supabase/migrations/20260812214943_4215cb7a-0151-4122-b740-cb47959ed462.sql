CREATE TABLE public.float_coverage_shifts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_user_id text NOT NULL,
  display_name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  time_zone text NOT NULL DEFAULT 'America/Los_Angeles',
  active boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT float_coverage_shifts_range_ok CHECK (ends_on >= starts_on),
  CONSTRAINT float_coverage_shifts_window_ok CHECK (start_time <> end_time)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.float_coverage_shifts TO authenticated;
GRANT ALL ON public.float_coverage_shifts TO service_role;

ALTER TABLE public.float_coverage_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view float coverage shifts"
  ON public.float_coverage_shifts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert float coverage shifts"
  ON public.float_coverage_shifts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update float coverage shifts"
  ON public.float_coverage_shifts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete float coverage shifts"
  ON public.float_coverage_shifts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER float_coverage_shifts_set_updated_at
  BEFORE UPDATE ON public.float_coverage_shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX float_coverage_shifts_active_range_idx
  ON public.float_coverage_shifts (active, starts_on, ends_on);

ALTER TABLE public.teammates ADD COLUMN IF NOT EXISTS slack_user_id text;