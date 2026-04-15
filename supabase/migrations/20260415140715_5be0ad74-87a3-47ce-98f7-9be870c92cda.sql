
-- ============================================
-- SETTINGS: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read settings" ON public.settings;
DROP POLICY IF EXISTS "Allow public update settings" ON public.settings;

CREATE POLICY "Allow authenticated read settings"
  ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated update settings"
  ON public.settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- GMAIL_CONVERSATIONS: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read gmail_conversations" ON public.gmail_conversations;
DROP POLICY IF EXISTS "Allow public update gmail_conversations" ON public.gmail_conversations;

CREATE POLICY "Allow authenticated read gmail_conversations"
  ON public.gmail_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated update gmail_conversations"
  ON public.gmail_conversations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- CONVERSATION_MAPPINGS: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read conversation_mappings" ON public.conversation_mappings;
DROP POLICY IF EXISTS "Allow public update conversation_mappings" ON public.conversation_mappings;

CREATE POLICY "Allow authenticated read conversation_mappings"
  ON public.conversation_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated update conversation_mappings"
  ON public.conversation_mappings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- CONVERSATION_AUDIT_LOGS: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read conversation_audit_logs" ON public.conversation_audit_logs;
DROP POLICY IF EXISTS "Allow public insert conversation_audit_logs" ON public.conversation_audit_logs;

CREATE POLICY "Allow authenticated read conversation_audit_logs"
  ON public.conversation_audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert conversation_audit_logs"
  ON public.conversation_audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================
-- CONVERSATION_NOTES: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read conversation_notes" ON public.conversation_notes;
DROP POLICY IF EXISTS "Allow public insert conversation_notes" ON public.conversation_notes;
DROP POLICY IF EXISTS "Allow public delete conversation_notes" ON public.conversation_notes;

CREATE POLICY "Allow authenticated read conversation_notes"
  ON public.conversation_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert conversation_notes"
  ON public.conversation_notes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated delete conversation_notes"
  ON public.conversation_notes FOR DELETE TO authenticated USING (true);

-- ============================================
-- MANUAL_CONVERSATIONS: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read manual_conversations" ON public.manual_conversations;
DROP POLICY IF EXISTS "Allow public insert manual_conversations" ON public.manual_conversations;
DROP POLICY IF EXISTS "Allow public update manual_conversations" ON public.manual_conversations;
DROP POLICY IF EXISTS "Allow public delete manual_conversations" ON public.manual_conversations;

CREATE POLICY "Allow authenticated read manual_conversations"
  ON public.manual_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert manual_conversations"
  ON public.manual_conversations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update manual_conversations"
  ON public.manual_conversations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete manual_conversations"
  ON public.manual_conversations FOR DELETE TO authenticated USING (true);

-- ============================================
-- MANUAL_MESSAGES: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read manual_messages" ON public.manual_messages;
DROP POLICY IF EXISTS "Allow public insert manual_messages" ON public.manual_messages;
DROP POLICY IF EXISTS "Allow public update manual_messages" ON public.manual_messages;
DROP POLICY IF EXISTS "Allow public delete manual_messages" ON public.manual_messages;

CREATE POLICY "Allow authenticated read manual_messages"
  ON public.manual_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert manual_messages"
  ON public.manual_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update manual_messages"
  ON public.manual_messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete manual_messages"
  ON public.manual_messages FOR DELETE TO authenticated USING (true);

-- ============================================
-- BOT_MESSAGES: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read bot_messages" ON public.bot_messages;
DROP POLICY IF EXISTS "Allow public update bot_messages" ON public.bot_messages;

CREATE POLICY "Allow authenticated read bot_messages"
  ON public.bot_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated update bot_messages"
  ON public.bot_messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- KNOWLEDGE_DOCUMENTS: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read knowledge_documents" ON public.knowledge_documents;
DROP POLICY IF EXISTS "Allow public update knowledge_documents" ON public.knowledge_documents;

CREATE POLICY "Allow authenticated read knowledge_documents"
  ON public.knowledge_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated update knowledge_documents"
  ON public.knowledge_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- FLOW_NODE_POSITIONS: restrict to authenticated
-- ============================================
DROP POLICY IF EXISTS "Allow public read flow_node_positions" ON public.flow_node_positions;
DROP POLICY IF EXISTS "Allow public insert flow_node_positions" ON public.flow_node_positions;
DROP POLICY IF EXISTS "Allow public update flow_node_positions" ON public.flow_node_positions;

CREATE POLICY "Allow authenticated read flow_node_positions"
  ON public.flow_node_positions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert flow_node_positions"
  ON public.flow_node_positions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update flow_node_positions"
  ON public.flow_node_positions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- STORAGE: Deny public writes to public-assets
-- ============================================
CREATE POLICY "Deny public insert public-assets"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (bucket_id != 'public-assets');

CREATE POLICY "Deny public update public-assets"
  ON storage.objects FOR UPDATE TO public
  USING (bucket_id != 'public-assets');

CREATE POLICY "Deny public delete public-assets"
  ON storage.objects FOR DELETE TO public
  USING (bucket_id != 'public-assets');
