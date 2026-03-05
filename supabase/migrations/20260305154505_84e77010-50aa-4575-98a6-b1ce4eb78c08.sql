
-- Make intercom_conversation_id nullable for awaiting_context state
ALTER TABLE public.conversation_mappings ALTER COLUMN intercom_conversation_id DROP NOT NULL;
ALTER TABLE public.conversation_mappings ALTER COLUMN intercom_conversation_id SET DEFAULT '';

-- Change status default to awaiting_context
ALTER TABLE public.conversation_mappings ALTER COLUMN status SET DEFAULT 'awaiting_context';

-- Add columns for tracking original message and user
ALTER TABLE public.conversation_mappings ADD COLUMN original_message_text text NOT NULL DEFAULT '';
ALTER TABLE public.conversation_mappings ADD COLUMN slack_user_id text NOT NULL DEFAULT '';
