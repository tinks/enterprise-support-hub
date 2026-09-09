// Shared helpers for re-hosted Slack attachments.
// Files live in the PRIVATE `customer-attachments` bucket; links handed out
// point at the `attachment` edge function, which mints a short-lived signed URL.

export const ATTACHMENT_BUCKET = "customer-attachments";
export const ATTACHMENT_PREFIX = "slack-attachments/";

export function attachmentUrl(path: string): string {
  const base = Deno.env.get("SUPABASE_URL")!;
  return `${base}/functions/v1/attachment?path=${encodeURIComponent(path)}`;
}
