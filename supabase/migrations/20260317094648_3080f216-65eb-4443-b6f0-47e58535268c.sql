INSERT INTO public.bot_messages (message_key, message_text, description)
VALUES (
  'internal_note',
  'Internal note for Sam: This is a request from an enterprise customer reaching out via Slack. Do not escalate to the product experience team. Do not reference this in any reply to the user.',
  'Hidden context appended to the Intercom conversation body — gives Sam anti-escalation instructions'
);