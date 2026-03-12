
CREATE TABLE public.bot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_key text UNIQUE NOT NULL,
  message_text text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to bot_messages"
  ON public.bot_messages
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_bot_messages_updated_at
  BEFORE UPDATE ON public.bot_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.bot_messages (message_key, message_text, description) VALUES
  ('context_prompt', '👋 Optionally add your Lovable account email and/or project link to improve support. If you don''t want to share this, just click *Proceed*.', 'Sent when a user @mentions the bot — prompts them to add details or proceed'),
  ('ticket_created_ack', '✅ Thanks! Generating a response... Should take about 3-4 minutes.', 'Acknowledgment after ticket is created in Intercom'),
  ('feedback_positive', '✅ Glad that helped! Marking as resolved.', 'Sent when user clicks the positive feedback button'),
  ('escalation_notice', '🔄 Escalating to human support. A ticket has been created and a member of our Enterprise support team will follow up shortly.', 'Sent when user clicks escalate to human'),
  ('reply_forwarded', '🔄 Your reply has been sent. A member of our Enterprise support team will follow up shortly.', 'Sent when a user replies in the Slack thread after escalation'),
  ('conversation_closed', '✅ This issue has been marked as resolved. If you need further help, reply in this thread to start the conversation again.', 'Sent when conversation is closed in Intercom');
