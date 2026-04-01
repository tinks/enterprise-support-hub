
CREATE TABLE public.manual_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'other',
  contact_name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  link text,
  status text NOT NULL DEFAULT 'active',
  is_bug boolean NOT NULL DEFAULT false,
  is_feature_request boolean NOT NULL DEFAULT false,
  is_test boolean NOT NULL DEFAULT false,
  product_area text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read manual_conversations" ON public.manual_conversations FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert manual_conversations" ON public.manual_conversations FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update manual_conversations" ON public.manual_conversations FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Deny public delete manual_conversations" ON public.manual_conversations FOR DELETE TO public USING (false);

CREATE TABLE public.manual_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.manual_conversations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  sender_name text NOT NULL DEFAULT '',
  message_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read manual_messages" ON public.manual_messages FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert manual_messages" ON public.manual_messages FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update manual_messages" ON public.manual_messages FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Deny public delete manual_messages" ON public.manual_messages FOR DELETE TO public USING (false);
