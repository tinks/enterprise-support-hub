// Shared helpers for re-hosted Slack attachments.
// Files live in the PRIVATE `customer-attachments` bucket; links handed out
// point at the `attachment` edge function, which mints a short-lived signed URL.

export const ATTACHMENT_BUCKET = "customer-attachments";
export const ATTACHMENT_PREFIX = "slack-attachments/";

export function attachmentUrl(path: string): string {
  const base = Deno.env.get("SUPABASE_URL")!;
  return `${base}/functions/v1/attachment?path=${encodeURIComponent(path)}`;
}

export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Support-safe allowlist. Deliberately broad — real support evidence includes
 * screen recordings, logs, HAR files and archives — but executables, scripts
 * and installers are always rejected.
 */
const ALLOWED_EXTENSIONS = new Set([
  // images
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "tiff",
  // video / audio
  "mov", "mp4", "webm", "m4v", "avi", "mkv", "mp3", "m4a", "wav", "ogg",
  // docs
  "pdf", "txt", "log", "md", "rtf", "csv", "tsv", "json", "yaml", "yml", "xml",
  "har", "html", "htm", "eml", "msg",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "numbers", "pages", "key",
  // archives
  "zip", "gz", "tgz", "tar", "7z", "rar",
]);

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "msi", "bat", "cmd", "com", "scr", "cpl", "jar", "app", "dmg",
  "pkg", "deb", "rpm", "apk", "sh", "bash", "zsh", "ps1", "vbs", "js", "mjs",
  "cjs", "py", "rb", "pl", "php", "so", "dylib", "bin", "iso",
]);

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Returns null when the file is acceptable, or a reason string when it is not. */
export function rejectAttachment(name: string, mimetype?: string): string | null {
  const ext = extensionOf(name);
  if (!ext) return "missing file extension";
  if (BLOCKED_EXTENSIONS.has(ext)) return `blocked file type .${ext}`;
  if (!ALLOWED_EXTENSIONS.has(ext)) return `file type .${ext} not allowed`;
  const mt = (mimetype ?? "").toLowerCase();
  if (mt.startsWith("application/x-") || mt.includes("executable")) {
    return `blocked content type ${mt}`;
  }
  return null;
}
