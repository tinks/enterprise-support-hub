CREATE TABLE public.intercom_field_options (
  attr_key text NOT NULL,
  option_value text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attr_key, option_value)
);

GRANT SELECT ON public.intercom_field_options TO authenticated;
GRANT ALL ON public.intercom_field_options TO service_role;

ALTER TABLE public.intercom_field_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read intercom field options"
ON public.intercom_field_options
FOR SELECT
TO authenticated
USING (true);
