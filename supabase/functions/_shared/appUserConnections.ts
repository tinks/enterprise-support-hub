// Server-only storage for per-user connector connection keys.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptConnectionKey, encryptConnectionKey } from "./connectionKeyCrypto.ts";

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function saveConnectionKeyForUser(
  userId: string,
  connectorId: string,
  connectionAPIKey: string,
  meta: { slack_user_id?: string | null; slack_team_id?: string | null; connected_email?: string | null } = {},
) {
  const { error } = await adminClient().from("app_user_connections").upsert(
    {
      user_id: userId,
      connector_id: connectorId,
      connection_key_ciphertext: await encryptConnectionKey(connectionAPIKey),
      slack_user_id: meta.slack_user_id ?? null,
      slack_team_id: meta.slack_team_id ?? null,
      connected_email: meta.connected_email ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,connector_id" },
  );
  if (error) throw error;
}

export async function updateConnectionMeta(
  userId: string,
  connectorId: string,
  meta: { slack_user_id?: string | null; slack_team_id?: string | null; connected_email?: string | null },
) {
  await adminClient()
    .from("app_user_connections")
    .update({ ...meta, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
}

export async function getConnectionKeyForUser(
  userId: string,
  connectorId: string,
): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("app_user_connections")
    .select("connection_key_ciphertext")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (error) throw error;
  return data ? await decryptConnectionKey(data.connection_key_ciphertext as string) : null;
}

export async function getConnectionRowForUser(userId: string, connectorId: string) {
  const { data } = await adminClient()
    .from("app_user_connections")
    .select("slack_user_id, slack_team_id, connected_email, updated_at")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  return data ?? null;
}

export async function deleteConnectionForUser(userId: string, connectorId: string) {
  await adminClient()
    .from("app_user_connections")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
}
