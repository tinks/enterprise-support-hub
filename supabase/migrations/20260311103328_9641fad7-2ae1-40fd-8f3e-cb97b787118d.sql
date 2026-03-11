ALTER TABLE public.conversation_mappings ADD COLUMN is_test boolean NOT NULL DEFAULT false;

UPDATE public.conversation_mappings SET is_test = true;