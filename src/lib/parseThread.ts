export const ADMIN_OPTIONS: Array<{ name: string; slackId?: string; email?: string }> = [
  { name: "Joel Samuelson", slackId: "U091GANMA2U" },
  { name: "Kristina Bodurova", slackId: "U0AFU714807" },
  { name: "Eren", email: "eren@lovable.dev" },
  { name: "Tine" },
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

const MONTHS_SHORT = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const MONTHS_LONG = ["january","february","march","april","may","june","july","august","september","october","november","december"];
function monthIndex(name: string): number {
  const n = name.toLowerCase();
  const i = MONTHS_LONG.indexOf(n);
  if (i >= 0) return i;
  return MONTHS_SHORT.indexOf(n.slice(0, 3));
}

/**
 * Attempt to infer the date a pasted Slack/Teams thread occurred on, by
 * scanning the raw text for date signals. Returns undefined if none found.
 *
 * Priority:
 *  1. Full date like "3/26/2025 11:03 AM" (Teams paste)
 *  2. Month-day like "Mar 26th at 11:03 AM" or "March 26, 2025"
 *  3. Slack relative markers "Today" / "Yesterday"
 *  4. Slack day headers like "Wednesday, March 26th"
 */
export function detectThreadDate(raw: string, now: Date = new Date()): Date | undefined {
  if (!raw) return undefined;

  // 1. Full date "3/26/2025 11:03 AM" or just "3/26/2025"
  const full = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (full) {
    const [, m, d, yRaw] = full;
    const year = yRaw.length === 2 ? 2000 + parseInt(yRaw) : parseInt(yRaw);
    const dt = new Date(year, parseInt(m) - 1, parseInt(d));
    if (!isNaN(dt.getTime())) return dt;
  }

  // 2a. Month-day with explicit year: "March 26, 2025" / "Mar 26 2025"
  const mdY = raw.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})\b/i);
  if (mdY) {
    const mi = monthIndex(mdY[1]);
    if (mi >= 0) {
      const dt = new Date(parseInt(mdY[3]), mi, parseInt(mdY[2]));
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  // 2b. Month-day no year: "Mar 26th at 11:03 AM" or "March 26th"
  const md = raw.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (md) {
    const mi = monthIndex(md[1]);
    if (mi >= 0) {
      let year = now.getFullYear();
      let dt = new Date(year, mi, parseInt(md[2]));
      // If date is in the future (>1 day), assume previous year
      if (dt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
        dt = new Date(year - 1, mi, parseInt(md[2]));
      }
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  // 3. Slack "Yesterday at …" / "Today at …"
  if (/\bYesterday\b\s+at\s+\d/i.test(raw)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (/\bToday\b\s+at\s+\d/i.test(raw)) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  return undefined;
}

export function parseThread(raw: string): ParsedMessage[] {
  // Format A: "Name  [1:47 PM]" or "Name [1:47 PM]" — single line
  const regexA = /^(.+?)\s{1,}\[(\d{1,2}:\d{2}\s?(?:AM|PM))\]\s*$/gm;
  let parts: { name: string; startIdx: number; timeStr: string; headerIdx: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regexA.exec(raw)) !== null) {
    parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: match[2].trim(), headerIdx: match.index });
  }

  // Format B: Name on one line, then "  Mar 26th at 11:03 AM" on the next
  if (parts.length === 0) {
    const regexB = /^(\S.+)\n\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexB.exec(raw)) !== null) {
      // Capture the full date+time portion for Format B
      const fullLine = match[0];
      const dateTimePart = fullLine.slice(fullLine.indexOf("\n")).trim();
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: dateTimePart, headerIdx: match.index });
    }
  }

  // Format C: "Name  5:43 AM" — no brackets, 2+ spaces before time
  if (parts.length === 0) {
    const regexC = /^(.+?)\s{2,}(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexC.exec(raw)) !== null) {
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: match[2].trim(), headerIdx: match.index });
    }
  }

  // Format D: Teams — "Name  3/26/2025 11:03 AM" (date + time, 2+ spaces)
  if (parts.length === 0) {
    const regexD = /^(.+?)\s{2,}(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm;
    while ((match = regexD.exec(raw)) !== null) {
      parts.push({ name: match[1].trim(), startIdx: match.index + match[0].length, timeStr: `${match[2].trim()} ${match[3].trim()}`, headerIdx: match.index });
    }
  }

  if (parts.length === 0) return [];

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < parts.length; i++) {
    const endIdx = i + 1 < parts.length ? parts[i + 1].headerIdx : raw.length;
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

export interface ParseThreadAIResult {
  messages: ParsedMessage[];
  subject?: string;
}

export async function parseThreadWithAI(raw: string): Promise<ParseThreadAIResult> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("parse-thread", {
    body: { rawThread: raw },
  });

  if (error || !data?.messages) return { messages: [] };

  const messages = (data.messages as Array<{ sender_name: string; message_text: string; sent_at?: string }>).map((m) => {
    const isAdmin = ADMIN_NAMES.some((n) => m.sender_name.toLowerCase().includes(n));
    return {
      role: isAdmin ? "admin" : "user",
      sender_name: m.sender_name,
      message_text: m.message_text,
      sent_at: m.sent_at,
    } as ParsedMessage;
  });

  const subject = typeof data.subject === "string" && data.subject.trim() ? data.subject.trim() : undefined;
  return { messages, subject };
}
