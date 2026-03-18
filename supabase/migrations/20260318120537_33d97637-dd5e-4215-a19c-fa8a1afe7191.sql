
CREATE TABLE public.knowledge_documents (
  id text NOT NULL PRIMARY KEY DEFAULT 'project-knowledge',
  content text NOT NULL DEFAULT '',
  pending_content text,
  pending_summary text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  pending_at timestamp with time zone
);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to knowledge_documents"
  ON public.knowledge_documents
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
