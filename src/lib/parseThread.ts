export const ADMIN_OPTIONS = [
  { name: "Joel Samuelson", slackId: "U091GANMA2U" },
  { name: "Kristina Bodurova", slackId: "U0AFU714807" },
];

export const ADMIN_NAMES = ADMIN_OPTIONS.map((a) => a.name.toLowerCase());

export interface ParsedMessage {
  role: "user" | "admin";
  sender_name: string;
  message_text: string;
  sent_at?: string; // raw timestamp string, e.g. "1:47 PM" or "Mar 26th at 11:03 AM" or "3/26/2025 11:03 AM"
}

export function cleanBody(body: string): string {
  return body
    .replace(/^\d+\s+repl(y|ies).*$/gm, "")
    .replace(/\(edited\)/g, "")
    .replace(/^:[\w_]+:.*$/gm, "")
    .trim();
}

/**
 * Combine a base date with a parsed time string into an ISO datetime.
 * Handles:
 * - Time only: "1:47 PM" → uses baseDate for the date portion
 * - Month-day + time: "Mar 26th at 11:03 AM" → uses year from baseDate
 * - Full date + time: "3/26/2025 11:03 AM" → ignores baseDate entirely
 */
export function combineDateTime(baseDate: Date, timeStr?: string): string | undefined {
  if (!timeStr) return undefined;

  // Format D: full date "3/26/2025 11:03 AM"
  const fullDateMatch = timeStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}:\d{2}\s?(?:AM|PM))$/i);
  if (fullDateMatch) {
    const [, month, day, yearRaw, time] = fullDateMatch;
    const year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw) : parseInt(yearRaw);
    const d = new Date(`${parseInt(month)}/${parseInt(day)}/${year} ${time}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  // Format B: "Mar 26th at 11:03 AM"
  const monthDayMatch = timeStr.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+(\d{1,2}:\d{2}\s?(?:AM|PM))$/i);
  if (monthDayMatch) {
    const [, monthName, day, time] = monthDayMatch;
    const year = baseDate.getFullYear();
    const d = new Date(`${monthName} ${parseInt(day)}, ${year} ${time}`);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  // Time only: "1:47 PM"
  const timeOnly = timeStr.match(/^(\d{1,2}:\d{2}\s?(?:AM|PM))$/i);
  if (timeOnly) {
    const d = new Date(baseDate);
    const parsed = new Date(`1/1/2000 ${timeOnly[1]}`);
    if (isNaN(parsed.getTime())) return undefined;
    d.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
    return d.toISOString();
  }

  return undefined;
}

export function parseThread(raw: string): ParsedMessage[] {
  // Format A: "Name  [1:47 PM]" or "Name [1:47 PM]" — single line
  const regexA = /^(.+?)\s{1,}\[(\d{1,2}:\d{2}\s?(?:AM|PM))\]\s*$/gm;
  let parts: { name: string; startIdx: number; timeStr: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regexA.exec(raw)) !== null) {
    parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: match[2].trim() });
  }

  // Format B: Name on one line, then "  Mar 26th at 11:03 AM" on the next
  if (parts.length === 0) {
    const regexB = /^(\S.+)\n\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexB.exec(raw)) !== null) {
      // Capture the full date+time portion for Format B
      const fullLine = match[0];
      const dateTimePart = fullLine.slice(fullLine.indexOf("\n")).trim();
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: dateTimePart });
    }
  }

  // Format C: "Name  5:43 AM" — no brackets, 2+ spaces before time
  if (parts.length === 0) {
    const regexC = /^(.+?)\s{2,}(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexC.exec(raw)) !== null) {
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: match[2].trim() });
    }
  }

  // Format D: Teams — "Name  3/26/2025 11:03 AM" (date + time, 2+ spaces)
  if (parts.length === 0) {
    const regexD = /^(.+?)\s{2,}(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexD.exec(raw)) !== null) {
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: `${match[2].trim()} ${match[3].trim()}` });
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
      sent_at: parts[i].timeStr,
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

  return (data.messages as Array<{ sender_name: string; message_text: string; sent_at?: string }>).map((m) => {
    const isAdmin = ADMIN_NAMES.some((n) => m.sender_name.toLowerCase().includes(n));
    return {
      role: isAdmin ? "admin" : "user",
      sender_name: m.sender_name,
      message_text: m.message_text,
      sent_at: m.sent_at,
    } as ParsedMessage;
  });
}
