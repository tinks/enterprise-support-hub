import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, ExternalLink, Hash, User, ChevronDown, Copy, RefreshCw, Bot } from "lucide-react";
import { toast } from "sonner";
import { channelNameOverrides } from "@/lib/channelOverrides";

interface ConversationMapping {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  slack_user_id: string;
  intercom_conversation_id: string | null;
  intercom_contact_id: string;
  last_intercom_part_id: string | null;
  last_processed_event_ts: string | null;
  prompt_message_ts: string | null;
  reminder_sent_at: string | null;
  resolved_at: string | null;
  status: string;
  is_test: boolean;
  original_message_text: string;
  created_at: string;
  updated_at: string;
}

interface ThreadMessage {
  text: string;
  user_name: string;
  user_avatar: string;
  ts: string;
  is_bot: boolean;
}

const STATUS_OPTIONS = ["active", "resolved", "cancelled", "escalated", "awaiting_context"];

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

const copyToClipboard = (text: string, label: string) => {
  navigator.clipboard.writeText(text);
  toast.success(`${label} copied`);
};

const formatSlackTs = (ts: string) => {
  const date = new Date(parseFloat(ts) * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const cleanSlackText = (text: string) => {
  return text
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .trim();
};

const ConversationDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [conv, setConv] = useState<ConversationMapping | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string>("");
  const [channelName, setChannelName] = useState<string>("");
  const [idsOpen, setIdsOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const fetchThread = async (channelId: string, threadTs: string) => {
    setThreadLoading(true);
    try {
      const res = await supabase.functions.invoke("fetch-thread-messages", {
        body: { channelId, threadTs },
      });
      if (res.data?.messages) {
        setThreadMessages(res.data.messages);
      }
    } catch (err) {
      console.error("Failed to fetch thread:", err);
      toast.error("Failed to load thread messages");
    } finally {
      setThreadLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("id", id)
        .single();
      const row = data as unknown as ConversationMapping | null;
      setConv(row);
      setLoading(false);

      if (row) {
        // Fetch thread messages
        fetchThread(row.slack_channel_id, row.slack_thread_ts);

        // Resolve user name
        const usersRes = await supabase.functions.invoke("list-slack-users");
        if (usersRes.data?.users) {
          const u = usersRes.data.users.find((u: any) => u.id === row.slack_user_id);
          if (u) setUserName(u.display_name || u.real_name || u.name);
        }

        // Resolve channel name
        const channelsRes = await supabase.functions.invoke("list-slack-channels", {
          body: { channelIds: [row.slack_channel_id] },
        });
        if (channelsRes.data?.channels) {
          const c = channelsRes.data.channels.find((c: any) => c.id === row.slack_channel_id);
          if (c) setChannelName(c.name);
        }
        if (!channelName && channelNameOverrides[row.slack_channel_id]) {
          setChannelName(channelNameOverrides[row.slack_channel_id]);
        }
      }
    };
    load();
  }, [id]);

  const updateStatus = async (newStatus: string) => {
    if (!conv) return;
    setUpdating(true);
    const updates: Record<string, any> = { status: newStatus };
    if (newStatus === "resolved") {
      updates.resolved_at = new Date().toISOString();
    } else if (conv.status === "resolved") {
      updates.resolved_at = null;
    }
    await supabase.from("conversation_mappings").update(updates).eq("id", conv.id);
    setConv({ ...conv, ...updates });
    toast.success(`Status updated to ${newStatus}`);
    setUpdating(false);
  };

  const toggleTest = async () => {
    if (!conv) return;
    const newVal = !conv.is_test;
    await supabase.from("conversation_mappings").update({ is_test: newVal }).eq("id", conv.id);
    setConv({ ...conv, is_test: newVal });
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="bg-background p-6">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!conv) {
    return (
      <AppLayout>
        <div className="bg-background p-6">
          <div className="mx-auto max-w-3xl">
            <Button variant="ghost" size="sm" onClick={() => navigate("/conversations")}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <p className="mt-4 text-sm text-muted-foreground">Conversation not found.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const resolvedChannelName =
    channelName ||
    channelNameOverrides[conv.slack_channel_id] ||
    (conv.slack_channel_id.startsWith("D") ? "Direct message" : conv.slack_channel_id);

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* Top bar */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => navigate("/conversations")}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Test</span>
              <Switch checked={conv.is_test} onCheckedChange={toggleTest} />
            </div>
          </div>

          {/* Header card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CardTitle
                  className="font-mono text-base cursor-pointer hover:text-primary transition-colors"
                  onClick={() => copyToClipboard(conv.id, "ID")}
                  title="Click to copy full ID"
                >
                  #{conv.id.slice(0, 8)}
                </CardTitle>
                <Badge variant={statusColor(conv.status)}>{conv.status}</Badge>
                {conv.is_test && <Badge variant="outline">test</Badge>}
              </div>
              <Select value={conv.status} onValueChange={updateStatus} disabled={updating}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
          </Card>

          {/* Details card */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <DetailRow label="Sent by">
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {userName || conv.slack_user_id}
                </span>
              </DetailRow>
              <DetailRow label="Channel">
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  {resolvedChannelName}
                </span>
              </DetailRow>
              <DetailRow label="Created">{new Date(conv.created_at).toLocaleString()}</DetailRow>
              <DetailRow label="Updated">{new Date(conv.updated_at).toLocaleString()}</DetailRow>
              {conv.resolved_at && (
                <DetailRow label="Resolved">{new Date(conv.resolved_at).toLocaleString()}</DetailRow>
              )}
              {conv.reminder_sent_at && (
                <DetailRow label="Reminder sent">{new Date(conv.reminder_sent_at).toLocaleString()}</DetailRow>
              )}
            </CardContent>
          </Card>

          {/* Thread timeline */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Thread</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchThread(conv.slack_channel_id, conv.slack_thread_ts)}
                disabled={threadLoading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${threadLoading ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent>
              {threadLoading && threadMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading thread…</p>
              ) : threadMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages found.</p>
              ) : (
                <div className="space-y-4">
                  {threadMessages.map((msg) => (
                    <div
                      key={msg.ts}
                      className={`flex gap-3 ${msg.is_bot ? "" : ""}`}
                    >
                      <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                        {msg.is_bot ? (
                          <AvatarFallback className="bg-primary/10 text-primary">
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        ) : msg.user_avatar ? (
                          <AvatarImage src={msg.user_avatar} alt={msg.user_name} />
                        ) : (
                          <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                            {msg.user_name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-sm font-medium ${msg.is_bot ? "text-primary" : "text-foreground"}`}>
                            {msg.user_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatSlackTs(msg.ts)}
                          </span>
                        </div>
                        <p className={`mt-0.5 text-sm whitespace-pre-wrap break-words ${
                          msg.is_bot
                            ? "text-muted-foreground bg-muted/50 rounded-md p-2 -ml-2"
                            : "text-foreground"
                        }`}>
                          {cleanSlackText(msg.text)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Links */}
          <Card>
            <CardContent className="pt-6 flex flex-wrap gap-3">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={buildSlackLink(conv.slack_channel_id, conv.slack_thread_ts)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Slack thread <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
              {conv.intercom_conversation_id && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${conv.intercom_conversation_id}?view=List`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Intercom conversation <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Raw IDs (collapsible) */}
          <Collapsible open={idsOpen} onOpenChange={setIdsOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Raw IDs</CardTitle>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${idsOpen ? "rotate-180" : ""}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-2">
                  <IdRow label="Conversation ID" value={conv.id} />
                  <IdRow label="Slack channel ID" value={conv.slack_channel_id} />
                  <IdRow label="Slack thread TS" value={conv.slack_thread_ts} />
                  <IdRow label="Slack user ID" value={conv.slack_user_id} />
                  <IdRow label="Intercom conversation ID" value={conv.intercom_conversation_id || "—"} />
                  <IdRow label="Intercom contact ID" value={conv.intercom_contact_id} />
                  <IdRow label="Last Intercom part ID" value={conv.last_intercom_part_id || "—"} />
                  <IdRow label="Last processed event TS" value={conv.last_processed_event_ts || "—"} />
                  <IdRow label="Prompt message TS" value={conv.prompt_message_ts || "—"} />
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>
    </AppLayout>
  );
};

const DetailRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4">
    <span className="text-sm text-muted-foreground shrink-0">{label}</span>
    <span className="text-sm text-foreground text-right">{children}</span>
  </div>
);

const IdRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-xs text-muted-foreground">{label}</span>
    <button
      onClick={() => copyToClipboard(value, label)}
      className="inline-flex items-center gap-1 font-mono text-xs text-foreground hover:text-primary transition-colors cursor-pointer"
    >
      {value} <Copy className="h-3 w-3" />
    </button>
  </div>
);

export default ConversationDetail;
