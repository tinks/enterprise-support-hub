CREATE OR REPLACE FUNCTION public.can_edit(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid AND role IN ('editor'::app_role, 'admin'::app_role)
  )
$$;

-- Backfill: every existing account keeps write access.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'editor'::app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- bot_messages
DROP POLICY "Allow authenticated update bot_messages" ON public.bot_messages;
CREATE POLICY "Editors can update bot_messages" ON public.bot_messages FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- changelog_entries
DROP POLICY "Authenticated can delete changelog" ON public.changelog_entries;
CREATE POLICY "Editors can delete changelog" ON public.changelog_entries FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
DROP POLICY "Authenticated can insert changelog" ON public.changelog_entries;
CREATE POLICY "Editors can insert changelog" ON public.changelog_entries FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "Authenticated can update changelog" ON public.changelog_entries;
CREATE POLICY "Editors can update changelog" ON public.changelog_entries FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- conversation_audit_logs
DROP POLICY "Allow authenticated insert conversation_audit_logs" ON public.conversation_audit_logs;
CREATE POLICY "Editors can insert conversation_audit_logs" ON public.conversation_audit_logs FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));

-- conversation_mappings
DROP POLICY "Allow authenticated update conversation_mappings" ON public.conversation_mappings;
CREATE POLICY "Editors can update conversation_mappings" ON public.conversation_mappings FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- conversation_notes
DROP POLICY "Allow authenticated delete conversation_notes" ON public.conversation_notes;
CREATE POLICY "Editors can delete conversation_notes" ON public.conversation_notes FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated insert conversation_notes" ON public.conversation_notes;
CREATE POLICY "Editors can insert conversation_notes" ON public.conversation_notes FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated update conversation_notes" ON public.conversation_notes;
CREATE POLICY "Editors can update conversation_notes" ON public.conversation_notes FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- dev_escalations
DROP POLICY "dev_escalations_insert_authenticated" ON public.dev_escalations;
CREATE POLICY "dev_escalations_insert_editor" ON public.dev_escalations FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "dev_escalations_update_authenticated" ON public.dev_escalations;
CREATE POLICY "dev_escalations_update_editor" ON public.dev_escalations FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- esh_backlog_items
DROP POLICY "backlog insert by authenticated" ON public.esh_backlog_items;
CREATE POLICY "backlog insert by editor" ON public.esh_backlog_items FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "backlog update by authenticated" ON public.esh_backlog_items;
CREATE POLICY "backlog update by editor" ON public.esh_backlog_items FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- flow_node_positions
DROP POLICY "Allow authenticated insert flow_node_positions" ON public.flow_node_positions;
CREATE POLICY "Editors can insert flow_node_positions" ON public.flow_node_positions FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated update flow_node_positions" ON public.flow_node_positions;
CREATE POLICY "Editors can update flow_node_positions" ON public.flow_node_positions FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- gmail_conversations
DROP POLICY "Allow authenticated update gmail_conversations" ON public.gmail_conversations;
CREATE POLICY "Editors can update gmail_conversations" ON public.gmail_conversations FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- inbox_v2_tickets
DROP POLICY "Authenticated users can update inbox v2 tickets" ON public.inbox_v2_tickets;
CREATE POLICY "Editors can update inbox v2 tickets" ON public.inbox_v2_tickets FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- intercom_tickets_v3
DROP POLICY "Authenticated update intercom_tickets_v3" ON public.intercom_tickets_v3;
CREATE POLICY "Editors update intercom_tickets_v3" ON public.intercom_tickets_v3 FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- knowledge_documents
DROP POLICY "Allow authenticated update knowledge_documents" ON public.knowledge_documents;
CREATE POLICY "Editors can update knowledge_documents" ON public.knowledge_documents FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- manual_conversations
DROP POLICY "Allow authenticated delete manual_conversations" ON public.manual_conversations;
CREATE POLICY "Editors can delete manual_conversations" ON public.manual_conversations FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated insert manual_conversations" ON public.manual_conversations;
CREATE POLICY "Editors can insert manual_conversations" ON public.manual_conversations FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated update manual_conversations" ON public.manual_conversations;
CREATE POLICY "Editors can update manual_conversations" ON public.manual_conversations FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- manual_messages
DROP POLICY "Allow authenticated delete manual_messages" ON public.manual_messages;
CREATE POLICY "Editors can delete manual_messages" ON public.manual_messages FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated insert manual_messages" ON public.manual_messages;
CREATE POLICY "Editors can insert manual_messages" ON public.manual_messages FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated update manual_messages" ON public.manual_messages;
CREATE POLICY "Editors can update manual_messages" ON public.manual_messages FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- monthly_insights
DROP POLICY "Allow authenticated delete monthly_insights" ON public.monthly_insights;
CREATE POLICY "Editors can delete monthly_insights" ON public.monthly_insights FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated insert monthly_insights" ON public.monthly_insights;
CREATE POLICY "Editors can insert monthly_insights" ON public.monthly_insights FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated update monthly_insights" ON public.monthly_insights;
CREATE POLICY "Editors can update monthly_insights" ON public.monthly_insights FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- settings
DROP POLICY "Allow authenticated update settings" ON public.settings;
CREATE POLICY "Editors can update settings" ON public.settings FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));

-- slack_channel_account_map
DROP POLICY "Allow authenticated delete slack_channel_account_map" ON public.slack_channel_account_map;
CREATE POLICY "Editors can delete slack_channel_account_map" ON public.slack_channel_account_map FOR DELETE TO authenticated USING (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated insert slack_channel_account_map" ON public.slack_channel_account_map;
CREATE POLICY "Editors can insert slack_channel_account_map" ON public.slack_channel_account_map FOR INSERT TO authenticated WITH CHECK (public.can_edit(auth.uid()));
DROP POLICY "Allow authenticated update slack_channel_account_map" ON public.slack_channel_account_map;
CREATE POLICY "Editors can update slack_channel_account_map" ON public.slack_channel_account_map FOR UPDATE TO authenticated USING (public.can_edit(auth.uid())) WITH CHECK (public.can_edit(auth.uid()));