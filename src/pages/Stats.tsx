import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import { RefreshCw, MessageSquare, ThumbsUp, ThumbsDown, Clock, ExternalLink, TrendingUp, TrendingDown, Activity, CalendarIcon, ChevronDown, Timer, AlertCircle, XCircle, ArrowUpRight, Mail, FileDown } from "lucide-react";
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
  status: string;
  created_at: string;
  resolved_at: string | null;
  is_test: boolean;
  slack_channel_id: string;
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
}

interface ManualRow {
  status: string;
  created_at: string;
  is_test: boolean;
  source: string;
  owner: string | null;
  classification: string | null;
}

type SourceFilter = "all" | "slack" | "gmail" | "manual";
type TimeRange = "this_month" | "7d" | "30d" | "90d" | "all" | "custom";

const chartConfig = {
  resolved: { label: "Resolved", color: "#9B87F5" },
  escalated: { label: "Escalated to human", color: "hsl(var(--destructive))" },
  cancelled: { label: "Cancelled", color: "hsl(var(--muted-foreground))" },
  open: { label: "Open", color: "#FF6B6B" },
  active: { label: "Active", color: "#FF6B6B" },
  awaiting_context: { label: "Awaiting customer", color: "hsl(var(--muted-foreground))" },
  awaiting_support: { label: "Awaiting support", color: "hsl(var(--muted-foreground))" },
  total: { label: "Total", color: "#FF6B6B" },
  slack: { label: "Slack", color: "#FF6B6B" },
  gmail: { label: "Gmail", color: "#E66FD2" },
  manual: { label: "Manual entry", color: "#4ECDC4" },
  cumulative: { label: "Cumulative", color: "#FF6B6B" },
  rate: { label: "Escalation rate", color: "hsl(var(--destructive))" },
  resolution: { label: "Resolution time", color: "#9B87F5" },
};

const rangeLabel: Record<TimeRange, string> = {
  this_month: "This month",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom range",
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
        .select("status, created_at, is_test, slack_channel_id, resolved_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("gmail_conversations")
        .select("received_at, created_at, is_test, subject, status, resolved_at, gmail_thread_id, from_email, to_emails, cc_emails")
        .order("received_at", { ascending: true }),
      supabase
        .from("manual_conversations")
        .select("status, created_at, is_test, source, owner, classification")
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
      if (range === "this_month") {
        matchRange = isAfter(parsed, startOfDay(startOfMonth(new Date()))) || parsed.getTime() === startOfDay(startOfMonth(new Date())).getTime();
        matchRange = matchRange && (isBefore(parsed, endOfDay(endOfMonth(new Date()))) || parsed.getTime() === endOfDay(endOfMonth(new Date())).getTime());
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      const matchChannel = selectedChannels.length === 0 || selectedChannels.includes(m.slack_channel_id);
      return matchView && matchRange && matchChannel;
    });
  }, [data, view, range, customFrom, customTo, selectedChannels]);

  const filteredGmail = useMemo(() => {
    const cutoff = getCutoffDate(range);
    return gmailData.filter((g) => {
      const matchView = view === "test" ? g.is_test : !g.is_test;
      const dateStr = g.received_at || g.created_at;
      const parsed = parseISO(dateStr);
      let matchRange: boolean;
      if (range === "this_month") {
        matchRange = (isAfter(parsed, startOfDay(startOfMonth(new Date()))) || parsed.getTime() === startOfDay(startOfMonth(new Date())).getTime()) &&
                     (isBefore(parsed, endOfDay(endOfMonth(new Date()))) || parsed.getTime() === endOfDay(endOfMonth(new Date())).getTime());
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      if (!matchView || !matchRange) return false;
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

  const filteredManual = useMemo(() => {
    const cutoff = getCutoffDate(range);
    return manualData.filter((m) => {
      const matchView = view === "test" ? m.is_test : !m.is_test;
      const parsed = parseISO(m.created_at);
      let matchRange: boolean;
      if (range === "this_month") {
        matchRange = (isAfter(parsed, startOfDay(startOfMonth(new Date()))) || parsed.getTime() === startOfDay(startOfMonth(new Date())).getTime()) &&
                     (isBefore(parsed, endOfDay(endOfMonth(new Date()))) || parsed.getTime() === endOfDay(endOfMonth(new Date())).getTime());
      } else if (range === "custom") {
        matchRange = (!customFrom || isAfter(parsed, startOfDay(customFrom))) &&
                     (!customTo || isBefore(parsed, endOfDay(customTo)));
      } else {
        matchRange = cutoff ? isAfter(parsed, cutoff) : true;
      }
      return matchView && matchRange;
    });
  }, [manualData, view, range, customFrom, customTo]);

  const gmailUniqueEmails = useMemo(() => {
    const subjects = new Set<string>();
    let nullCount = 0;
    filteredGmail.forEach((g) => {
      if (g.subject) subjects.add(g.subject);
      else nullCount++;
    });
    return subjects.size + nullCount;
  }, [filteredGmail]);

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
    // Group threads by subject (same dedup as email total), then extract customer domain
    const threadDomains: Record<string, string | null> = {};
    let orphanIdx = 0;
    filteredGmail.forEach((g) => {
      const threadKey = g.subject || `__orphan_${orphanIdx++}`;
      if (threadDomains[threadKey] !== undefined) return; // already processed this thread
      const allEmails = [g.from_email, g.to_emails, g.cc_emails]
        .filter(Boolean)
        .join(",")
        .split(",")
        .map((e) => {
          // Extract email from RFC format like "Name <email@domain.com>" or bare "email@domain.com>"
          const match = e.match(/<([^>]+)>/);
          return (match ? match[1] : e).trim().toLowerCase();
        })
        .filter((e) => e.includes("@") && !e.endsWith("@lovable.dev"));
      threadDomains[threadKey] = allEmails.length > 0 ? allEmails[0].split("@")[1] : null;
    });
    const domainCounts: Record<string, number> = {};
    Object.values(threadDomains).forEach((domain) => {
      if (!domain) return;
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    });
    return Object.entries(domainCounts)
      .map(([domain, count]) => ({ domain, threads: count }))
      .sort((a, b) => b.threads - a.threads);
  }, [filteredGmail]);

  const gmailVolumeData = useMemo(() => {
    const byDay: Record<string, number> = {};
    const seenPerDay: Record<string, Set<string>> = {};
    filteredGmail.forEach((g) => {
      const day = format(parseISO(g.received_at || g.created_at), "yyyy-MM-dd");
      if (!seenPerDay[day]) seenPerDay[day] = new Set();
      if (g.subject) {
        if (seenPerDay[day].has(g.subject)) return;
        seenPerDay[day].add(g.subject);
      }
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return byDay;
  }, [filteredGmail]);

  const manualVolumeData = useMemo(() => {
    const byDay: Record<string, number> = {};
    filteredManual.forEach((m) => {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return byDay;
  }, [filteredManual]);

  const mergedVolumeData = useMemo(() => {
    const allDays = new Set<string>();
    filtered.forEach((m) => allDays.add(format(parseISO(m.created_at), "yyyy-MM-dd")));
    filteredGmail.forEach((g) => allDays.add(format(parseISO(g.received_at || g.created_at), "yyyy-MM-dd")));
    filteredManual.forEach((m) => allDays.add(format(parseISO(m.created_at), "yyyy-MM-dd")));
    
    const slackByDay: Record<string, number> = {};
    filtered.forEach((m) => {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      slackByDay[day] = (slackByDay[day] || 0) + 1;
    });

    return [...allDays].sort().map((day) => ({
      date: day,
      label: format(parseISO(day), "MMM dd"),
      slack: slackByDay[day] || 0,
      gmail: gmailVolumeData[day] || 0,
      manual: manualVolumeData[day] || 0,
    }));
  }, [filtered, filteredGmail, filteredManual, gmailVolumeData, manualVolumeData]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const gmailTotal = filteredGmail.length;
    const manualTotal = filteredManual.length;
    const resolved = filtered.filter((m) => m.status === "resolved").length;
    const escalated = filtered.filter((m) => m.status === "escalated" || m.status === "escalated_pending").length;
    const active = filtered.filter((m) => m.status === "active" || m.status === "active_pending").length;
    const awaiting = filtered.filter((m) => m.status === "awaiting_context" || m.status === "awaiting_support" || m.status === "awaiting_engineering").length;
    const processing = filtered.filter((m) => m.status === "processing").length;
    const cancelled = filtered.filter((m) => m.status === "cancelled").length;
    const open = total - resolved - cancelled;
    const feedbackTotal = total - cancelled;
    const resolvedPct = feedbackTotal ? Math.round((resolved / feedbackTotal) * 100) : 0;

    const manualActive = filteredManual.filter((m) => m.status === "active").length;
    const manualResolved = filteredManual.filter((m) => m.status === "resolved").length;

    const cutoff = getCutoffDate(range);
    // gmailDeduped computed below; use gmailTotal as placeholder, overwritten after
    // use gmailDeduped (computed below) — but we need it before the return,
    // so compute a quick dedup count inline for avgPerDay
    const gmailDedupedForAvg = (() => {
      const subjs = new Set<string>();
      let orphans = 0;
      filteredGmail.forEach((g) => { if (g.subject) subjs.add(g.subject); else orphans++; });
      return subjs.size + orphans;
    })();
    let combinedTotal = total + gmailDedupedForAvg + manualTotal;
    if (sourceFilter === "gmail") combinedTotal = gmailDedupedForAvg;
    else if (sourceFilter === "slack") combinedTotal = total;
    else if (sourceFilter === "manual") combinedTotal = manualTotal;
    const daySpan = range === "this_month"
      ? differenceInDays(new Date(), startOfMonth(new Date())) || 1
      : cutoff
        ? differenceInDays(new Date(), cutoff) || 1
        : filtered.length > 0
          ? differenceInDays(new Date(), parseISO(filtered[0].created_at)) || 1
          : 1;
    const avgPerDay = +(combinedTotal / daySpan).toFixed(1);

    const gmailAllSubjects = new Set<string>();
    let gmailAllOrphans = 0;
    const gmailResolvedSubjects = new Set<string>();
    let gmailResolvedOrphans = 0;
    const gmailOpenSubjects = new Set<string>();
    let gmailOpenOrphans = 0;
    filteredGmail.forEach((g) => {
      if (g.subject) gmailAllSubjects.add(g.subject);
      else gmailAllOrphans++;
      if (g.status === "resolved") {
        if (g.subject) gmailResolvedSubjects.add(g.subject);
        else gmailResolvedOrphans++;
      } else if (g.status === "open") {
        if (g.subject) gmailOpenSubjects.add(g.subject);
        else gmailOpenOrphans++;
      }
    });
    const gmailDeduped = gmailAllSubjects.size + gmailAllOrphans;
    const gmailResolvedCount = gmailResolvedSubjects.size + gmailResolvedOrphans;
    const gmailOpen = gmailOpenSubjects.size + gmailOpenOrphans;

    return { total, gmailTotal, gmailDeduped, emailTotal: gmailUniqueEmails, resolved, escalated, active, awaiting, processing, cancelled, open, resolvedPct, avgPerDay, gmailResolved: gmailResolvedCount, gmailOpen, manualTotal, manualActive, manualResolved };
  }, [filtered, filteredGmail, filteredManual, range, sourceFilter, gmailUniqueEmails]);

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
    const byDay: Record<string, { date: string; total: number; resolved: number; open: number; cancelled: number; escalated: number }> = {};
    filtered.forEach((m) => {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      if (!byDay[day]) byDay[day] = { date: day, total: 0, resolved: 0, open: 0, cancelled: 0, escalated: 0 };
      byDay[day].total++;
      const isEscalated = m.status === "escalated" || m.status === "escalated_pending";
      if (m.status === "resolved") byDay[day].resolved++;
      else if (m.status === "cancelled") byDay[day].cancelled++;
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
      if (m.status === "escalated" || m.status === "escalated_pending") {
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
      .filter((d) => d.resolved > 0 || d.open > 0 || d.cancelled > 0 || d.escalated > 0)
      .map((d) => ({ date: d.label, resolved: d.resolved, open: d.open, cancelled: d.cancelled, escalated: d.escalated }));
  }, [volumeData]);

  const pieData = useMemo(() => {
    return [
      { name: "Resolved", value: stats.resolved, fill: chartConfig.resolved.color },
      { name: "Open", value: stats.open - stats.escalated, fill: chartConfig.open.color },
      { name: "Escalated to human", value: stats.escalated, fill: chartConfig.escalated.color },
      { name: "Cancelled", value: stats.cancelled, fill: chartConfig.cancelled.color },
    ].filter((d) => d.value > 0);
  }, [stats]);

  // Channel breakdown data
  const channelData = useMemo(() => {
    const byChannel: Record<string, { channel: string; total: number }> = {};
    filtered.forEach((m) => {
      const id = m.slack_channel_id;
      if (!id) return;
      const name = channelNames[id] || channelNameOverrides[id] || (id.startsWith("D") ? "Direct message" : id);
      if (!byChannel[id]) byChannel[id] = { channel: name, total: 0 };
      byChannel[id].total++;
    });
    return Object.values(byChannel).sort((a, b) => b.total - a.total);
  }, [filtered, channelNames]);

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
    }));
    const getCETHour = (dateStr: string) => {
      const d = new Date(dateStr);
      return parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }));
    };
    filtered.forEach((m) => { buckets[getCETHour(m.created_at)].slack++; });
    const gmailSeenPerHour: Record<number, Set<string>> = {};
    filteredGmail.forEach((g) => {
      const h = getCETHour(g.received_at || g.created_at);
      if (!gmailSeenPerHour[h]) gmailSeenPerHour[h] = new Set();
      if (g.subject) {
        if (gmailSeenPerHour[h].has(g.subject)) return;
        gmailSeenPerHour[h].add(g.subject);
      }
      buckets[h].gmail++;
    });
    filteredManual.forEach((m) => { buckets[getCETHour(m.created_at)].manual++; });
    return buckets;
  }, [filtered, filteredGmail, filteredManual]);

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

  const heatmapData = useMemo(() => {
    const grid: Record<string, Record<number, { slack: number; gmail: number; manual: number; total: number }>> = {};
    DAYS.forEach((d) => {
      grid[d] = {};
      for (let h = 0; h < 24; h++) grid[d][h] = { slack: 0, gmail: 0, manual: 0, total: 0 };
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
    const gmailSeenPerCell: Record<string, Set<string>> = {};
    filteredGmail.forEach((g) => {
      const { day, hour } = getCET(g.received_at || g.created_at);
      if (!grid[day]) return;
      const cellKey = `${day}-${hour}`;
      if (!gmailSeenPerCell[cellKey]) gmailSeenPerCell[cellKey] = new Set();
      if (g.subject) {
        if (gmailSeenPerCell[cellKey].has(g.subject)) return;
        gmailSeenPerCell[cellKey].add(g.subject);
      }
      grid[day][hour].gmail++; grid[day][hour].total++;
    });
    filteredManual.forEach((m) => {
      const { day, hour } = getCET(m.created_at);
      if (grid[day]) { grid[day][hour].manual++; grid[day][hour].total++; }
    });

    let max = 0;
    DAYS.forEach((d) => {
      for (let h = 0; h < 24; h++) {
        const cell = grid[d][h];
        const val = sourceFilter === "slack" ? cell.slack : sourceFilter === "gmail" ? cell.gmail : sourceFilter === "manual" ? cell.manual : cell.total;
        if (val > max) max = val;
      }
    });

    return { grid, max };
  }, [filtered, filteredGmail, filteredManual, sourceFilter]);

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
              {volumeData.length === 0 && filteredGmail.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <AreaChart data={mergedVolumeData}>
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
              {hourlyActivityData.every((b) => b.slack === 0 && b.gmail === 0 && b.manual === 0) ? (
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
                          const val = sourceFilter === "slack" ? cell.slack : sourceFilter === "gmail" ? cell.gmail : sourceFilter === "manual" ? cell.manual : cell.total;
                          const opacity = heatmapData.max > 0 ? Math.max(0.08, val / heatmapData.max) : 0;
                          return (
                            <div
                              key={h}
                              className={cn(
                                "flex-1 aspect-square rounded-sm bg-primary transition-opacity",
                                val > 0 && "cursor-pointer hover:ring-2 hover:ring-primary/50"
                              )}
                              style={{ opacity: val > 0 ? opacity : 0.04 }}
                              title={`${day} ${String(h).padStart(2, "0")}:00 — Slack: ${cell.slack}, Gmail: ${cell.gmail}, Manual: ${cell.manual}, Total: ${cell.total}`}
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
                  <XCircle className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-3xl font-bold text-foreground">{stats.cancelled}</p>
                  <p className="text-xs text-muted-foreground">Cancelled</p>
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
                <CardDescription>Total conversations per Slack channel</CardDescription>
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
                      <Bar dataKey="total" fill="#FF6B6B" radius={[0, 4, 4, 0]}>
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
                  <CardDescription>Resolved vs open vs escalated vs cancelled per day</CardDescription>
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
                        <Bar dataKey="cancelled" fill={chartConfig.cancelled.color} radius={[4, 4, 0, 0]} />
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
        {(sourceFilter === "all" || sourceFilter === "manual") && (
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


        {/* Insights footer */}
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
      </div>
    </AppLayout>
  );
};

export default Stats;
