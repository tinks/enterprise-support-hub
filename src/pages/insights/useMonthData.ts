import { useEffect, useState } from "react";
import { endOfMonth, startOfMonth, parse } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { normalizeManualContact } from "./manualAccounts";

export type SourceKey = "intercom" | "slack" | "gmail" | "other";
export type RouteSource = "slack" | "gmail" | "manual";
export type AccountKind = "domain" | "slack" | "manual";

export interface NormalizedTicket {
  id: string;
  route_source: RouteSource;
  display_source: SourceKey;
  subject: string;
  customer_key: string; // account-level dedupe key
  customer_label: string; // display label (may be refined async)
  customer_kind: AccountKind;
  customer_raw_id?: string; // raw slack channel id for async name resolution
  product_area: string;
  is_bug: boolean;
  is_feature_request: boolean;
  classification: string | null;
  owner: string | null;
  status: string | null;
  csat_rating: number | null;
  created_at: string;
  resolved_at: string | null;
  intercom_conversation_id?: string | null;
}

export interface MonthData {
  loading: boolean;
  tickets: NormalizedTicket[];
  error?: string;
}

const cleanSubject = (s: string | null | undefined) =>
  (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "(no subject)";

const firstLine = (s: string | null | undefined) => {
  const t = (s || "").replace(/<[^>]+>/g, "").trim();
  const line = t.split(/\r?\n/).find(Boolean) || "";
  return line.slice(0, 160) || "(no subject)";
};

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
]);

export function accountFromEmail(email: string | null | undefined): { key: string; label: string } {
  const e = (email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0 || at === e.length - 1) return { key: "domain:unknown", label: "Unknown sender" };
  const domain = e.slice(at + 1).replace(/^www\./, "");
  if (PERSONAL_DOMAINS.has(domain)) return { key: "domain:_personal", label: "Personal email" };
  return { key: "domain:" + domain, label: domain };
}

export function extractEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase() : null;
}

export function extractSlackChannelId(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = link.match(/\/archives\/(C[A-Z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

export function useMonthData(month: string, refreshKey: number = 0): MonthData {
  const [state, setState] = useState<MonthData>({ loading: true, tickets: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ loading: true, tickets: [] });
      try {
        const monthStart = startOfMonth(parse(month + "-01", "yyyy-MM-dd", new Date()));
        const monthEnd = endOfMonth(monthStart);
        const fromIso = monthStart.toISOString();
        const toIso = monthEnd.toISOString();

        const [cmRes, gmRes, mcRes] = await Promise.all([
          supabase
            .from("conversation_mappings")
            .select("id,original_message_text,product_area,is_bug,is_feature_request,classification,owner,status,csat_rating,created_at,resolved_at,intercom_conversation_id,slack_channel_id,slack_user_name,slack_user_id,is_test")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .eq("is_test", false)
            .limit(5000),
          supabase
            .from("gmail_conversations")
            .select("id,subject,snippet,product_area,is_bug,is_feature_request,classification,owner,status,csat_rating,created_at,resolved_at,intercom_conversation_id,from_email,from_name,gmail_thread_id,is_test")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .eq("is_test", false)
            .limit(5000),
          supabase
            .from("manual_conversations")
            .select("id,subject,product_area,is_bug,is_feature_request,classification,owner,status,csat_rating,created_at,resolved_at,intercom_conversation_id,contact_name,source,link,is_test")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .eq("is_test", false)
            .limit(5000),
        ]);

        if (cmRes.error) throw cmRes.error;
        if (gmRes.error) throw gmRes.error;
        if (mcRes.error) throw mcRes.error;

        const gmailByThread = new Map<string, typeof gmRes.data[number]>();
        for (const g of gmRes.data || []) {
          const key = g.gmail_thread_id || g.id;
          const existing = gmailByThread.get(key);
          if (!existing || new Date(g.created_at) < new Date(existing.created_at)) {
            gmailByThread.set(key, g);
          }
        }

        const cmIntercomIds = new Set(
          (cmRes.data || [])
            .map(c => c.intercom_conversation_id)
            .filter((x): x is string => !!x)
        );

        const tickets: NormalizedTicket[] = [];

        for (const c of cmRes.data || []) {
          const display: SourceKey = c.intercom_conversation_id ? "intercom" : "slack";
          const cid = c.slack_channel_id || "unknown";
          tickets.push({
            id: c.id,
            route_source: "slack",
            display_source: display,
            subject: firstLine(c.original_message_text),
            customer_key: "channel:" + cid,
            customer_label: "#" + cid,
            customer_kind: "slack",
            customer_raw_id: cid,
            product_area: c.product_area || "Uncategorized",
            is_bug: !!c.is_bug,
            is_feature_request: !!c.is_feature_request,
            classification: c.classification,
            owner: c.owner,
            status: c.status,
            csat_rating: c.csat_rating,
            created_at: c.created_at,
            resolved_at: c.resolved_at,
            intercom_conversation_id: c.intercom_conversation_id,
          });
        }

        for (const g of gmailByThread.values()) {
          const email = (g.from_email || "").toLowerCase();
          const acct = accountFromEmail(email);
          tickets.push({
            id: g.id,
            route_source: "gmail",
            display_source: "gmail",
            subject: cleanSubject(g.subject) || firstLine(g.snippet),
            customer_key: acct.key,
            customer_label: acct.label,
            customer_kind: "domain",
            product_area: g.product_area || "Uncategorized",
            is_bug: !!g.is_bug,
            is_feature_request: !!g.is_feature_request,
            classification: g.classification,
            owner: g.owner,
            status: g.status,
            csat_rating: g.csat_rating,
            created_at: g.created_at,
            resolved_at: g.resolved_at,
            intercom_conversation_id: g.intercom_conversation_id,
          });
        }

        for (const m of mcRes.data || []) {
          if (m.intercom_conversation_id && cmIntercomIds.has(m.intercom_conversation_id)) continue;
          const display: SourceKey = m.source === "slack" ? "slack" : m.intercom_conversation_id ? "intercom" : "other";

          let key = "manual:" + (m.source || "other");
          let label = "Manual / " + (m.source || "other");
          let kind: AccountKind = "manual";
          let rawId: string | undefined;

          const linkChannelId = m.source === "slack" ? extractSlackChannelId(m.link) : null;

          if (linkChannelId) {
            key = "channel:" + linkChannelId;
            label = "#" + linkChannelId;
            kind = "slack";
            rawId = linkChannelId;
          } else if (m.source === "slack") {
            key = "manual:slack";
            label = "Manual Slack imports";
          } else {
            // Use shared normaliser so contacts like "McKinsey",
            // "*@mckinsey.com", and known contractor names roll up
            // into a single account in the Top accounts panel.
            const acct = normalizeManualContact(m.contact_name);
            key = acct.key;
            label = acct.label;
            // `account:*` overrides (e.g. McKinsey alias / domain rollup) are
            // treated as manual contacts so they always land in the Manual
            // contacts column regardless of display_source.
            kind = acct.key.startsWith("domain:") ? "domain" : "manual";
          }

          tickets.push({
            id: m.id,
            route_source: "manual",
            display_source: display,
            subject: cleanSubject(m.subject),
            customer_key: key,
            customer_label: label,
            customer_kind: kind,
            customer_raw_id: rawId,
            product_area: m.product_area || "Uncategorized",
            is_bug: !!m.is_bug,
            is_feature_request: !!m.is_feature_request,
            classification: m.classification,
            owner: m.owner,
            status: m.status,
            csat_rating: m.csat_rating,
            created_at: m.created_at,
            resolved_at: m.resolved_at,
            intercom_conversation_id: m.intercom_conversation_id,
          });
        }


        if (!cancelled) setState({ loading: false, tickets });
      } catch (e) {
        if (!cancelled) setState({ loading: false, tickets: [], error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [month, refreshKey]);

  return state;
}

export const sourceLabel: Record<string, string> = {
  intercom: "Intercom",
  slack: "Slack",
  gmail: "Gmail",
  other: "Other",
};

export const ticketHref = (t: NormalizedTicket) => `/conversations/${t.id}?source=${t.route_source}`;
