ALTER TABLE conversation_mappings ADD COLUMN owner text;
ALTER TABLE gmail_conversations ADD COLUMN owner text;
ALTER TABLE manual_conversations ADD COLUMN owner text;