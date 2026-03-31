import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ExternalLink, Hash, User, Mail, X, ArrowLeft } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(paramSource || "all");

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

    return rows;
  }, [mappings, gmailRows, sourceFilter, paramDay, paramHour]);

  const canLoadMore =
    !isHeatmapMode && ((sourceFilter !== "gmail" && hasMore) || (sourceFilter !== "slack" && hasMoreGmail));

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-7xl">
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
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
                <Button variant="outline" size="sm" onClick={() => { loadData().then((rows) => loadLookups(rows)); }} disabled={loading}>
                  <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {unified.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No conversations found."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
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
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={g.is_test}
                                  onCheckedChange={() => toggleTest(g.id, g.is_test, "gmail")}
                                  aria-label="Toggle test"
                                />
                                {g.status !== "resolved" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const prevRows = [...gmailRows];
                                      setGmailRows((prev) => prev.map((r) => r.id === g.id ? { ...r, status: "resolved", resolved_at: new Date().toISOString() } : r));
                                      const { error } = await supabase.from("gmail_conversations").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", g.id);
                                      if (error) {
                                        setGmailRows(prevRows);
                                        toast.error("Failed to resolve conversation");
                                      }
                                    }}
                                  >
                                    Resolve
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }
                    })}
                  </TableBody>
                </Table>
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
