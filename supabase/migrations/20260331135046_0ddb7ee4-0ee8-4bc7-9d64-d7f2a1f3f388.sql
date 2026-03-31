ALTER TABLE conversation_mappings
  ADD COLUMN product_area text DEFAULT NULL,
  ADD COLUMN is_bug boolean NOT NULL DEFAULT false;

ALTER TABLE gmail_conversations
  ADD COLUMN product_area text DEFAULT NULL,
  ADD COLUMN is_bug boolean NOT NULL DEFAULT false;