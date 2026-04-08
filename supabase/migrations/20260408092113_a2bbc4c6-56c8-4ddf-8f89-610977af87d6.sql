CREATE TABLE conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  conversation_source text NOT NULL DEFAULT 'slack',
  author text NOT NULL DEFAULT '',
  note_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read conversation_notes" ON conversation_notes FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert conversation_notes" ON conversation_notes FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public delete conversation_notes" ON conversation_notes FOR DELETE TO public USING (true);

CREATE INDEX idx_conversation_notes_lookup ON conversation_notes (conversation_id, conversation_source);