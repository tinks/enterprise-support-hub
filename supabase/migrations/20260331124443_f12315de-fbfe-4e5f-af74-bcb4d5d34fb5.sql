
-- 1. gmail_oauth_tokens: CRITICAL — remove all public access (edge functions use service_role which bypasses RLS)
DROP POLICY IF EXISTS "Allow all access to gmail_oauth_tokens" ON public.gmail_oauth_tokens;
CREATE POLICY "Deny all public access to gmail_oauth_tokens"
  ON public.gmail_oauth_tokens FOR ALL
  USING (false)
  WITH CHECK (false);

-- 2. gmail_conversations: restrict writes, allow reads (frontend needs SELECT)
DROP POLICY IF EXISTS "Allow all access to gmail_conversations" ON public.gmail_conversations;
CREATE POLICY "Allow public read gmail_conversations"
  ON public.gmail_conversations FOR SELECT USING (true);
CREATE POLICY "Deny public write gmail_conversations"
  ON public.gmail_conversations FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny public delete gmail_conversations"
  ON public.gmail_conversations FOR DELETE USING (false);
CREATE POLICY "Allow public update gmail_conversations"
  ON public.gmail_conversations FOR UPDATE USING (true) WITH CHECK (true);

-- 3. conversation_mappings: restrict inserts/deletes, allow reads + updates (frontend toggles test/resolved)
DROP POLICY IF EXISTS "Allow all access to conversation_mappings" ON public.conversation_mappings;
CREATE POLICY "Allow public read conversation_mappings"
  ON public.conversation_mappings FOR SELECT USING (true);
CREATE POLICY "Deny public insert conversation_mappings"
  ON public.conversation_mappings FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny public delete conversation_mappings"
  ON public.conversation_mappings FOR DELETE USING (false);
CREATE POLICY "Allow public update conversation_mappings"
  ON public.conversation_mappings FOR UPDATE USING (true) WITH CHECK (true);

-- 4. bot_messages: allow read + update (frontend edits messages), deny insert/delete
DROP POLICY IF EXISTS "Allow all access to bot_messages" ON public.bot_messages;
CREATE POLICY "Allow public read bot_messages"
  ON public.bot_messages FOR SELECT USING (true);
CREATE POLICY "Allow public update bot_messages"
  ON public.bot_messages FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Deny public insert bot_messages"
  ON public.bot_messages FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny public delete bot_messages"
  ON public.bot_messages FOR DELETE USING (false);

-- 5. settings: allow read + update (frontend updates settings), deny insert/delete
DROP POLICY IF EXISTS "Allow all access to settings" ON public.settings;
CREATE POLICY "Allow public read settings"
  ON public.settings FOR SELECT USING (true);
CREATE POLICY "Allow public update settings"
  ON public.settings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Deny public insert settings"
  ON public.settings FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny public delete settings"
  ON public.settings FOR DELETE USING (false);

-- 6. knowledge_documents: allow read + update, deny insert/delete
DROP POLICY IF EXISTS "Allow all access to knowledge_documents" ON public.knowledge_documents;
CREATE POLICY "Allow public read knowledge_documents"
  ON public.knowledge_documents FOR SELECT USING (true);
CREATE POLICY "Allow public update knowledge_documents"
  ON public.knowledge_documents FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Deny public insert knowledge_documents"
  ON public.knowledge_documents FOR INSERT WITH CHECK (false);
CREATE POLICY "Deny public delete knowledge_documents"
  ON public.knowledge_documents FOR DELETE USING (false);

-- 7. flow_node_positions: allow all (frontend creates/updates positions via upsert)
-- Keep permissive but use explicit per-operation policies
DROP POLICY IF EXISTS "Allow all access to flow_node_positions" ON public.flow_node_positions;
CREATE POLICY "Allow public read flow_node_positions"
  ON public.flow_node_positions FOR SELECT USING (true);
CREATE POLICY "Allow public insert flow_node_positions"
  ON public.flow_node_positions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update flow_node_positions"
  ON public.flow_node_positions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Deny public delete flow_node_positions"
  ON public.flow_node_positions FOR DELETE USING (false);
