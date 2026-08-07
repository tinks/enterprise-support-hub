ALTER TABLE public.teammates
  ADD COLUMN IF NOT EXISTS show_dashboard boolean NOT NULL DEFAULT false;

UPDATE public.teammates
SET show_dashboard = true
WHERE name IN ('Joel', 'Kristina', 'Tine', 'Eren', 'Matt');