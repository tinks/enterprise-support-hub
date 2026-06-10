// Shared helper for recording integration health to the `integration_health` table.
// Call this from poll/webhook functions whenever an upstream API call is made so the
// Settings UI can surface auth failures and sync staleness without digging into logs.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type IntegrationKey =
  | "intercom_poll"
  | "intercom_webhook"
  | "intercom_csat"
  | "intercom_import"
  | "gmail_poll";

export type IntegrationStatus = "ok" | "auth_error" | "error";

export function classifyHttpStatus(status: number): IntegrationStatus {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "auth_error";
  return "error";
}

export async function recordIntegrationHealth(
  sb: SupabaseClient,
  integration: IntegrationKey,
  status: IntegrationStatus,
  error?: string | null,
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    if (status === "ok") {
      await sb.from("integration_health").upsert({
        integration,
        last_status: "ok",
        last_success_at: nowIso,
        last_error: null,
        consecutive_failures: 0,
        updated_at: nowIso,
      }, { onConflict: "integration" });
    } else {
      // Increment consecutive_failures via read-modify-write (low contention; once per poll)
      const { data: existing } = await sb
        .from("integration_health")
        .select("consecutive_failures")
        .eq("integration", integration)
        .maybeSingle();
      const next = (existing?.consecutive_failures || 0) + 1;
      await sb.from("integration_health").upsert({
        integration,
        last_status: status,
        last_failure_at: nowIso,
        last_error: (error || "").slice(0, 500),
        consecutive_failures: next,
        updated_at: nowIso,
      }, { onConflict: "integration" });
    }
  } catch (e) {
    console.error("[integration-health] failed to record", integration, e);
  }
}

export function makeHealthClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}
