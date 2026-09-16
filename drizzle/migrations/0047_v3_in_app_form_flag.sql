ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS is_in_app_form boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_app_form_source text;

COMMENT ON COLUMN public.intercom_tickets_v3.is_in_app_form IS
  'True when the ticket was created via the in-app support request form. Set by sync from an Intercom tag/custom attribute (durable) or the subject/body signature (fallback).';
COMMENT ON COLUMN public.intercom_tickets_v3.in_app_form_source IS
  'How is_in_app_form was decided: tag | attribute | signature.';

CREATE INDEX IF NOT EXISTS idx_v3_in_app_form
  ON public.intercom_tickets_v3 (intercom_created_at DESC)
  WHERE is_in_app_form;