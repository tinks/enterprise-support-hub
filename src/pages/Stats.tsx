import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import { RefreshCw, MessageSquare, ThumbsUp, ThumbsDown, Clock, ExternalLink, TrendingUp, TrendingDown, Activity, CalendarIcon, ChevronDown, Timer, AlertCircle, AlertTriangle, ArrowUpRight, Mail, FileDown, Bot } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  LineChart, Line, AreaChart, Area, LabelList,
} from "recharts";
import { format, parseISO, subDays, subMonths, startOfDay, endOfDay, startOfMonth, endOfMonth, isAfter, isBefore, differenceInDays, differenceInMinutes } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { cn } from "@/lib/utils";
import { channelNameOverrides } from "@/lib/channelOverrides";

interface Mapping {
  id?: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  is_test: boolean;
  slack_channel_id: string;
  intercom_conversation_id?: string | null;
  csat_rating?: number | null;
  csat_remark?: string | null;
  csat_rated_at?: string | null;
  original_message_text?: string | null;
}

interface GmailRow {
  received_at: string | null;
  created_at: string;
  is_test: boolean;
  subject: string | null;
  status: string;
  resolved_at: string | null;
  gmail_thread_id: string | null;
  from_email: string | null;
  to_emails: string | null;
  cc_emails: string | null;
  intercom_conversation_id: string | null;
  csat_rating: number | null;
  csat_remark: string | null;
  csat_rated_at: string | null;
  id?: string;
}

interface ManualRow {
  status: string;
  created_at: string;
  is_test: boolean;
  source: string;
  owner: string | null;
  classification: string | null;
  is_bug: boolean;
  product_area: string | null;
  resolved_at: string | null;
  link: string | null;
  intercom_conversation_id: string | null;
  csat_rating: number | null;
  csat_remark: string | null;
  csat_rated_at: string | null;
  id?: string;
  subject?: string | null;
}

// Normalize a free-text Slack channel name: lowercase, trim, strip a single leading "#".
// Intentionally does NOT collapse "_" vs "-" — the user will rename channels manually.
const normalizeChannelName = (raw: string | null | undefined): string => {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/^#/, "");
};

type SourceFilter = "all" | "slack" | "gmail" | "manual" | "intercom";
type TimeRange = "this_month" | "last_month" | "7d" | "30d" | "90d" | "all" | "custom";

const chartConfig = {
  resolved: { label: "Resolved", color: "#9B87F5" },
  escalated: { label: "Escalated to human", color: "hsl(var(--destructive))" },
  
  open: { label: "Open", color: "#FF6B6B" },
  active: { label: "Active", color: "#FF6B6B" },
  awaiting_context: { label: "Awaiting customer", color: "hsl(var(--muted-foreground))" },
  awaiting_support: { label: "Awaiting support", color: "hsl(var(--muted-foreground))" },
  total: { label: "Total", color: "hsl(var(--foreground))" },
  slack: { label: "Slack", color: "#FF6B6B" },
  gmail: { label: "Gmail", color: "#E66FD2" },
  manual: { label: "Manual entry", color: "#4ECDC4" },
  intercom: { label: "Intercom", color: "#F59E0B" },
  cumulative: { label: "Cumulative", color: "#FF6B6B" },
  rate: { label: "Escalation rate", color: "hsl(var(--destructive))" },
  resolution: { label: "Resolution time", color: "#9B87F5" },
};

const rangeLabel: Record<TimeRange, string> = {
  this_month: "This month",
  last_month: "Last month",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom range",
};

// Returns [start, end] for fixed-window ranges (this_month, last_month), or null
const getMonthRange = (range: TimeRange): [Date, Date] | null => {
  const now = new Date();
  if (range === "this_month") return [startOfDay(startOfMonth(now)), endOfDay(endOfMonth(now))];
  if (range === "last_month") {
    const prev = subMonths(now, 1);
    return [startOfDay(startOfMonth(prev)), endOfDay(endOfMonth(prev))];
  }
  return null;
};

const getCutoffDate = (range: TimeRange): Date | null => {
  const now = new Date();
  switch (range) {
    case "7d": return subDays(now, 7);
    case "30d": return subDays(now, 30);
    case "90d": return subMonths(now, 3);
    default: return null;
  }
};

const Stats = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<Mapping[]>([]);
  const [gmailData, setGmailData] = useState<GmailRow[]>([]);
  const [manualData, setManualData] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"real" | "test">("real");
  const [range, setRange] = useState<TimeRange>("this_month");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [channelPopoverOpen, setChannelPopoverOpen] = useState(false);
  const [customDatePopoverOpen, setCustomDatePopoverOpen] = useState(false);
  const [customDateStep, setCustomDateStep] = useState<"from" | "to">("from");
  const statsContentRef = useRef<HTMLDivElement>(null);

  const activeRangeLabel = range === "custom" && customFrom && customTo
    ? `${format(customFrom, "MMM dd")} – ${format(customTo, "MMM dd")}`
    : rangeLabel[range];

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    setLoading(true);
    const [slackRes, gmailRes, manualRes] = await Promise.all([
      supabase
        .from("conversation_mappings")
        .select("id, status, created_at, is_test, slack_channel_id, resolved_at, intercom_conversation_id, csat_rating, csat_remark, csat_rated_at, original_message_text")
        .order("created_at", { ascending: true }),
      supabase
        .from("gmail_conversations")
        .select("id, received_at, created_at, is_test, subject, status, resolved_at, gmail_thread_id, from_email, to_emails, cc_emails, intercom_conversation_id, csat_rating, csat_remark, csat_rated_at")
        .order("received_at", { ascending: true }),
      supabase
        .from("manual_conversations")
        .select("id, status, created_at, is_test, source, owner, classification, is_bug, product_area, resolved_at, link, intercom_conversation_id, subject, csat_rating, csat_remark, csat_rated_at")
        .order("created_at", { ascending: true }),
    ]);
    const rows = (slackRes.data as Mapping[]) || [];
    setData(rows);
    setGmailData((gmailRes.data as unknown as GmailRow[]) || []);
    setManualData((manualRes.data as ManualRow[]) || []);

    // Resolve channel names
    const uniqueIds = [...new Set(rows.map((r) => r.slack_channel_id).filter(Boolean))];
    const names: Record<string, string> = { ...channelNameOverrides };
    const unresolvedIds = uniqueIds.filter((id) => !names[id]);
    if (unresolvedIds.length > 0) {
      try {
        const res = await supabase.functions.invoke("list-slack-channels", {
          body: { channelIds: unresolvedIds },
        });
        if (res.data?.channels) {
          for (const ch of res.data.channels) {
            if (ch.id && ch.name) names[ch.id] = ch.name;
          }
        }
      } catch { /* fallback to raw IDs */ }
    }
    for (const id of uniqueIds) {
      if (!names[id]) names[id] = id;
    }
    setChannelNames(names);
    setSelectedChannels(uniqueIds);
    setLoading(false);
  };

  const toggleChannel = (id: string) => {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const allChannelIds = useMemo(() => {
    return [...new Set(data.map((m) => m.slack_channel_id).filter(Boolean))];
  }, [data]);

  useEffect(() => {
    setSelectedChannels([...allChannelIds]);
  }, [allChannelIds]);

  useEffect(() => {
    if (range === "custom") {
      const t = setTimeout(() => setCustomDatePopoverOpen(true), 50);
      return () => clearTimeout(t);
    }
  }, [range]);

  const filtered = useMemo(() => {
    const cutoff = getCutoffDate(range);
    return data.filter((m) => {
      const matchView = view === "test" ? m.is_test : !m.is_test;
      const parsed = parseISO(m.created_at);
      let matchRange: boolean;
      if (range === "this_month" || range === "last_month") {
        const [s, e] = getMonthRange(range)!;
        matchRange = parsed >= s && parsed <= e;
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      const matchChannel = selectedChannels.length === 0 || selectedChannels.includes(m.slack_channel_id);
      return matchView && matchRange && matchChannel && m.status !== "cancelled";
    });
  }, [data, view, range, customFrom, customTo, selectedChannels]);

  const filteredGmail = useMemo(() => {
    const cutoff = getCutoffDate(range);
    return gmailData.filter((g) => {
      const matchView = view === "test" ? g.is_test : !g.is_test;
      const dateStr = g.received_at || g.created_at;
      const parsed = parseISO(dateStr);
      let matchRange: boolean;
      if (range === "this_month" || range === "last_month") {
        const [s, e] = getMonthRange(range)!;
        matchRange = parsed >= s && parsed <= e;
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      if (!matchView || !matchRange || g.status === "cancelled") return false;
      // Exclude internal-only threads (all participants @lovable.dev)
      const raw = [g.from_email, g.to_emails, g.cc_emails].filter(Boolean).join(",");
      const emails = raw.split(",").map(e => {
        const match = e.match(/<([^>]+)>/);
        return (match ? match[1] : e).trim().toLowerCase();
      }).filter(e => e.includes("@"));
      if (emails.length === 0) return false;
      const allInternal = emails.every(e => e.endsWith("@lovable.dev"));
      return !allInternal;
    });
  }, [gmailData, view, range, customFrom, customTo]);

  // Deduplicate Gmail rows by gmail_thread_id, picking the EARLIEST message
  // per thread from the FULL unfiltered dataset (so a thread is bucketed on its
  // true origin date, not on whichever reply happens to fall inside the range),
  // then apply the same view/range/internal-only filters used by filteredGmail.
  const filteredGmailThreads = useMemo(() => {
    const cutoff = getCutoffDate(range);
    const earliestByThread = new Map<string, GmailRow>();
    let orphanIdx = 0;
    gmailData.forEach((g) => {
      const key = g.gmail_thread_id || `__orphan_${orphanIdx++}`;
      const existing = earliestByThread.get(key);
      if (!existing) {
        earliestByThread.set(key, g);
      } else {
        const existingDate = existing.received_at || existing.created_at;
        const newDate = g.received_at || g.created_at;
        if (newDate && existingDate && newDate < existingDate) earliestByThread.set(key, g);
      }
    });

    return [...earliestByThread.values()].filter((g) => {
      const matchView = view === "test" ? g.is_test : !g.is_test;
      const dateStr = g.received_at || g.created_at;
      const parsed = parseISO(dateStr);
      let matchRange: boolean;
      if (range === "this_month" || range === "last_month") {
        const [s, e] = getMonthRange(range)!;
        matchRange = parsed >= s && parsed <= e;
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      if (!matchView || !matchRange || g.status === "cancelled") return false;
      const raw = [g.from_email, g.to_emails, g.cc_emails].filter(Boolean).join(",");
      const emails = raw.split(",").map((e) => {
        const match = e.match(/<([^>]+)>/);
        return (match ? match[1] : e).trim().toLowerCase();
      }).filter((e) => e.includes("@"));
      if (emails.length === 0) return false;
      const allInternal = emails.every((e) => e.endsWith("@lovable.dev"));
      return !allInternal;
    });
  }, [gmailData, view, range, customFrom, customTo]);

  const filteredManual = useMemo(() => {
    const cutoff = getCutoffDate(range);
    return manualData.filter((m) => {
      const matchView = view === "test" ? m.is_test : !m.is_test;
      const parsed = parseISO(m.created_at);
      let matchRange: boolean;
      if (range === "this_month" || range === "last_month") {
        const [s, e] = getMonthRange(range)!;
        matchRange = parsed >= s && parsed <= e;
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      const matchSource = sourceFilter === "intercom"
        ? m.source === "intercom"
        : sourceFilter === "manual"
          ? m.source !== "intercom"
          : true;
      return matchView && matchRange && matchSource && m.status !== "cancelled";
    });
  }, [manualData, view, range, customFrom, customTo, sourceFilter]);

  const gmailUniqueEmails = useMemo(() => {
    return filteredGmailThreads.length;
  }, [filteredGmailThreads]);

  const gmailResolutionTimes = useMemo(() => {
    // Group by thread, compute resolution time per thread
    const threadMap: Record<string, { earliest: string; resolved_at: string | null }> = {};
    let orphanIdx = 0;
    filteredGmail.forEach((g) => {
      const key = g.gmail_thread_id || `__orphan_${orphanIdx++}`;
      const dateStr = g.received_at || g.created_at;
      if (!threadMap[key]) {
        threadMap[key] = { earliest: dateStr, resolved_at: g.resolved_at };
      } else {
        if (dateStr < threadMap[key].earliest) threadMap[key].earliest = dateStr;
        if (g.resolved_at) threadMap[key].resolved_at = g.resolved_at;
      }
    });
    return Object.values(threadMap)
      .filter((t) => t.resolved_at)
      .map((t) => differenceInMinutes(parseISO(t.resolved_at!), parseISO(t.earliest)))
      .filter((m) => m >= 0)
      .sort((a, b) => a - b);
  }, [filteredGmail]);

  const gmailResolutionStats = useMemo(() => {
    if (gmailResolutionTimes.length === 0) return null;
    const median = gmailResolutionTimes[Math.floor(gmailResolutionTimes.length / 2)];
    const avg = gmailResolutionTimes.reduce((s, v) => s + v, 0) / gmailResolutionTimes.length;
    return { median, avg, count: gmailResolutionTimes.length };
  }, [gmailResolutionTimes]);

  const customerDomainData = useMemo(() => {
    const domainCounts: Record<string, number> = {};
    filteredGmailThreads.forEach((g) => {
      const allEmails = [g.from_email, g.to_emails, g.cc_emails]
        .filter(Boolean)
        .join(",")
        .split(",")
        .map((e) => {
          const match = e.match(/<([^>]+)>/);
          return (match ? match[1] : e).trim().toLowerCase();
        })
        .filter((e) => e.includes("@") && !e.endsWith("@lovable.dev"));
      const domain = allEmails.length > 0 ? allEmails[0].split("@")[1] : null;
      if (domain) domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    });
    return Object.entries(domainCounts)
      .map(([domain, count]) => ({ domain, threads: count }))
      .sort((a, b) => b.threads - a.threads);
  }, [filteredGmailThreads]);

  const gmailVolumeData = useMemo(() => {
    const byDay: Record<string, number> = {};
    filteredGmailThreads.forEach((g) => {
      const day = format(parseISO(g.received_at || g.created_at), "yyyy-MM-dd");
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return byDay;
  }, [filteredGmailThreads]);

  const manualVolumeData = useMemo(() => {
    const byDay: Record<string, number> = {};
    filteredManual.forEach((m) => {
      if (m.source === "intercom") return;
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return byDay;
  }, [filteredManual]);

  // Intercom IDs already represented by a Gmail thread — skip these in the
  // intercom volume series so the same conversation isn't counted twice when
  // sourceFilter === "all".
  const intercomIdsCoveredByGmail = useMemo(() => {
    const set = new Set<string>();
    filteredGmailThreads.forEach((g) => {
      if (g.intercom_conversation_id) set.add(g.intercom_conversation_id);
    });
    return set;
  }, [filteredGmailThreads]);

  const intercomVolumeDataOverview = useMemo(() => {
    const byDay: Record<string, number> = {};
    filteredManual.forEach((m) => {
      if (m.source !== "intercom") return;
      if (m.intercom_conversation_id && intercomIdsCoveredByGmail.has(m.intercom_conversation_id)) return;
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return byDay;
  }, [filteredManual, intercomIdsCoveredByGmail]);

  // Dedicated Intercom-only filter (ignores sourceFilter so the Intercom
  // section always reflects intercom-imported tickets when visible).
  const intercomFiltered = useMemo(() => {
    const cutoff = getCutoffDate(range);
    return manualData.filter((m) => {
      if (m.source !== "intercom") return false;
      const matchView = view === "test" ? m.is_test : !m.is_test;
      const parsed = parseISO(m.created_at);
      let matchRange: boolean;
      if (range === "this_month" || range === "last_month") {
        const [s, e] = getMonthRange(range)!;
        matchRange = parsed >= s && parsed <= e;
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      return matchView && matchRange && m.status !== "cancelled";
    });
  }, [manualData, view, range, customFrom, customTo]);

  const intercomStats = useMemo(() => {
    const total = intercomFiltered.length;
    const resolved = intercomFiltered.filter((m) => m.status === "resolved").length;
    const active = intercomFiltered.filter((m) => m.status === "active").length;
    const escalated = intercomFiltered.filter((m) => m.status === "escalated" || m.status === "escalated_pending").length;
    const bugs = intercomFiltered.filter((m) => m.is_bug).length;
    const resolvedPct = total ? Math.round((resolved / total) * 100) : 0;
    const escalationPct = total ? Math.round((escalated / total) * 100) : 0;
    const bugPct = total ? Math.round((bugs / total) * 100) : 0;

    // Avg resolution time (minutes)
    const resolutionMins = intercomFiltered
      .filter((m) => m.resolved_at)
      .map((m) => differenceInMinutes(parseISO(m.resolved_at!), parseISO(m.created_at)))
      .filter((n) => n >= 0);
    const avgResolutionMins = resolutionMins.length
      ? Math.round(resolutionMins.reduce((s, v) => s + v, 0) / resolutionMins.length)
      : null;

    // Top product area
    const areaCounts: Record<string, number> = {};
    intercomFiltered.forEach((m) => {
      const a = m.product_area || "Unassigned";
      areaCounts[a] = (areaCounts[a] || 0) + 1;
    });
    const topArea = Object.entries(areaCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

    return { total, resolved, active, escalated, bugs, resolvedPct, escalationPct, bugPct, avgResolutionMins, topArea };
  }, [intercomFiltered]);

  const intercomVolumeData = useMemo(() => {
    const byDay: Record<string, number> = {};
    intercomFiltered.forEach((m) => {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return [...Object.entries(byDay)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ date: day, label: format(parseISO(day), "MMM dd"), count }));
  }, [intercomFiltered]);

  const intercomStatusData = useMemo(() => {
    const buckets = { Resolved: 0, Active: 0, Escalated: 0, Awaiting: 0, Other: 0 };
    intercomFiltered.forEach((m) => {
      if (m.status === "resolved") buckets.Resolved++;
      else if (m.status === "active" || m.status === "active_pending") buckets.Active++;
      else if (m.status === "escalated" || m.status === "escalated_pending") buckets.Escalated++;
      else if (m.status?.startsWith("awaiting")) buckets.Awaiting++;
      else buckets.Other++;
    });
    return Object.entries(buckets)
      .filter(([, v]) => v > 0)
      .map(([status, count]) => ({ status, count }));
  }, [intercomFiltered]);

  const intercomByArea = useMemo(() => {
    const counts: Record<string, number> = {};
    intercomFiltered.forEach((m) => {
      const a = m.product_area || "Unassigned";
      counts[a] = (counts[a] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count);
  }, [intercomFiltered]);

  const mergedVolumeData = useMemo(() => {
    const allDays = new Set<string>();
    filtered.forEach((m) => allDays.add(format(parseISO(m.created_at), "yyyy-MM-dd")));
    filteredGmailThreads.forEach((g) => allDays.add(format(parseISO(g.received_at || g.created_at), "yyyy-MM-dd")));
    filteredManual.forEach((m) => allDays.add(format(parseISO(m.created_at), "yyyy-MM-dd")));
    
    const slackByDay: Record<string, number> = {};
    filtered.forEach((m) => {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      slackByDay[day] = (slackByDay[day] || 0) + 1;
    });

    return [...allDays].sort().map((day) => {
      const slack = slackByDay[day] || 0;
      const gmail = gmailVolumeData[day] || 0;
      const manual = manualVolumeData[day] || 0;
      const intercom = intercomVolumeDataOverview[day] || 0;
      return {
        date: day,
        label: format(parseISO(day), "MMM dd"),
        slack,
        gmail,
        manual,
        intercom,
        total: slack + gmail + manual + intercom,
      };
    });
  }, [filtered, filteredGmailThreads, filteredManual, gmailVolumeData, manualVolumeData, intercomVolumeDataOverview]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const gmailTotal = filteredGmailThreads.length;
    const manualTotal = filteredManual.length;
    const resolved = filtered.filter((m) => m.status === "resolved").length;
    // Escalated = ever handed off to a human (has Intercom conversation linked),
    // since current 'escalated' status is transient and gets overwritten on resolve.
    const escalated = filtered.filter((m) => (m.intercom_conversation_id && m.intercom_conversation_id !== "") || m.status === "escalated" || m.status === "escalated_pending").length;
    const active = filtered.filter((m) => m.status === "active" || m.status === "active_pending").length;
    const awaiting = filtered.filter((m) => m.status === "awaiting_context" || m.status === "awaiting_support" || m.status === "awaiting_engineering").length;
    const processing = filtered.filter((m) => m.status === "processing").length;
    const open = total - resolved;
    const resolvedPct = total ? Math.round((resolved / total) * 100) : 0;
    const botResolved = filtered.filter((m) => m.status === "resolved" && (!m.intercom_conversation_id || m.intercom_conversation_id === "")).length;
    const botSuccessPct = total ? Math.round((botResolved / total) * 100) : 0;

    const manualActive = filteredManual.filter((m) => m.status === "active").length;
    const manualResolved = filteredManual.filter((m) => m.status === "resolved").length;

    const cutoff = getCutoffDate(range);
    let combinedTotal = total + gmailTotal + manualTotal;
    if (sourceFilter === "gmail") combinedTotal = gmailTotal;
    else if (sourceFilter === "slack") combinedTotal = total;
    else if (sourceFilter === "manual" || sourceFilter === "intercom") combinedTotal = manualTotal;
    const monthRange = getMonthRange(range);
    const daySpan = monthRange
      ? (differenceInDays(monthRange[1], monthRange[0]) || 1)
      : cutoff
        ? differenceInDays(new Date(), cutoff) || 1
        : filtered.length > 0
          ? differenceInDays(new Date(), parseISO(filtered[0].created_at)) || 1
          : 1;
    const avgPerDay = +(combinedTotal / daySpan).toFixed(1);

    const gmailResolvedCount = filteredGmailThreads.filter((g) => g.status === "resolved").length;
    const gmailOpen = filteredGmailThreads.filter((g) => g.status === "open").length;

    return { total, gmailTotal, gmailDeduped: gmailTotal, emailTotal: gmailUniqueEmails, resolved, escalated, active, awaiting, processing, open, resolvedPct, botResolved, botSuccessPct, avgPerDay, gmailResolved: gmailResolvedCount, gmailOpen, manualTotal, manualActive, manualResolved };
  }, [filtered, filteredGmailThreads, filteredManual, range, sourceFilter, gmailUniqueEmails]);

  // Manual entries by source breakdown
  const manualBySource = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredManual.forEach((m) => {
      const src = m.source || "other";
      counts[src] = (counts[src] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredManual]);

  // Manual entries by owner
  const manualByOwner = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredManual.forEach((m) => {
      const owner = m.owner || "Unassigned";
      counts[owner] = (counts[owner] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredManual]);

  // Daily volume line chart
  const volumeData = useMemo(() => {
    const byDay: Record<string, { date: string; total: number; resolved: number; open: number; escalated: number }> = {};
    filtered.forEach((m) => {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      if (!byDay[day]) byDay[day] = { date: day, total: 0, resolved: 0, open: 0, escalated: 0 };
      byDay[day].total++;
      const isEscalated = (m.intercom_conversation_id && m.intercom_conversation_id !== "") || m.status === "escalated" || m.status === "escalated_pending";
      if (m.status === "resolved") byDay[day].resolved++;
      else byDay[day].open++;
      if (isEscalated) byDay[day].escalated++;
    });
    return Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, label: format(parseISO(d.date), "MMM dd") }));
  }, [filtered]);

  // Cumulative conversations over time
  const cumulativeData = useMemo(() => {
    let cum = 0;
    return volumeData.map((d) => {
      cum += d.total;
      return { label: d.label, cumulative: cum };
    });
  }, [volumeData]);

  // Escalation rate over time (daily) — computed from raw filtered data
  const escalationRateData = useMemo(() => {
    const escalatedByDay: Record<string, number> = {};
    filtered.forEach((m) => {
      if ((m.intercom_conversation_id && m.intercom_conversation_id !== "") || m.status === "escalated" || m.status === "escalated_pending") {
        const day = format(parseISO(m.created_at), "yyyy-MM-dd");
        escalatedByDay[day] = (escalatedByDay[day] || 0) + 1;
      }
    });
    return volumeData
      .filter((d) => d.resolved > 0 || (escalatedByDay[d.date] || 0) > 0)
      .map((d) => {
        const escalated = escalatedByDay[d.date] || 0;
        const total = d.resolved + escalated;
        return {
          label: d.label,
          rate: total > 0 ? Math.round((escalated / total) * 100) : 0,
        };
      });
  }, [volumeData, filtered]);

  // Daily outcomes bar chart
  const dailyOutcomes = useMemo(() => {
    return volumeData
      .filter((d) => d.resolved > 0 || d.open > 0 || d.escalated > 0)
      .map((d) => ({ date: d.label, resolved: d.resolved, open: d.open, escalated: d.escalated }));
  }, [volumeData]);

  const pieData = useMemo(() => {
    let resolvedNoEsc = 0, openNoEsc = 0, escalatedAll = 0;
    filtered.forEach((m) => {
      const wasEscalated = (m.intercom_conversation_id && m.intercom_conversation_id !== "") || m.status === "escalated" || m.status === "escalated_pending";
      if (wasEscalated) escalatedAll++;
      else if (m.status === "resolved") resolvedNoEsc++;
      else openNoEsc++;
    });
    return [
      { name: "Resolved", value: resolvedNoEsc, fill: chartConfig.resolved.color },
      { name: "Open", value: openNoEsc, fill: chartConfig.open.color },
      { name: "Escalated to human", value: escalatedAll, fill: chartConfig.escalated.color },
    ].filter((d) => d.value > 0);
  }, [filtered]);

  // Channel breakdown data — group all DMs (D…) into one synthetic "Direct message" bucket.
  // Includes manual Slack imports keyed by normalized link; slack_dm rows fold into "Direct message".
  const channelData = useMemo(() => {
    const byChannel: Record<string, { channel: string; channel_id: string; total: number }> = {};
    filtered.forEach((m) => {
      const id = m.slack_channel_id;
      if (!id) return;
      if (id.startsWith("D")) {
        if (!byChannel["__DM__"]) byChannel["__DM__"] = { channel: "Direct message", channel_id: "__DM__", total: 0 };
        byChannel["__DM__"].total++;
        return;
      }
      const name = channelNames[id] || channelNameOverrides[id] || id;
      if (!byChannel[id]) byChannel[id] = { channel: name, channel_id: id, total: 0 };
      byChannel[id].total++;
    });
    // Manual Slack imports
    filteredManual.forEach((m) => {
      if (m.source === "slack_dm") {
        if (!byChannel["__DM__"]) byChannel["__DM__"] = { channel: "Direct message", channel_id: "__DM__", total: 0 };
        byChannel["__DM__"].total++;
        return;
      }
      if (m.source !== "slack_thread") return;
      const normalized = normalizeChannelName(m.link);
      if (!normalized) {
        const key = "manual:__unknown__";
        if (!byChannel[key]) byChannel[key] = { channel: "#unknown", channel_id: key, total: 0 };
        byChannel[key].total++;
        return;
      }
      const key = `manual:${normalized}`;
      if (!byChannel[key]) byChannel[key] = { channel: `#${normalized}`, channel_id: key, total: 0 };
      byChannel[key].total++;
    });
    return Object.values(byChannel).sort((a, b) => b.total - a.total);
  }, [filtered, filteredManual, channelNames]);

  // Peak day
  const peakDay = useMemo(() => {
    if (volumeData.length === 0) return null;
    return volumeData.reduce((max, d) => (d.total > max.total ? d : max), volumeData[0]);
  }, [volumeData]);

  // Resolution time helpers
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
    const days = Math.floor(minutes / 1440);
    const hrs = Math.floor((minutes % 1440) / 60);
    return `${days}d ${hrs}h`;
  };

  const resolutionTimes = useMemo(() => {
    return filtered
      .filter((m) => m.status === "resolved" && m.resolved_at)
      .map((m) => differenceInMinutes(parseISO(m.resolved_at!), parseISO(m.created_at)))
      .filter((mins) => mins >= 0)
      .sort((a, b) => a - b);
  }, [filtered]);

  const resolutionStats = useMemo(() => {
    if (resolutionTimes.length === 0) return null;
    const median = resolutionTimes[Math.floor(resolutionTimes.length / 2)];
    const avg = resolutionTimes.reduce((s, v) => s + v, 0) / resolutionTimes.length;
    return { median, avg, count: resolutionTimes.length };
  }, [resolutionTimes]);

  const resolutionDistribution = useMemo(() => {
    if (resolutionTimes.length === 0) return [];
    const buckets = [
      { label: "< 15m", min: 0, max: 15, count: 0 },
      { label: "15m–1h", min: 15, max: 60, count: 0 },
      { label: "1–4h", min: 60, max: 240, count: 0 },
      { label: "4–24h", min: 240, max: 1440, count: 0 },
      { label: "24h+", min: 1440, max: 999999, count: 0 },
    ];
    for (const mins of resolutionTimes) {
      const bucket = buckets.find((b) => mins < b.max) || buckets[buckets.length - 1];
      bucket.count++;
    }
    return buckets.filter((b) => b.count > 0);
  }, [resolutionTimes]);

  const resolutionTrend = useMemo(() => {
    const resolved = filtered
      .filter((m) => m.status === "resolved" && m.resolved_at)
      .map((m) => ({
        day: format(parseISO(m.created_at), "yyyy-MM-dd"),
        mins: differenceInMinutes(parseISO(m.resolved_at!), parseISO(m.created_at)),
      }))
      .filter((r) => r.mins >= 0);
    if (resolved.length === 0) return [];
    const byDay: Record<string, number[]> = {};
    for (const r of resolved) {
      if (!byDay[r.day]) byDay[r.day] = [];
      byDay[r.day].push(r.mins);
    }
    const days = Object.keys(byDay).sort();
    return days.map((day) => {
      const vals = byDay[day].sort((a, b) => a - b);
      const median = vals[Math.floor(vals.length / 2)];
      return { label: format(parseISO(day), "MMM dd"), resolution: Math.round(median) };
    });
  }, [filtered]);

  const hourlyActivityData = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, i) => ({
      hour: `${String(i).padStart(2, "0")}:00`,
      slack: 0,
      gmail: 0,
      manual: 0,
      intercom: 0,
    }));
    const getCETHour = (dateStr: string) => {
      const d = new Date(dateStr);
      return parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }));
    };
    filtered.forEach((m) => { buckets[getCETHour(m.created_at)].slack++; });
    filteredGmailThreads.forEach((g) => {
      const h = getCETHour(g.received_at || g.created_at);
      buckets[h].gmail++;
    });
    filteredManual.forEach((m) => {
      const h = getCETHour(m.created_at);
      if (m.source === "intercom") buckets[h].intercom++;
      else buckets[h].manual++;
    });
    return buckets;
  }, [filtered, filteredGmailThreads, filteredManual]);

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

  const heatmapData = useMemo(() => {
    const grid: Record<string, Record<number, { slack: number; gmail: number; manual: number; intercom: number; total: number }>> = {};
    DAYS.forEach((d) => {
      grid[d] = {};
      for (let h = 0; h < 24; h++) grid[d][h] = { slack: 0, gmail: 0, manual: 0, intercom: 0, total: 0 };
    });

    const getCET = (dateStr: string) => {
      const d = new Date(dateStr);
      const day = d.toLocaleDateString("en-GB", { timeZone: "Europe/Berlin", weekday: "short" });
      const hour = parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }));
      return { day, hour };
    };

    filtered.forEach((m) => {
      const { day, hour } = getCET(m.created_at);
      if (grid[day]) { grid[day][hour].slack++; grid[day][hour].total++; }
    });
    filteredGmailThreads.forEach((g) => {
      const { day, hour } = getCET(g.received_at || g.created_at);
      if (grid[day]) { grid[day][hour].gmail++; grid[day][hour].total++; }
    });
    filteredManual.forEach((m) => {
      const { day, hour } = getCET(m.created_at);
      if (!grid[day]) return;
      if (m.source === "intercom") grid[day][hour].intercom++;
      else grid[day][hour].manual++;
      grid[day][hour].total++;
    });

    let max = 0;
    DAYS.forEach((d) => {
      for (let h = 0; h < 24; h++) {
        const cell = grid[d][h];
        const val = sourceFilter === "slack" ? cell.slack : sourceFilter === "gmail" ? cell.gmail : sourceFilter === "intercom" ? cell.intercom : sourceFilter === "manual" ? cell.manual : cell.total;
        if (val > max) max = val;
      }
    });

    return { grid, max };
  }, [filtered, filteredGmailThreads, filteredManual, sourceFilter]);

  const [exporting, setExporting] = useState(false);

  const exportPDF = async () => {
    const container = statsContentRef.current;
    if (!container) return;
    setExporting(true);

    try {
      // Capture the entire stats content area
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const usableWidth = pageWidth - margin * 2;

      // Add header
      pdf.setFontSize(16);
      pdf.text("Lovable support analytics", margin, 15);
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      const filterText = `Environment: ${view} | Source: ${sourceFilter} | Timeframe: ${rangeLabel[range]} | Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`;
      pdf.text(filterText, margin, 22);
      pdf.setTextColor(0);

      // Calculate image dimensions to fit page width
      const imgWidth = usableWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const startY = 28;
      const availableHeight = pageHeight - startY - margin;

      // Split into pages if needed
      let remainingHeight = imgHeight;
      let srcY = 0;

      while (remainingHeight > 0) {
        const sliceHeight = Math.min(availableHeight, remainingHeight);
        const sliceCanvasHeight = (sliceHeight / imgHeight) * canvas.height;

        // Create a slice canvas
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceCanvasHeight;
        const ctx = sliceCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(canvas, 0, srcY, canvas.width, sliceCanvasHeight, 0, 0, canvas.width, sliceCanvasHeight);
          const sliceData = sliceCanvas.toDataURL("image/png");
          const yPos = srcY === 0 ? startY : margin;
          pdf.addImage(sliceData, "PNG", margin, yPos, imgWidth, sliceHeight);
        }

        remainingHeight -= sliceHeight;
        srcY += sliceCanvasHeight;

        if (remainingHeight > 0) {
          pdf.addPage();
        }
      }

      pdf.save(`stats-report-${format(new Date(), "yyyy-MM-dd")}-${sourceFilter}-${range}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  // ===== CSAT (Intercom conversation_rating) =====
  const csatRows = useMemo(() => {
    const rows: Array<{ id: string; rating: number; remark: string | null; rated_at: string | null; source: "manual" | "gmail" | "slack"; subject: string; link: string | null }> = [];
    if (sourceFilter === "all" || sourceFilter === "manual" || sourceFilter === "intercom") {
      filteredManual.forEach((m) => {
        if (m.csat_rating && m.id) {
          rows.push({
            id: m.id, rating: m.csat_rating, remark: m.csat_remark, rated_at: m.csat_rated_at,
            source: "manual", subject: m.subject || "(no subject)", link: m.link,
          });
        }
      });
    }
    if (sourceFilter === "all" || sourceFilter === "gmail") {
      filteredGmailThreads.forEach((g) => {
        if (g.csat_rating && g.id) {
          rows.push({
            id: g.id, rating: g.csat_rating, remark: g.csat_remark, rated_at: g.csat_rated_at,
            source: "gmail", subject: g.subject || "(no subject)", link: null,
          });
        }
      });
    }
    if (sourceFilter === "all" || sourceFilter === "slack") {
      filtered.forEach((m) => {
        if (m.csat_rating && m.id) {
          rows.push({
            id: m.id, rating: m.csat_rating, remark: m.csat_remark ?? null, rated_at: m.csat_rated_at ?? null,
            source: "slack", subject: (m.original_message_text || "").slice(0, 80) || "(slack thread)", link: null,
          });
        }
      });
    }
    return rows;
  }, [filteredManual, filteredGmailThreads, filtered, sourceFilter]);

  const csatStats = useMemo(() => {
    const total = csatRows.length;
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    csatRows.forEach((r) => { counts[r.rating] = (counts[r.rating] || 0) + 1; });
    const distribution = [1, 2, 3, 4, 5].map((rating) => ({ rating, count: counts[rating] }));
    const avg = total > 0 ? csatRows.reduce((s, r) => s + r.rating, 0) / total : 0;
    let resolvedBase = 0;
    if (sourceFilter === "all" || sourceFilter === "manual" || sourceFilter === "intercom") {
      filteredManual.forEach((m) => {
        if (m.intercom_conversation_id && (m.status === "resolved" || m.resolved_at)) resolvedBase++;
      });
    }
    if (sourceFilter === "all" || sourceFilter === "gmail") {
      filteredGmailThreads.forEach((g) => {
        if (g.intercom_conversation_id && (g.status === "resolved" || g.resolved_at)) resolvedBase++;
      });
    }
    if (sourceFilter === "all" || sourceFilter === "slack") {
      filtered.forEach((m) => {
        if (m.status === "resolved" || m.resolved_at) resolvedBase++;
      });
    }
    const responseRate = resolvedBase > 0 ? (total / resolvedBase) * 100 : 0;
    return { total, avg, distribution, responseRateBase: resolvedBase, responseRate };
  }, [csatRows, filteredManual, filteredGmailThreads, filtered, sourceFilter]);


  const lowCsatRows = useMemo(() => {
    return [...csatRows]
      .filter((r) => r.rating <= 2)
      .sort((a, b) => (b.rated_at || "").localeCompare(a.rated_at || ""))
      .slice(0, 8);
  }, [csatRows]);

  const ratingColor = (rating: number) => {
    if (rating >= 5) return "#10B981";
    if (rating >= 4) return "#84CC16";
    if (rating >= 3) return "#EAB308";
    if (rating >= 2) return "#F97316";
    return "#EF4444";
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div ref={statsContentRef} className="mx-auto max-w-5xl space-y-6 p-6">
        {/* Hero banner */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-gradient-to-br from-card via-card to-accent p-6">
          <div className="flex items-center gap-4">
            <img src="/lovable-logo.png" alt="Lovable logo" className="h-12 w-12 rounded-lg" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Lovable Enterprise Support Hub</h1>
              <p className="text-sm text-muted-foreground">Inbox Management and Real-time analytics</p>
            </div>
          </div>
          <div className="flex gap-2">
            <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
              <ExternalLink className="h-3.5 w-3.5" /> Slack App
            </a>
            <a href="https://app.intercom.com" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
              <ExternalLink className="h-3.5 w-3.5" /> Intercom
            </a>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Environment:</span>
            <Select value={view} onValueChange={(v) => setView(v as "real" | "test")}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="real">Production</SelectItem>
                <SelectItem value="test">Test</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Source:</span>
            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="gmail">Gmail</SelectItem>
                <SelectItem value="manual">Manual entry</SelectItem>
                <SelectItem value="intercom">Intercom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Timeframe:</span>
            <Select value={range} onValueChange={(v) => { setRange(v as TimeRange); }}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="last_month">Last month</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
          </div>
          {range === "custom" && (
            <div className="flex items-center gap-2">
              <Popover open={customDatePopoverOpen} onOpenChange={(open) => { setCustomDatePopoverOpen(open); if (!open) setCustomDateStep("from"); }}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !customFrom && !customTo && "text-muted-foreground")}>
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {customFrom && customTo
                      ? `${format(customFrom, "MMM dd")} – ${format(customTo, "MMM dd, yyyy")}`
                      : customFrom
                        ? `${format(customFrom, "MMM dd, yyyy")} – ...`
                        : "Select dates"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="p-3 pb-1 text-xs text-muted-foreground font-medium">
                    {customDateStep === "from" ? "Select start date" : "Select end date"}
                  </div>
                  <Calendar
                    mode="single"
                    selected={customDateStep === "from" ? customFrom : customTo}
                    onSelect={(date) => {
                      if (!date) return;
                      if (customDateStep === "from") {
                        setCustomFrom(date);
                        setCustomTo(undefined);
                        setCustomDateStep("to");
                      } else {
                        if (customFrom && date >= customFrom) {
                          setCustomTo(date);
                          setCustomDatePopoverOpen(false);
                          setCustomDateStep("from");
                        }
                      }
                    }}
                    disabled={(date) => customDateStep === "to" && customFrom ? isBefore(date, customFrom) : false}
                    initialFocus
                    className="p-3 pointer-events-auto"
                    modifiers={customFrom && customTo ? { range: { after: customFrom, before: customTo } } : {}}
                    modifiersStyles={customFrom && customTo ? { range: { backgroundColor: "hsl(var(--accent))", borderRadius: 0 } } : {}}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
          {allChannelIds.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Channel(s):</span>
              <Popover open={channelPopoverOpen} onOpenChange={setChannelPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 min-w-[180px] justify-between text-sm font-normal">
                    {selectedChannels.length === allChannelIds.length
                      ? "All channels"
                      : selectedChannels.length === 0
                        ? "None selected"
                        : selectedChannels.length === 1
                          ? `#${channelNames[selectedChannels[0]] || channelNameOverrides[selectedChannels[0]] || (selectedChannels[0].startsWith("D") ? "Direct message" : selectedChannels[0])}`
                          : `${selectedChannels.length} channels`}
                    <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search channels…" />
                    <CommandList>
                      <CommandEmpty>No channels found.</CommandEmpty>
                      {allChannelIds
                        .map((id) => ({ id, name: channelNames[id] || channelNameOverrides[id] || (id.startsWith("D") ? "Direct message" : id) }))
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((ch) => (
                          <CommandItem
                            key={ch.id}
                            value={ch.name}
                            onSelect={() => toggleChannel(ch.id)}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              checked={selectedChannels.includes(ch.id)}
                              className="pointer-events-none"
                            />
                            <span>#{ch.name}</span>
                          </CommandItem>
                        ))}
                    </CommandList>
                  </Command>
                  <div className="border-t p-1.5 flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => {
                        if (selectedChannels.length === allChannelIds.length) {
                          setSelectedChannels([]);
                        } else {
                          setSelectedChannels([...allChannelIds]);
                        }
                      }}
                    >
                      {selectedChannels.length === allChannelIds.length ? "Deselect all" : "Select all"}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <Button variant="outline" size="sm" className="h-9" onClick={exportPDF} disabled={exporting}>
            {exporting ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>
        </div>

        {/* ── Overview section ── */}
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Overview</h2>
            <div className="mt-2 h-px w-full bg-border" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-5">
                <MessageSquare className="mb-2 h-5 w-5 text-primary" />
                <p className="text-3xl font-bold text-foreground">{stats.total + stats.gmailDeduped + stats.manualTotal}</p>
                <p className="text-xs text-muted-foreground">Total incoming cases</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-5">
                <ThumbsUp className="mb-2 h-5 w-5 text-primary" />
                <p className="text-3xl font-bold text-foreground">{stats.resolved + stats.gmailResolved + stats.manualResolved}</p>
                <p className="text-xs text-muted-foreground">Total resolved cases</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-5">
                <Activity className="mb-2 h-5 w-5 text-primary" />
                <p className="text-3xl font-bold text-foreground">{stats.avgPerDay}</p>
                <p className="text-xs text-muted-foreground">Avg / day</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Conversation volume</CardTitle>
              <CardDescription>Daily conversations over {activeRangeLabel.toLowerCase()}</CardDescription>
            </CardHeader>
            <CardContent>
              {volumeData.length === 0 && filteredGmailThreads.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <AreaChart
                    data={mergedVolumeData}
                    onClick={(state) => {
                      if (state?.activePayload?.[0]) {
                        const date = state.activePayload[0].payload.date;
                        const params = new URLSearchParams({ day: date });
                        if (sourceFilter !== "all") params.set("source", sourceFilter);
                        navigate(`/conversations?${params.toString()}`);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <defs>
                      <linearGradient id="gradSlack" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradGmail" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#E66FD2" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#E66FD2" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradManual" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4ECDC4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#4ECDC4" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradIntercomOverview" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {(sourceFilter === "all" || sourceFilter === "slack") && (
                      <Area type="monotone" dataKey="slack" stroke="hsl(var(--primary))" fill="url(#gradSlack)" strokeWidth={2} />
                    )}
                    {(sourceFilter === "all" || sourceFilter === "gmail") && (
                      <Area type="monotone" dataKey="gmail" stroke="#E66FD2" fill="url(#gradGmail)" strokeWidth={2} />
                    )}
                    {(sourceFilter === "all" || sourceFilter === "manual") && (
                      <Area type="monotone" dataKey="manual" stroke="#4ECDC4" fill="url(#gradManual)" strokeWidth={2} />
                    )}
                    {(sourceFilter === "all" || sourceFilter === "intercom") && (
                      <Area type="monotone" dataKey="intercom" stroke="#F59E0B" fill="url(#gradIntercomOverview)" strokeWidth={2} />
                    )}
                    {sourceFilter === "all" && (
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="hsl(var(--foreground))"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        name="Total"
                      />
                    )}
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Activity by hour of day */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Activity by hour of day (CET)</CardTitle>
              <CardDescription>When conversations and emails arrive, bucketed by hour in CET timezone</CardDescription>
            </CardHeader>
            <CardContent>
              {hourlyActivityData.every((b) => b.slack === 0 && b.gmail === 0 && b.manual === 0 && b.intercom === 0) ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={hourlyActivityData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="hour" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {(sourceFilter === "all" || sourceFilter === "slack") && (
                      <Bar dataKey="slack" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    )}
                    {(sourceFilter === "all" || sourceFilter === "gmail") && (
                      <Bar dataKey="gmail" fill="#E66FD2" radius={[4, 4, 0, 0]} />
                    )}
                    {(sourceFilter === "all" || sourceFilter === "manual") && (
                      <Bar dataKey="manual" fill="#4ECDC4" radius={[4, 4, 0, 0]} />
                    )}
                    {(sourceFilter === "all" || sourceFilter === "intercom") && (
                      <Bar dataKey="intercom" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                    )}
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Activity heatmap */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Activity heatmap (CET)</CardTitle>
              <CardDescription>Day of week × hour of day — darker cells indicate more activity</CardDescription>
            </CardHeader>
            <CardContent>
              {heatmapData.max === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[640px]">
                    <div className="flex items-end gap-px mb-1">
                      <div className="w-10 shrink-0" />
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground">
                          {String(h).padStart(2, "0")}
                        </div>
                      ))}
                    </div>
                    {DAYS.map((day) => (
                      <div key={day} className="flex items-center gap-px mb-px">
                        <div className="w-10 shrink-0 text-xs text-muted-foreground font-medium">{day}</div>
                        {Array.from({ length: 24 }, (_, h) => {
                          const cell = heatmapData.grid[day][h];
                          const val = sourceFilter === "slack" ? cell.slack : sourceFilter === "gmail" ? cell.gmail : sourceFilter === "intercom" ? cell.intercom : sourceFilter === "manual" ? cell.manual : cell.total;
                          const opacity = heatmapData.max > 0 ? Math.max(0.08, val / heatmapData.max) : 0;
                          return (
                            <div
                              key={h}
                              className={cn(
                                "flex-1 aspect-square rounded-sm bg-primary transition-opacity",
                                val > 0 && "cursor-pointer hover:ring-2 hover:ring-primary/50"
                              )}
                              style={{ opacity: val > 0 ? opacity : 0.04 }}
                              title={`${day} ${String(h).padStart(2, "0")}:00 — Slack: ${cell.slack}, Gmail: ${cell.gmail}, Manual: ${cell.manual}, Intercom: ${cell.intercom}, Total: ${cell.total}`}
                              onClick={() => {
                                if (val > 0) navigate(`/conversations?day=${day}&hour=${h}&source=${sourceFilter}`);
                              }}
                            />
                          );
                        })}
                      </div>
                    ))}
                    <div className="flex items-center gap-2 mt-3 justify-end">
                      <span className="text-[10px] text-muted-foreground">Less</span>
                      {[0.08, 0.25, 0.5, 0.75, 1].map((o) => (
                        <div key={o} className="h-3 w-3 rounded-sm bg-primary" style={{ opacity: o }} />
                      ))}
                      <span className="text-[10px] text-muted-foreground">More</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Slack section ── */}
        {(sourceFilter === "all" || sourceFilter === "slack") && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Slack</h2>
              <div className="mt-2 h-px w-full bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7">
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <MessageSquare className="mb-2 h-5 w-5 text-primary" />
                  <p className="text-3xl font-bold text-foreground">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Received</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <ThumbsUp className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-3xl font-bold text-foreground">{stats.resolved}</p>
                  <p className="text-xs text-muted-foreground">Resolved</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <AlertCircle className="mb-2 h-5 w-5 text-orange-500" />
                  <p className="text-3xl font-bold text-foreground">{stats.open}</p>
                  <p className="text-xs text-muted-foreground">Open</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <ArrowUpRight className="mb-2 h-5 w-5 text-amber-500" />
                  <p className="text-3xl font-bold text-foreground">{stats.escalated}</p>
                  <p className="text-xs text-muted-foreground">Escalated to human</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <Clock className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-3xl font-bold text-foreground">{stats.resolvedPct}%</p>
                  <p className="text-xs text-muted-foreground">Success rate</p>
                </CardContent>
              </Card>
            </div>

            {/* Slack resolution time */}
            {resolutionStats && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center p-5">
                      <Timer className="mb-2 h-5 w-5 text-primary" />
                      <p className="text-3xl font-bold text-foreground">{formatDuration(resolutionStats.median)}</p>
                      <p className="text-xs text-muted-foreground">Median resolution time</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center p-5">
                      <Clock className="mb-2 h-5 w-5 text-muted-foreground" />
                      <p className="text-3xl font-bold text-foreground">{formatDuration(resolutionStats.avg)}</p>
                      <p className="text-xs text-muted-foreground">Average resolution time</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Resolution time distribution</CardTitle>
                      <CardDescription>How long conversations take to resolve</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {resolutionDistribution.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                      ) : (
                        <ChartContainer config={chartConfig} className="h-[250px] w-full">
                          <BarChart
                            data={resolutionDistribution}
                            onClick={(state) => {
                              if (state?.activePayload?.[0]) {
                                const { min, max } = state.activePayload[0].payload;
                                navigate(`/conversations?resolutionMin=${min}&resolutionMax=${max}&source=slack`);
                              }
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="label" className="text-xs" />
                            <YAxis allowDecimals={false} className="text-xs" />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="count" fill="#9B87F5" radius={[4, 4, 0, 0]}>
                              <LabelList dataKey="count" position="top" className="text-xs fill-foreground" />
                            </Bar>
                          </BarChart>
                        </ChartContainer>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Resolution time trend</CardTitle>
                      <CardDescription>Daily median (minutes)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {resolutionTrend.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">Not enough data yet</p>
                      ) : (
                        <ChartContainer config={chartConfig} className="h-[250px] w-full">
                          <LineChart data={resolutionTrend}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="label" className="text-xs" />
                            <YAxis unit="m" allowDecimals={false} className="text-xs" />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Line type="monotone" dataKey="resolution" stroke="#9B87F5" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ChartContainer>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}

            {/* Conversations by channel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Conversations by channel</CardTitle>
                <CardDescription>Total conversations per Slack channel — click a bar to see conversations. Counts respect the selected date range above.</CardDescription>
              </CardHeader>
              <CardContent>
                {channelData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No channel data yet</p>
                ) : (
                  <ChartContainer config={chartConfig} className="w-full" style={{ height: Math.max(200, channelData.length * 48) }}>
                    <BarChart data={channelData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} className="text-xs" />
                      <YAxis type="category" dataKey="channel" className="text-xs" width={160} tick={{ fontSize: 12 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="total"
                        fill="#FF6B6B"
                        radius={[0, 4, 4, 0]}
                        className="cursor-pointer"
                        onClick={(data: any) => {
                          const id = data?.channel_id || data?.payload?.channel_id;
                          if (!id) return;
                          if (id === "__DM__") {
                            navigate(`/conversations?channelGroup=dm&source=slack`);
                          } else if (id.startsWith("manual:")) {
                            const name = id.slice("manual:".length);
                            navigate(`/conversations?manualChannel=${encodeURIComponent(name)}`);
                          } else {
                            navigate(`/conversations?channel=${encodeURIComponent(id)}&source=slack`);
                          }
                        }}
                      >
                        <LabelList dataKey="total" position="right" className="text-xs fill-foreground" />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* Daily outcomes + Status distribution */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Daily outcomes</CardTitle>
                  <CardDescription>Resolved vs open vs escalated per day</CardDescription>
                </CardHeader>
                <CardContent>
                  {dailyOutcomes.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No outcome data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="h-[250px] w-full">
                      <BarChart data={dailyOutcomes}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" className="text-xs" />
                        <YAxis allowDecimals={false} className="text-xs" />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="resolved" fill={chartConfig.resolved.color} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="open" fill={chartConfig.open.color} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="escalated" fill={chartConfig.escalated.color} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Status distribution</CardTitle>
                  <CardDescription>Current breakdown of all conversations</CardDescription>
                </CardHeader>
                <CardContent>
                  {pieData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="h-[250px] w-full">
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Cumulative + Escalation rate */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Cumulative conversations</CardTitle>
                  <CardDescription>Growth over time</CardDescription>
                </CardHeader>
                <CardContent>
                  {cumulativeData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="h-[250px] w-full">
                      <LineChart data={cumulativeData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" />
                        <YAxis allowDecimals={false} className="text-xs" />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Escalation rate trend
                    {escalationRateData.length >= 2 && (
                      escalationRateData[escalationRateData.length - 1].rate < escalationRateData[0].rate
                        ? <TrendingDown className="h-4 w-4 text-[#9B87F5]" />
                        : <TrendingUp className="h-4 w-4 text-destructive" />
                    )}
                  </CardTitle>
                  <CardDescription>Daily escalation % of completed conversations</CardDescription>
                </CardHeader>
                <CardContent>
                  {escalationRateData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Not enough data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="h-[250px] w-full">
                      <LineChart data={escalationRateData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" />
                        <YAxis unit="%" allowDecimals={false} className="text-xs" />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line type="monotone" dataKey="rate" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ── Gmail section ── */}
        {(sourceFilter === "all" || sourceFilter === "gmail") && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Gmail</h2>
              <div className="mt-2 h-px w-full bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <Mail className="mb-2 h-5 w-5 text-amber-500" />
                  <p className="text-3xl font-bold text-foreground">{stats.emailTotal}</p>
                  <p className="text-xs text-muted-foreground">Email total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <ThumbsUp className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-3xl font-bold text-foreground">{stats.gmailResolved}</p>
                  <p className="text-xs text-muted-foreground">Gmail resolved</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <AlertCircle className="mb-2 h-5 w-5 text-orange-500" />
                  <p className="text-3xl font-bold text-foreground">{stats.gmailOpen}</p>
                  <p className="text-xs text-muted-foreground">Gmail open</p>
                </CardContent>
              </Card>
            </div>

            {/* Gmail resolution time */}
            {gmailResolutionStats && (
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="flex flex-col items-center justify-center p-5">
                    <Timer className="mb-2 h-5 w-5 text-amber-500" />
                    <p className="text-3xl font-bold text-foreground">{formatDuration(gmailResolutionStats.median)}</p>
                    <p className="text-xs text-muted-foreground">Gmail median resolution</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col items-center justify-center p-5">
                    <Clock className="mb-2 h-5 w-5 text-muted-foreground" />
                    <p className="text-3xl font-bold text-foreground">{formatDuration(gmailResolutionStats.avg)}</p>
                    <p className="text-xs text-muted-foreground">Gmail avg resolution</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Threads by customer domain */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Threads by customer</CardTitle>
                <CardDescription>Gmail threads grouped by customer email domain (excluding @lovable.dev)</CardDescription>
              </CardHeader>
              <CardContent>
                {customerDomainData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No customer domain data yet — threads need To/CC headers (populated on next Gmail poll)</p>
                ) : (
                  <ChartContainer config={chartConfig} className="w-full" style={{ height: Math.max(200, customerDomainData.length * 40) }}>
                    <BarChart data={customerDomainData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} className="text-xs" />
                      <YAxis type="category" dataKey="domain" className="text-xs" width={160} tick={{ fontSize: 12 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="threads" fill="#E66FD2" radius={[0, 4, 4, 0]}>
                        <LabelList dataKey="threads" position="right" className="text-xs fill-foreground" />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Manual entries section ── */}
        {(sourceFilter === "all" || sourceFilter === "manual" || sourceFilter === "intercom") && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Manual entries</h2>
              <div className="mt-2 h-px w-full bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <MessageSquare className="mb-2 h-5 w-5 text-[#4ECDC4]" />
                  <p className="text-3xl font-bold text-foreground">{stats.manualTotal}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <Activity className="mb-2 h-5 w-5 text-[#4ECDC4]" />
                  <p className="text-3xl font-bold text-foreground">{stats.manualActive}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <ThumbsUp className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-3xl font-bold text-foreground">{stats.manualResolved}</p>
                  <p className="text-xs text-muted-foreground">Resolved</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">By source</CardTitle>
                  <CardDescription>Manual entries grouped by conversation source</CardDescription>
                </CardHeader>
                <CardContent>
                  {manualBySource.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="w-full" style={{ height: Math.max(200, manualBySource.length * 48) }}>
                      <BarChart data={manualBySource} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} className="text-xs" />
                        <YAxis type="category" dataKey="source" className="text-xs" width={120} tick={{ fontSize: 12 }} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" fill="#4ECDC4" radius={[0, 4, 4, 0]}>
                          <LabelList dataKey="count" position="right" className="text-xs fill-foreground" />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">By owner</CardTitle>
                  <CardDescription>Manual entries grouped by assigned owner</CardDescription>
                </CardHeader>
                <CardContent>
                  {manualByOwner.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="w-full" style={{ height: Math.max(200, manualByOwner.length * 48) }}>
                      <BarChart data={manualByOwner} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} className="text-xs" />
                        <YAxis type="category" dataKey="owner" className="text-xs" width={120} tick={{ fontSize: 12 }} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" fill="#4ECDC4" radius={[0, 4, 4, 0]}>
                          <LabelList dataKey="count" position="right" className="text-xs fill-foreground" />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}


        {/* ── Intercom section ── */}
        {(sourceFilter === "all" || sourceFilter === "intercom") && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Intercom</h2>
              <p className="mt-1 text-xs text-muted-foreground">Tickets imported from Intercom (webhook, poller, and backfill)</p>
              <div className="mt-2 h-px w-full bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <MessageSquare className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-3xl font-bold text-foreground">{intercomStats.total}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <Activity className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-3xl font-bold text-foreground">{intercomStats.active}</p>
                  <p className="text-xs text-muted-foreground">Active / open</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <ThumbsUp className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-3xl font-bold text-foreground">{intercomStats.resolved}</p>
                  <p className="text-xs text-muted-foreground">Resolved ({intercomStats.resolvedPct}%)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <TrendingUp className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-3xl font-bold text-foreground">
                    {intercomStats.avgResolutionMins == null
                      ? "—"
                      : intercomStats.avgResolutionMins < 60
                        ? `${intercomStats.avgResolutionMins}m`
                        : `${(intercomStats.avgResolutionMins / 60).toFixed(1)}h`}
                  </p>
                  <p className="text-xs text-muted-foreground">Avg resolution time</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <AlertTriangle className="mb-2 h-5 w-5 text-[#FF6B6B]" />
                  <p className="text-3xl font-bold text-foreground">{intercomStats.escalationPct}%</p>
                  <p className="text-xs text-muted-foreground">Escalation rate</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <AlertTriangle className="mb-2 h-5 w-5 text-[#FF6B6B]" />
                  <p className="text-3xl font-bold text-foreground">{intercomStats.bugPct}%</p>
                  <p className="text-xs text-muted-foreground">Bug rate ({intercomStats.bugs})</p>
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
                <CardContent className="flex flex-col items-center justify-center p-5">
                  <MessageSquare className="mb-2 h-5 w-5 text-[#9B87F5]" />
                  <p className="text-2xl font-bold text-foreground">{intercomStats.topArea}</p>
                  <p className="text-xs text-muted-foreground">Top product area</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Volume over time</CardTitle>
                <CardDescription>Intercom tickets per day</CardDescription>
              </CardHeader>
              <CardContent>
                {intercomVolumeData.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <ChartContainer config={chartConfig} className="h-[260px] w-full">
                    <AreaChart data={intercomVolumeData}>
                      <defs>
                        <linearGradient id="gradIntercom" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="count" stroke="#F59E0B" fill="url(#gradIntercom)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Status breakdown</CardTitle>
                  <CardDescription>Intercom tickets by status</CardDescription>
                </CardHeader>
                <CardContent>
                  {intercomStatusData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="w-full" style={{ height: Math.max(200, intercomStatusData.length * 48) }}>
                      <BarChart data={intercomStatusData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} className="text-xs" />
                        <YAxis type="category" dataKey="status" className="text-xs" width={120} tick={{ fontSize: 12 }} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" fill="#F59E0B" radius={[0, 4, 4, 0]}>
                          <LabelList dataKey="count" position="right" className="text-xs fill-foreground" />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">By product area</CardTitle>
                  <CardDescription>Intercom tickets grouped by product area</CardDescription>
                </CardHeader>
                <CardContent>
                  {intercomByArea.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="w-full" style={{ height: Math.max(200, intercomByArea.length * 48) }}>
                      <BarChart data={intercomByArea} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} className="text-xs" />
                        <YAxis type="category" dataKey="area" className="text-xs" width={140} tick={{ fontSize: 12 }} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" fill="#E66FD2" radius={[0, 4, 4, 0]}>
                          <LabelList dataKey="count" position="right" className="text-xs fill-foreground" />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}


        {peakDay && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-6 p-5">
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Peak day:</span>
                <span className="font-semibold text-foreground">{peakDay.label}</span>
                <span className="text-muted-foreground">({peakDay.total} conversations)</span>
              </div>
              {stats.active > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">Currently active:</span>
                  <span className="font-semibold text-foreground">{stats.active}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Customer satisfaction (Intercom CSAT) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Customer satisfaction</CardTitle>
            <CardDescription>
              Ratings collected by Intercom after a conversation is resolved.
              {csatStats.total === 0 && " No ratings in the current selection yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Average CSAT</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-foreground">
                    {csatStats.total > 0 ? csatStats.avg.toFixed(1) : "—"}
                  </span>
                  {csatStats.total > 0 && <span className="text-sm text-muted-foreground">/ 5</span>}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Total ratings</div>
                <div className="mt-1 text-3xl font-bold text-foreground">{csatStats.total}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Response rate</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-foreground">
                    {csatStats.responseRateBase > 0 ? `${csatStats.responseRate.toFixed(0)}%` : "—"}
                  </span>
                  {csatStats.responseRateBase > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {csatStats.total} / {csatStats.responseRateBase} resolved
                    </span>
                  )}
                </div>
              </div>
            </div>

            {csatStats.total > 0 && (
              <div>
                <div className="mb-2 text-sm font-medium text-foreground">Rating distribution</div>
                <ChartContainer config={{ count: { label: "Ratings", color: "#9B87F5" } }} className="h-[180px] w-full">
                  <BarChart data={csatStats.distribution} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} className="stroke-muted" />
                    <XAxis type="number" allowDecimals={false} className="text-xs" />
                    <YAxis
                      type="category"
                      dataKey="rating"
                      className="text-xs"
                      width={48}
                      tickFormatter={(v) => `${v}★`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {csatStats.distribution.map((d) => (
                        <Cell key={d.rating} fill={ratingColor(d.rating)} />
                      ))}
                      <LabelList dataKey="count" position="right" className="text-xs fill-foreground" />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            )}

            {lowCsatRows.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <ThumbsDown className="h-4 w-4 text-destructive" />
                  Recent low ratings (1–2★)
                </div>
                <div className="space-y-2">
                  {lowCsatRows.map((r) => (
                    <button
                      key={`${r.source}-${r.id}`}
                      type="button"
                      onClick={() => navigate(`/conversations/${r.source}/${r.id}`)}
                      className="flex w-full items-start gap-3 rounded-md border border-border bg-card p-3 text-left transition hover:bg-accent"
                    >
                      <span
                        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: ratingColor(r.rating) }}
                      >
                        {r.rating}★
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{r.subject}</div>
                        {r.remark && (
                          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">"{r.remark}"</div>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {r.rated_at ? format(parseISO(r.rated_at), "MMM dd, yyyy") : "—"} · {r.source}
                        </div>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Stats;
