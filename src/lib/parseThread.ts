export const ADMIN_OPTIONS = [
  { name: "Joel Samuelson", slackId: "U091GANMA2U" },
  { name: "Kristina Bodurova", slackId: "U0AFU714807" },
];

export const ADMIN_NAMES = ADMIN_OPTIONS.map((a) => a.name.toLowerCase());

export interface ParsedMessage {
  role: "user" | "admin";
  sender_name: string;
  message_text: string;
}

export function cleanBody(body: string): string {
  return body
    .replace(/^\d+\s+repl(y|ies).*$/gm, "")
    .replace(/\(edited\)/g, "")
    .replace(/^:[\w_]+:.*$/gm, "")
    .trim();
}

export function parseThread(raw: string): ParsedMessage[] {
  // Format A: "Name  [1:47 PM]" or "Name [1:47 PM]" — single line
  const regexA = /^(.+?)\s{1,}\[(\d{1,2}:\d{2}\s?(?:AM|PM))\]\s*$/gm;
  let parts: { name: string; startIdx: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regexA.exec(raw)) !== null) {
    parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length });
  }

  // Format B: Name on one line, then "  Mar 26th at 11:03 AM" on the next
  if (parts.length === 0) {
    const regexB = /^(\S.+)\n\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexB.exec(raw)) !== null) {
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length });
    }
  }

  // Format C: "Name  5:43 AM" — no brackets, 2+ spaces before time
  if (parts.length === 0) {
    const regexC = /^(.+?)\s{2,}(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexC.exec(raw)) !== null) {
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length });
    }
  }

  // Format D: Teams — "Name  3/26/2025 11:03 AM" (date + time, 2+ spaces)
  if (parts.length === 0) {
    const regexD = /^(.+?)\s{2,}(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexD.exec(raw)) !== null) {
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length });
    }
  }

  if (parts.length === 0) return [];

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < parts.length; i++) {
    const endIdx = i + 1 < parts.length ? raw.lastIndexOf("\n", raw.indexOf(parts[i + 1].name, parts[i].startIdx)) : raw.length;
    let body = cleanBody(raw.slice(parts[i].startIdx, endIdx));
    if (!body) continue;
    const isAdmin = ADMIN_NAMES.some((n) => parts[i].name.toLowerCase().includes(n));
    messages.push({
      role: isAdmin ? "admin" : "user",
      sender_name: parts[i].name,
      message_text: body,
    });
  }
  return messages;
}

export async function parseThreadWithAI(raw: string): Promise<ParsedMessage[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("parse-thread", {
    body: { rawThread: raw },
  });

  if (error || !data?.messages) return [];

  return (data.messages as Array<{ sender_name: string; message_text: string }>).map((m) => {
    const isAdmin = ADMIN_NAMES.some((n) => m.sender_name.toLowerCase().includes(n));
    return {
      role: isAdmin ? "admin" : "user",
      sender_name: m.sender_name,
      message_text: m.message_text,
    } as ParsedMessage;
  });
}
