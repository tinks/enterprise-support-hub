import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, Hash, User, FlaskConical } from "lucide-react";
import { Switch } from "@/components/ui/switch";

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

type NameMap = Record<string, string>;

import { channelNameOverrides } from "@/lib/channelOverrides";

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

const Conversations = () => {
  const [mappings, setMappings] = useState<ConversationMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [userNames, setUserNames] = useState<NameMap>({});
  const [channelNames, setChannelNames] = useState<NameMap>({});
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const toggleMessage = (id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTest = async (id: string, currentValue: boolean) => {
    const newValue = !currentValue;
    setMappings((prev) => prev.map((m) => m.id === id ? { ...m, is_test: newValue } : m));
    await supabase.from("conversation_mappings").update({ is_test: newValue }).eq("id", id);
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

  const loadData = async (append = false) => {
    const currentOffset = append ? offset : 0;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setOffset(0);
    }
    const { data } = await supabase
      .from("conversation_mappings")
      .select("*")
      .order("created_at", { ascending: false })
      .range(currentOffset, currentOffset + 49);
    const rows = (data ?? []) as unknown as ConversationMapping[];
    setHasMore(rows.length === 50);
    if (append) {
      setMappings((prev) => [...prev, ...rows]);
      setOffset(currentOffset + 50);
      setLoadingMore(false);
    } else {
      setMappings(rows);
      setOffset(50);
      setLoading(false);
    }
    return rows;
  };

  useEffect(() => {
    loadData().then((rows) => loadLookups(rows));
  }, []);

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-7xl">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Recent conversations</CardTitle>
                <CardDescription>
                  Slack thread ↔ Intercom conversation mappings
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => { loadData().then((rows) => loadLookups(rows)); }} disabled={loading}>
                <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {mappings.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No conversations found."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Sent by</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Slack</TableHead>
                      <TableHead>Intercom</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Test</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((m) => (
                      <TableRow key={m.id} className={m.is_test ? "opacity-50" : ""}>
                        <TableCell
                          className="font-mono text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                          title="Click to copy full ID"
                          onClick={() => {
                            navigator.clipboard.writeText(m.id);
                          }}
                        >
                          {m.id.slice(0, 8)}
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
                              onClick={() => toggleMessage(m.id)}
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
                            {channelNames[m.slack_channel_id] || channelNameOverrides[m.slack_channel_id] || m.slack_channel_id}
                          </span>
                        </TableCell>
                        <TableCell>
                          <a
                            href={buildSlackLink(m.slack_channel_id, m.slack_thread_ts)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
                          >
                            Thread <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.intercom_conversation_id ? (
                            <a
                              href={`https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${m.intercom_conversation_id}?view=List`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                              {m.intercom_conversation_id}
                            </a>
                          ) : "—"}
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
                            onCheckedChange={() => toggleTest(m.id, m.is_test)}
                            aria-label="Toggle test"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {hasMore && mappings.length > 0 && (
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
