CREATE TABLE public.teammates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_admin_id text UNIQUE NOT NULL,
  email text,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('support','other','ai')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teammates TO authenticated;
GRANT ALL ON public.teammates TO service_role;

ALTER TABLE public.teammates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read teammates"
  ON public.teammates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert teammates"
  ON public.teammates FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update teammates"
  ON public.teammates FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete teammates"
  ON public.teammates FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER teammates_set_updated_at
  BEFORE UPDATE ON public.teammates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.teammates (intercom_admin_id, email, name, role, active) VALUES
  ('9520895',  'lovable@parahelp.com',          'Sam',      'ai',      true),
  ('9852095',  'joel@lovable.dev',              'Joel',     'support', false),
  ('9985999',  'kristina.bodurova@lovable.dev', 'Kristina', 'support', true),
  ('10476723', 'tine@lovable.dev',              'Tine',     'support', true),
  ('10765619', 'matt.niiro@lovable.dev',        'Matt',     'support', true),
  ('10475465', 'eren@lovable.dev',              'Eren',     'support', true);