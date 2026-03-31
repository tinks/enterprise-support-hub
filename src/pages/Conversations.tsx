import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ExternalLink, Hash, User, Mail, X, ArrowLeft, Bug, Filter, GripVertical, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { channelNameOverrides } from "@/lib/channelOverrides";

interface ConversationMapping {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  slack_user_id: string;
  intercom_conversation_id: string;
  status: string;
  created_at: string;
  is_test: boolean;
  original_message_text: string;
  product_area: string | null;
  is_bug: boolean;
  is_feature_request: boolean;
}

interface GmailConversation {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  snippet: string | null;
  is_test: boolean;
  created_at: string;
  status: string;
  resolved_at: string | null;
  product_area: string | null;
  is_bug: boolean;
  is_feature_request: boolean;
}

type SourceFilter = "all" | "slack" | "gmail";

type UnifiedRow =
  | { source: "slack"; data: ConversationMapping; sortDate: string }
  | { source: "gmail"; data: GmailConversation; sortDate: string };

type NameMap = Record<string, string>;

const statusColor = (status: string) => {
  switch (status) {
    case "active": return "default" as const;
    case "resolved": return "secondary" as const;
    case "escalated": return "destructive" as const;
    case "cancelled": return "outline" as const;
    default: return "outline" as const;
  }
};

const buildSlackLink = (channelId: string, threadTs: string) =>
  `https://lovable-dev.slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;

const getCET = (dateStr: string) => {
  const d = new Date(dateStr);
  return {
    day: d.toLocaleDateString("en-GB", { timeZone: "Europe/Berlin", weekday: "short" }),
    hour: parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false })),
  };
};

const Conversations = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramDay = searchParams.get("day");
  const paramHour = searchParams.get("hour") !== null ? parseInt(searchParams.get("hour")!) : null;
  const paramSource = searchParams.get("source") as SourceFilter | null;

  const [mappings, setMappings] = useState<ConversationMapping[]>([]);
  const [gmailRows, setGmailRows] = useState<GmailConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [userNames, setUserNames] = useState<NameMap>({});
  const [channelNames, setChannelNames] = useState<NameMap>({});
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [gmailOffset, setGmailOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [hasMoreGmail, setHasMoreGmail] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const savedSource = localStorage.getItem("conv-source-filter") as SourceFilter | null;
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(paramSource || savedSource || "all");

  const ALL_STATUSES = ["active", "awaiting_context", "escalated", "resolved", "cancelled", "test"] as const;
  const savedHidden = localStorage.getItem("conv-hidden-statuses");
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(
    savedHidden ? new Set(JSON.parse(savedHidden)) : new Set(["test", "cancelled", "resolved"])
  );

  useEffect(() => { localStorage.setItem("conv-source-filter", sourceFilter); }, [sourceFilter]);
  useEffect(() => { localStorage.setItem("conv-hidden-statuses", JSON.stringify([...hiddenStatuses])); }, [hiddenStatuses]);

  const toggleHidden = (status: string) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const toggleMessage = (id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTest = async (id: string, currentValue: boolean, source: "slack" | "gmail") => {
    const newValue = !currentValue;
    if (source === "slack") {
      setMappings((prev) => prev.map((m) => m.id === id ? { ...m, is_test: newValue } : m));
      const { error } = await supabase.from("conversation_mappings").update({ is_test: newValue }).eq("id", id);
      if (error) {
        setMappings((prev) => prev.map((m) => m.id === id ? { ...m, is_test: currentValue } : m));
        toast.error("Failed to update test flag");
      }
    } else {
      setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, is_test: newValue } : m));
      const { error } = await supabase.from("gmail_conversations").update({ is_test: newValue }).eq("id", id);
      if (error) {
        setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, is_test: currentValue } : m));
        toast.error("Failed to update test flag");
      }
    }
  };

  const toggleResolved = async (id: string, currentStatus: string, source: "slack" | "gmail") => {
    const isResolved = currentStatus === "resolved";
    const newStatus = isResolved ? (source === "slack" ? "active" : "open") : "resolved";
    const resolvedAt = isResolved ? null : new Date().toISOString();

    if (source === "slack") {
      setMappings((prev) => prev.map((m) => m.id === id ? { ...m, status: newStatus, resolved_at: resolvedAt } as ConversationMapping : m));
      const { error } = await supabase.from("conversation_mappings").update({ status: newStatus, resolved_at: resolvedAt }).eq("id", id);
      if (error) {
        setMappings((prev) => prev.map((m) => m.id === id ? { ...m, status: currentStatus } : m));
        toast.error("Failed to update resolved status");
      }
    } else {
      setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, status: newStatus, resolved_at: resolvedAt } : m));
      const { error } = await supabase.from("gmail_conversations").update({ status: newStatus, resolved_at: resolvedAt }).eq("id", id);
      if (error) {
        setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, status: currentStatus } : m));
        toast.error("Failed to update resolved status");
      }
    }
  };

  const [productAreas, setProductAreas] = useState<string[]>(["SSO", "SCIM", "Credits", "Account access", "Remix/transfer", "Cloud/AI"]);

  const updateProductArea = async (id: string, value: string, source: "slack" | "gmail") => {
    const newValue = value === "clear" ? null : value;
    const table = source === "slack" ? "conversation_mappings" : "gmail_conversations";
    const setState = source === "slack" ? setMappings : setGmailRows;

    setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, product_area: newValue } : m));
    const { error } = await supabase.from(table).update({ product_area: newValue } as any).eq("id", id);
    if (error) {
      setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, product_area: value === "clear" ? value : null } : m));
      toast.error("Failed to update product area");
    }
  };

  const toggleBug = async (id: string, currentValue: boolean, source: "slack" | "gmail") => {
    const newValue = !currentValue;
    const table = source === "slack" ? "conversation_mappings" : "gmail_conversations";
    const setState = source === "slack" ? setMappings : setGmailRows;

    setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, is_bug: newValue } : m));
    const { error } = await supabase.from(table).update({ is_bug: newValue } as any).eq("id", id);
    if (error) {
      setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, is_bug: currentValue } : m));
      toast.error("Failed to update bug flag");
    }
  };

  const toggleFeatureRequest = async (id: string, currentValue: boolean, source: "slack" | "gmail") => {
    const newValue = !currentValue;
    const table = source === "slack" ? "conversation_mappings" : "gmail_conversations";
    const setState = source === "slack" ? setMappings : setGmailRows;

    setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, is_feature_request: newValue } : m));
    const { error } = await supabase.from(table).update({ is_feature_request: newValue } as any).eq("id", id);
    if (error) {
      setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, is_feature_request: currentValue } : m));
      toast.error("Failed to update feature request flag");
    }
  };

  const loadLookups = async (rows: ConversationMapping[]) => {
    const usersRes = await supabase.functions.invoke("list-slack-users");
    if (usersRes.data?.users) {
      const map: NameMap = {};
      for (const u of usersRes.data.users) {
        map[u.id] = u.display_name || u.real_name || u.name;
      }
      setUserNames(map);
    }

    const uniqueChannelIds = [...new Set(rows.map((r) => r.slack_channel_id))];
    const channelsRes = await supabase.functions.invoke("list-slack-channels", {
      body: { channelIds: uniqueChannelIds },
    });
    if (channelsRes.data?.channels) {
      const map: NameMap = {};
      for (const c of channelsRes.data.channels) {
        if (uniqueChannelIds.includes(c.id)) {
          map[c.id] = c.name;
        }
      }
      for (const channelId of uniqueChannelIds) {
        if (!map[channelId] && channelNameOverrides[channelId]) {
          map[channelId] = channelNameOverrides[channelId];
        }
      }
      setChannelNames(map);
    }
  };

  const isHeatmapMode = paramDay !== null && paramHour !== null;

  const loadData = async (append = false) => {
    const currentOffset = append ? offset : 0;
    const currentGmailOffset = append ? gmailOffset : 0;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setOffset(0);
      setGmailOffset(0);
    }

    const pageSize = isHeatmapMode ? 1000 : 50;

    const [slackRes, gmailRes] = await Promise.all([
      supabase
        .from("conversation_mappings")
        .select("*")
        .order("created_at", { ascending: false })
        .range(currentOffset, currentOffset + pageSize - 1),
      supabase
        .from("gmail_conversations")
        .select("*")
        .order("received_at", { ascending: false })
        .range(currentGmailOffset, currentGmailOffset + pageSize - 1),
    ]);

    const slackRows = (slackRes.data ?? []) as unknown as ConversationMapping[];
    const gmailData = (gmailRes.data ?? []) as unknown as GmailConversation[];

    setHasMore(slackRows.length === pageSize);
    setHasMoreGmail(gmailData.length === pageSize);

    if (append) {
      setMappings((prev) => [...prev, ...slackRows]);
      setGmailRows((prev) => [...prev, ...gmailData]);
      setOffset(currentOffset + pageSize);
      setGmailOffset(currentGmailOffset + pageSize);
      setLoadingMore(false);
    } else {
      setMappings(slackRows);
      setGmailRows(gmailData);
      setOffset(pageSize);
      setGmailOffset(pageSize);
      setLoading(false);
    }
    return slackRows;
  };

  useEffect(() => {
    loadData().then((rows) => loadLookups(rows));
    supabase.from("settings").select("product_areas").limit(1).single().then(({ data }) => {
      if (data?.product_areas) {
        setProductAreas(data.product_areas.split(",").map((s: string) => s.trim()).filter(Boolean));
      }
    });
  }, []);

  const unified = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [];

    if (sourceFilter !== "gmail") {
      for (const m of mappings) {
        rows.push({ source: "slack", data: m, sortDate: m.created_at });
      }
    }
    if (sourceFilter !== "slack") {
      for (const g of gmailRows) {
        rows.push({ source: "gmail", data: g, sortDate: g.received_at || g.created_at });
      }
    }

    rows.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());

    // Apply heatmap filter from query params
    if (paramDay !== null && paramHour !== null) {
      return rows.filter((r) => {
        const { day, hour } = getCET(r.sortDate);
        return day === paramDay && hour === paramHour;
      });
    }

    // Apply status filter
    const filtered = hiddenStatuses.size > 0
      ? rows.filter((r) => {
          if (hiddenStatuses.has("test") && r.data.is_test) return false;
          if (hiddenStatuses.has(r.data.status)) return false;
          return true;
        })
      : rows;

    return filtered;
  }, [mappings, gmailRows, sourceFilter, paramDay, paramHour, hiddenStatuses]);

  const canLoadMore =
    !isHeatmapMode && ((sourceFilter !== "gmail" && hasMore) || (sourceFilter !== "slack" && hasMoreGmail));

  return (
    <AppLayout>
      <div className="h-full min-h-0 flex flex-col bg-background p-6">
        <div className="mx-auto max-w-7xl w-full min-h-0 flex flex-col flex-1">
          {paramDay !== null && paramHour !== null && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
              <span className="text-foreground">
                Showing activity for <strong>{paramDay} {String(paramHour).padStart(2, "0")}:00–{String(paramHour).padStart(2, "0")}:59 CET</strong>
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => navigate("/")}
                >
                  <ArrowLeft className="mr-1 h-3 w-3" /> Back to stats
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setSearchParams({})}
                >
                  <X className="mr-1 h-3 w-3" /> Clear filter
                </Button>
              </div>
            </div>
          )}
          <Card className="min-h-0 flex-1 flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between flex-shrink-0">
              <div>
                <CardTitle className="text-lg">Recent conversations</CardTitle>
                <CardDescription>
                  Slack thread ↔ Intercom conversation mappings + Gmail emails
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
                  <SelectTrigger className="w-[130px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="slack">Slack only</SelectItem>
                    <SelectItem value="gmail">Gmail only</SelectItem>
                  </SelectContent>
                </Select>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-1">
                      <Filter className="h-3 w-3" />
                      Status
                      {hiddenStatuses.size > 0 && (
                        <Badge variant="secondary" className="ml-1 h-5 px-1 text-xs">
                          {hiddenStatuses.size} hidden
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-3" align="end">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Hide statuses</p>
                    <div className="flex flex-col gap-2">
                      {ALL_STATUSES.map((s) => (
                        <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={hiddenStatuses.has(s)}
                            onCheckedChange={() => toggleHidden(s)}
                          />
                          <span className="capitalize">{s.replace("_", " ")}</span>
                        </label>
                      ))}
                    </div>
                    {hiddenStatuses.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 h-7 w-full text-xs"
                        onClick={() => setHiddenStatuses(new Set())}
                      >
                        Show all
                      </Button>
                    )}
                  </PopoverContent>
                </Popover>
                <Button variant="outline" size="sm" onClick={() => { loadData().then((rows) => loadLookups(rows)); }} disabled={loading}>
                  <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 flex flex-col overflow-hidden p-0 px-6 pb-6">
              {unified.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No conversations found."}
                </p>
              ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b">
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Sent by</TableHead>
                      <TableHead>Message / Subject</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead>Intercom</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Test</TableHead>
                      <TableHead>Resolved</TableHead>
                      <TableHead>Product area</TableHead>
                      <TableHead>Bug</TableHead>
                      <TableHead>Feature req.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unified.map((row) => {
                      if (row.source === "slack") {
                        const m = row.data;
                        return (
                          <TableRow
                            key={`slack-${m.id}`}
                            className={`cursor-pointer hover:bg-muted/50 transition-colors ${m.is_test ? "opacity-50" : ""}`}
                            onClick={() => navigate(`/conversations/${m.id}`)}
                          >
                            <TableCell className="text-xs text-muted-foreground font-mono">
                              {m.id.slice(0, 8)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">Slack</Badge>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                {userNames[m.slack_user_id] || m.slack_user_id || "—"}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[300px]">
                              {m.original_message_text ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleMessage(m.id); }}
                                  className="text-left text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                >
                                  {expandedMessages.has(m.id)
                                    ? m.original_message_text
                                    : m.original_message_text.length > 60
                                      ? m.original_message_text.slice(0, 60) + "…"
                                      : m.original_message_text}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1 text-sm text-foreground">
                                <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                                {channelNames[m.slack_channel_id] || channelNameOverrides[m.slack_channel_id] || (m.slack_channel_id.startsWith("D") ? "Direct message" : m.slack_channel_id)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <a
                                href={buildSlackLink(m.slack_channel_id, m.slack_thread_ts)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Thread <ExternalLink className="h-3 w-3" />
                              </a>
                            </TableCell>
                            <TableCell>
                              {m.intercom_conversation_id ? (
                                <a
                                  href={`https://app.intercom.com/a/apps/esqnv6i1/conversations/${m.intercom_conversation_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {m.intercom_conversation_id} <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusColor(m.status)}>{m.status}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(m.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={m.is_test}
                                onCheckedChange={() => toggleTest(m.id, m.is_test, "slack")}
                                aria-label="Toggle test"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={m.status === "resolved"}
                                onCheckedChange={() => toggleResolved(m.id, m.status, "slack")}
                                aria-label="Toggle resolved"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={m.product_area || ""}
                                onValueChange={(v) => updateProductArea(m.id, v, "slack")}
                              >
                                <SelectTrigger
                                  className="h-8 w-[130px] text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                  {productAreas.map((area) => (
                                    <SelectItem key={area} value={area}>{area}</SelectItem>
                                  ))}
                                  {m.product_area && (
                                    <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={m.is_bug}
                                onCheckedChange={() => toggleBug(m.id, m.is_bug, "slack")}
                                aria-label="Toggle bug"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={m.is_feature_request}
                                onCheckedChange={() => toggleFeatureRequest(m.id, m.is_feature_request, "slack")}
                                aria-label="Toggle feature request"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      } else {
                        const g = row.data;
                        return (
                          <TableRow
                            key={`gmail-${g.id}`}
                            className={`hover:bg-muted/50 transition-colors ${g.is_test ? "opacity-50" : ""}`}
                          >
                            <TableCell className="text-xs text-muted-foreground font-mono">
                              {g.id.slice(0, 8)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                <Mail className="mr-1 h-3 w-3" />Gmail
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                {g.from_name || g.from_email || "—"}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[300px]">
                              {g.subject ? (
                                <button
                                  onClick={() => toggleMessage(g.id)}
                                  className="text-left text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                >
                                  {expandedMessages.has(g.id)
                                    ? `${g.subject}\n${g.snippet || ""}`
                                    : g.subject.length > 60
                                      ? g.subject.slice(0, 60) + "…"
                                      : g.subject}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">Gmail inbox</span>
                            </TableCell>
                            <TableCell>
                              {g.gmail_thread_id ? (
                                <a
                                  href={`https://mail.google.com/mail/u/0/#inbox/${g.gmail_thread_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
                                >
                                  Email <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">—</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={g.status === "resolved" ? "secondary" : "default"}>{g.status || "open"}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {g.received_at ? new Date(g.received_at).toLocaleString() : new Date(g.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={g.is_test}
                                onCheckedChange={() => toggleTest(g.id, g.is_test, "gmail")}
                                aria-label="Toggle test"
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={g.status === "resolved"}
                                onCheckedChange={() => toggleResolved(g.id, g.status, "gmail")}
                                aria-label="Toggle resolved"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={g.product_area || ""}
                                onValueChange={(v) => updateProductArea(g.id, v, "gmail")}
                              >
                                <SelectTrigger className="h-8 w-[130px] text-xs">
                                  <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                  {productAreas.map((area) => (
                                    <SelectItem key={area} value={area}>{area}</SelectItem>
                                  ))}
                                  {g.product_area && (
                                    <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={g.is_bug}
                                onCheckedChange={() => toggleBug(g.id, g.is_bug, "gmail")}
                                aria-label="Toggle bug"
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={g.is_feature_request}
                                onCheckedChange={() => toggleFeatureRequest(g.id, g.is_feature_request, "gmail")}
                                aria-label="Toggle feature request"
                              />
                            </TableCell>
                          </TableRow>
                        );
                      }
                    })}
                  </TableBody>
                </Table>
              </div>
              )}
              {canLoadMore && unified.length > 0 && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" size="sm" onClick={() => loadData(true)} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default Conversations;
