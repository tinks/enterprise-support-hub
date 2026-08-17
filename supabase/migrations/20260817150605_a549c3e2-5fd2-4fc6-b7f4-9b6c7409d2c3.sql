CREATE TABLE public.hub_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  user_id uuid,
  status text NOT NULL DEFAULT 'pending',
  note text,
  added_by uuid,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  provisioned_at timestamptz,
  blocked_at timestamptz,
  blocked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hub_members_status_check CHECK (status IN ('pending','active','blocked'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_members TO authenticated;
GRANT ALL ON public.hub_members TO service_role;

ALTER TABLE public.hub_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage hub members"
  ON public.hub_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Members read their own row"
  ON public.hub_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.hub_members_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  IF split_part(NEW.email, '@', 2) <> 'lovable.dev' THEN
    RAISE EXCEPTION 'Only @lovable.dev addresses can be granted Hub access (got %)', NEW.email;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER hub_members_validate
  BEFORE INSERT OR UPDATE ON public.hub_members
  FOR EACH ROW EXECUTE FUNCTION public.hub_members_validate();

INSERT INTO public.hub_members (email, user_id, status, provisioned_at, first_seen_at, last_seen_at, note)
SELECT lower(u.email), u.id, 'active', u.created_at, u.created_at, u.last_sign_in_at,
       'Backfilled from existing accounts'
FROM auth.users u
WHERE u.email IS NOT NULL
  AND split_part(lower(u.email), '@', 2) = 'lovable.dev'
ON CONFLICT (email) DO NOTHING;