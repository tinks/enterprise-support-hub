ALTER TABLE conversation_mappings ADD COLUMN is_feature_request boolean NOT NULL DEFAULT false;
ALTER TABLE gmail_conversations ADD COLUMN is_feature_request boolean NOT NULL DEFAULT false;