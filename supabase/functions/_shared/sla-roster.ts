// Support roster loader for the shared SLA core. Mirrors the frontend hook
// (`useSlaBatch`): role='support' ONLY (Sam is role='ai'), inactive rows
// INCLUDED (departed teammates still answered historical tickets).

import type { SupportRoster } from "./sla-core.ts";
import { registerAnchorTeamIds } from "./sla-core.ts";

export async function loadSupportRoster(supabase: any): Promise<SupportRoster> {
  const supportEmails = new Set<string>();
  const supportAdminIds = new Set<string>();
  const supportSlackNames = new Set<string>();

  const { data, error } = await supabase
    .from("teammates")
    .select("intercom_admin_id,email,name")
    .eq("role", "support");

  if (error) {
    // Empty roster → the engine falls back to any-human_admin, exactly as the
    // frontend does on error. Never silently score with a partial roster.
    return { supportEmails, supportAdminIds, supportSlackNames };
  }

  const addName = (v: string | null | undefined) => {
    const s = (v ?? "").trim().toLowerCase();
    if (s.length >= 3) supportSlackNames.add(s);
  };

  for (const r of (data ?? []) as Array<{ intercom_admin_id: string | null; email: string | null; name: string | null }>) {
    if (r.email) supportEmails.add(r.email.trim().toLowerCase());
    if (r.intercom_admin_id) supportAdminIds.add(String(r.intercom_admin_id).trim());
    if (r.name) {
      addName(r.name);
      addName(r.name.trim().split(/\s+/)[0]);
    }
    if (r.email) addName(r.email.split("@")[0]);
  }

  return { supportEmails, supportAdminIds, supportSlackNames };
}

/** Register the SSE inbox as an SLA clock-start anchor (mirrors useSlaBatch). */
export async function registerConfiguredAnchors(supabase: any): Promise<void> {
  const { data } = await supabase
    .from("settings")
    .select("sse_intercom_inbox_id")
    .limit(1)
    .maybeSingle();
  const sse = (data as any)?.sse_intercom_inbox_id;
  if (sse) registerAnchorTeamIds([sse]);
}
