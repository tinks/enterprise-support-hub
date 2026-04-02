ALTER TABLE conversation_mappings ADD COLUMN classification text;
ALTER TABLE gmail_conversations ADD COLUMN classification text;
ALTER TABLE manual_conversations ADD COLUMN classification text;