import { useEffect, useState } from "react";
import { endOfMonth, startOfMonth, parse } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export type SourceKey = "intercom" | "slack" | "gmail" | "other";
export type RouteSource = "slack" | "gmail" | "manual";

export interface NormalizedTicket {
  id: string;
  route_source: RouteSource;
  display_source: SourceKey;
  subject: string;
  customer_key: string; // dedupe key for customer (lowercased email or name)
  customer_label: string; // display label
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

export function useMonthData(month: string): MonthData {
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
            .select("id,original_message_text,product_area,is_bug,is_feature_request,classification,owner,status,csat_rating,created_at,resolved_at,intercom_conversation_id,slack_user_name,slack_user_id,is_test")
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
            .select("id,subject,product_area,is_bug,is_feature_request,classification,owner,status,csat_rating,created_at,resolved_at,intercom_conversation_id,contact_name,source,is_test")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .eq("is_test", false)
            .limit(5000),
        ]);

        if (cmRes.error) throw cmRes.error;
        if (gmRes.error) throw gmRes.error;
        if (mcRes.error) throw mcRes.error;

        // Dedupe gmail by gmail_thread_id (keep earliest)
        const gmailByThread = new Map<string, typeof gmRes.data[number]>();
        for (const g of gmRes.data || []) {
          const key = g.gmail_thread_id || g.id;
          const existing = gmailByThread.get(key);
          if (!existing || new Date(g.created_at) < new Date(existing.created_at)) {
            gmailByThread.set(key, g);
          }
        }

        // Intercom IDs already represented in conversation_mappings — to dedupe manual
        const cmIntercomIds = new Set(
          (cmRes.data || [])
            .map(c => c.intercom_conversation_id)
            .filter((x): x is string => !!x)
        );

        const tickets: NormalizedTicket[] = [];

        // Slack-bridged conversation_mappings → display as "intercom" if has intercom id, else "slack"
        for (const c of cmRes.data || []) {
          const display: SourceKey = c.intercom_conversation_id ? "intercom" : "slack";
          const label = c.slack_user_name || c.slack_user_id || "Unknown";
          tickets.push({
            id: c.id,
            route_source: "slack",
            display_source: display,
            subject: firstLine(c.original_message_text),
            customer_key: ("slack:" + label).toLowerCase(),
            customer_label: label,
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
          const label = g.from_name || g.from_email || "Unknown";
          tickets.push({
            id: g.id,
            route_source: "gmail",
            display_source: "gmail",
            subject: cleanSubject(g.subject) || firstLine(g.snippet),
            customer_key: email ? "email:" + email : "name:" + label.toLowerCase(),
            customer_label: label,
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
          const label = m.contact_name || "Unknown";
          tickets.push({
            id: m.id,
            route_source: "manual",
            display_source: display,
            subject: cleanSubject(m.subject),
            customer_key: ("name:" + label).toLowerCase(),
            customer_label: label,
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
  }, [month]);

  return state;
}

export const sourceLabel: Record<string, string> = {
  intercom: "Intercom",
  slack: "Slack",
  gmail: "Gmail",
  other: "Other",
};

export const ticketHref = (t: NormalizedTicket) => `/conversations/${t.id}?source=${t.route_source}`;
