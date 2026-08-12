ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS new_ticket_alert_mentions text NOT NULL DEFAULT '';

UPDATE public.settings
   SET new_ticket_alert_mentions = 'U0B7TCDJRTQ'
 WHERE new_ticket_alert_mentions = '';