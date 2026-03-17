import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, Hash, User } from "lucide-react";

interface ConversationMapping {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  slack_user_id: string;
  intercom_conversation_id: string;
  status: string;
  created_at: string;
}

type NameMap = Record<string, string>;

const channelNameOverrides: NameMap = {
  C0AJP396C85: "slack-intercom-bot-test",
};

const statusColor = (status: string) => {
  switch (status) {
    case "active": return "default" as const;
    case "resolved": return "secondary" as const;
    case "escalated": return "destructive" as const;
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

  const loadLookups = async (rows: ConversationMapping[]) => {
    // Only fetch users — channels are resolved via a lighter lookup
    const usersRes = await supabase.functions.invoke("list-slack-users");

    if (usersRes.data?.users) {
      const map: NameMap = {};
      for (const u of usersRes.data.users) {
        map[u.id] = u.display_name || u.real_name || u.name;
      }
      setUserNames(map);
    }

    // Resolve channel names for only the IDs we actually need
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
      setChannelNames(map);
    }
  };

  const loadData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("conversation_mappings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as unknown as ConversationMapping[];
    setMappings(rows);
    setLoading(false);
    return rows;
  };

  useEffect(() => {
    loadData().then((rows) => loadLookups(rows));
  }, []);

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-5xl">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Recent Conversations</CardTitle>
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
                  {loading ? "Loading…" : "No conversations yet. @mention the bot in a monitored channel to get started."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent by</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Slack</TableHead>
                      <TableHead>Intercom</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {userNames[m.slack_user_id] || m.slack_user_id || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-sm text-foreground">
                            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                            {channelNames[m.slack_channel_id] || m.slack_channel_id}
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default Conversations;
