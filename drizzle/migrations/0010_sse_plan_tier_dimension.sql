-- Self-serve enterprise (SSE) plan dimension. Additive only.

-- 1. Second Intercom inbox id (nullable => feature inert until configured).
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS sse_intercom_inbox_id text NOT NULL DEFAULT '';

-- 2. Plan tier on every v3 ticket. Existing rows backfill to 'enterprise'.
ALTER TABLE public.intercom_tickets_v3
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'enterprise';

ALTER TABLE public.intercom_tickets_v3
  DROP CONSTRAINT IF EXISTS intercom_tickets_v3_plan_tier_check;
ALTER TABLE public.intercom_tickets_v3
  ADD CONSTRAINT intercom_tickets_v3_plan_tier_check
  CHECK (plan_tier IN ('enterprise', 'sse'));

CREATE INDEX IF NOT EXISTS idx_intercom_tickets_v3_plan_tier
  ON public.intercom_tickets_v3 (plan_tier);

-- 3. Plan dimension on SLA policy versions. Existing versions stay enterprise.
ALTER TABLE public.sla_policy_versions
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'enterprise';

ALTER TABLE public.sla_policy_versions
  DROP CONSTRAINT IF EXISTS sla_policy_versions_plan_check;
ALTER TABLE public.sla_policy_versions
  ADD CONSTRAINT sla_policy_versions_plan_check
  CHECK (plan IN ('enterprise', 'sse'));

CREATE INDEX IF NOT EXISTS idx_sla_policy_versions_plan_effective
  ON public.sla_policy_versions (plan, effective_from DESC);