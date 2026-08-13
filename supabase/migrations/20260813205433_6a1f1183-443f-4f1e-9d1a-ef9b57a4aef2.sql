ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS notion_registry_page_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notion_registry_hash text,
  ADD COLUMN IF NOT EXISTS notion_registry_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS notion_registry_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS notion_registry_domain_count integer;

UPDATE public.settings
SET notion_registry_page_id = '3bbe969ca5a280d298f3c0c43e51cf87'
WHERE coalesce(notion_registry_page_id, '') = '';