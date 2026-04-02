import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, ExternalLink, Hash, User, ChevronDown, Copy, RefreshCw, Bot, Ticket, Mail } from "lucide-react";
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
  is_bug: boolean;
  is_feature_request: boolean;
  product_area: string | null;
  original_message_text: string;
  created_at: string;
  updated_at: string;
  owner: string | null;
  classification: string | null;
}

interface GmailConv {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  created_at: string;
  status: string;
  is_test: boolean;
  is_bug: boolean;
  is_feature_request: boolean;
  product_area: string | null;
  intercom_conversation_id: string | null;
  resolved_at: string | null;
  to_emails: string | null;
  cc_emails: string | null;
  owner: string | null;
}

interface ManualConv {
  id: string;
  source: string;
  contact_name: string;
  subject: string;
  link: string | null;
  status: string;
  is_test: boolean;
  is_bug: boolean;
  is_feature_request: boolean;
  product_area: string | null;
  intercom_conversation_id: string | null;
  created_at: string;
  updated_at: string;
  owner: string | null;
}

const OWNER_OPTIONS = ["Joel", "Kristina"] as const;

interface ManualMessage {
  id: string;
  role: string;
  sender_name: string;
  message_text: string;
  created_at: string;
}

interface ThreadMessage {
  text: string;
  user_name: string;
  user_avatar: string;
  ts: string;
  is_bot: boolean;
}

type SourceType = "slack" | "gmail" | "manual";

const STATUS_OPTIONS = ["active", "resolved", "cancelled", "escalated", "awaiting_context", "awaiting_support"];

const statusColor = (status: string) => {
  switch (status) {
    case "active": return "default" as const;
    case "resolved": return "secondary" as const;
    case "escalated": return "destructive" as const;
    case "cancelled": return "outline" as const;
    case "awaiting_context": return "outline" as const;
    case "awaiting_support": return "outline" as const;
    default: return "outline" as const;
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "awaiting_context": return "Awaiting customer";
    case "awaiting_support": return "Awaiting support";
    default: return status.replace(/_/g, " ");
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
  const [searchParams] = useSearchParams();
  const source: SourceType = (searchParams.get("source") as SourceType) || "slack";

  const [conv, setConv] = useState<ConversationMapping | null>(null);
  const [gmailConv, setGmailConv] = useState<GmailConv | null>(null);
  const [manualConv, setManualConv] = useState<ManualConv | null>(null);
  const [manualMessages, setManualMessages] = useState<ManualMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string>("");
  const [channelName, setChannelName] = useState<string>("");
  const [idsOpen, setIdsOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [productAreas, setProductAreas] = useState<string[]>([]);
  const [creatingIntercom, setCreatingIntercom] = useState(false);

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
    const loadAreas = async () => {
      const { data } = await supabase.from("settings").select("product_areas").limit(1).single();
      if (data?.product_areas) {
        setProductAreas(data.product_areas.split(",").map((a: string) => a.trim()).filter(Boolean));
      }
    };
    loadAreas();
  }, []);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);

      if (source === "gmail") {
        const { data } = await supabase.from("gmail_conversations").select("*").eq("id", id).single();
        setGmailConv(data as unknown as GmailConv | null);
        setLoading(false);
        return;
      }

      if (source === "manual") {
        const [convRes, msgsRes] = await Promise.all([
          supabase.from("manual_conversations").select("*").eq("id", id).single(),
          supabase.from("manual_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true }),
        ]);
        setManualConv(convRes.data as unknown as ManualConv | null);
        setManualMessages((msgsRes.data ?? []) as unknown as ManualMessage[]);
        setLoading(false);
        return;
      }

      // Slack
      const { data } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("id", id)
        .single();
      const row = data as unknown as ConversationMapping | null;
      setConv(row);
      setLoading(false);

      if (row) {
        fetchThread(row.slack_channel_id, row.slack_thread_ts);

        const usersRes = await supabase.functions.invoke("list-slack-users");
        if (usersRes.data?.users) {
          const u = usersRes.data.users.find((u: any) => u.id === row.slack_user_id);
          if (u) setUserName(u.display_name || u.real_name || u.name);
        }

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
  }, [id, source]);

  // Shared helpers for updating fields
  const getTable = () => source === "slack" ? "conversation_mappings" : source === "gmail" ? "gmail_conversations" : "manual_conversations";
  const getCurrentData = () => source === "slack" ? conv : source === "gmail" ? gmailConv : manualConv;
  const getCurrentId = () => getCurrentData()?.id;

  const updateStatus = async (newStatus: string) => {
    const current = getCurrentData();
    if (!current) return;
    setUpdating(true);
    const updates: Record<string, any> = { status: newStatus };
    if (newStatus === "resolved") updates.resolved_at = new Date().toISOString();
    else if (current.status === "resolved") updates.resolved_at = null;
    await supabase.from(getTable()).update(updates as any).eq("id", current.id);
    if (source === "slack") setConv({ ...conv!, ...updates });
    else if (source === "gmail") setGmailConv({ ...gmailConv!, ...updates });
    else setManualConv({ ...manualConv!, ...updates });
    toast.success(`Status updated to ${newStatus}`);
    setUpdating(false);
  };

  const toggleField = async (field: "is_test" | "is_bug" | "is_feature_request") => {
    const current = getCurrentData();
    if (!current) return;
    const newVal = !current[field];
    await supabase.from(getTable()).update({ [field]: newVal } as any).eq("id", current.id);
    if (source === "slack") setConv({ ...conv!, [field]: newVal });
    else if (source === "gmail") setGmailConv({ ...gmailConv!, [field]: newVal });
    else setManualConv({ ...manualConv!, [field]: newVal });
  };

  const updateProductArea = async (value: string) => {
    const current = getCurrentData();
    if (!current) return;
    const newVal = value === "none" ? null : value;
    await supabase.from(getTable()).update({ product_area: newVal } as any).eq("id", current.id);
    if (source === "slack") setConv({ ...conv!, product_area: newVal });
    else if (source === "gmail") setGmailConv({ ...gmailConv!, product_area: newVal });
    else setManualConv({ ...manualConv!, product_area: newVal });
    toast.success(`Product area updated`);
  };

  const updateOwner = async (value: string) => {
    const current = getCurrentData();
    if (!current) return;
    const newVal = value === "none" ? null : value;
    await supabase.from(getTable()).update({ owner: newVal } as any).eq("id", current.id);
    if (source === "slack") setConv({ ...conv!, owner: newVal });
    else if (source === "gmail") setGmailConv({ ...gmailConv!, owner: newVal });
    else setManualConv({ ...manualConv!, owner: newVal });
    toast.success(`Owner updated`);
  };

  const createIntercom = async () => {
    const current = getCurrentData();
    if (!current) return;
    setCreatingIntercom(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-intercom-from-import", {
        body: { mappingId: current.id, source },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to create Intercom ticket");
        return;
      }
      toast.success("Intercom ticket created");
      // Reload
      if (source === "slack") {
        const { data: updated } = await supabase.from("conversation_mappings").select("*").eq("id", current.id).single();
        if (updated) setConv(updated as unknown as ConversationMapping);
      } else if (source === "gmail") {
        const { data: updated } = await supabase.from("gmail_conversations").select("*").eq("id", current.id).single();
        if (updated) setGmailConv(updated as unknown as GmailConv);
      } else {
        const { data: updated } = await supabase.from("manual_conversations").select("*").eq("id", current.id).single();
        if (updated) setManualConv(updated as unknown as ManualConv);
      }
    } catch {
      toast.error("Failed to create Intercom ticket");
    } finally {
      setCreatingIntercom(false);
    }
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

  const current = getCurrentData();

  if (!current) {
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

  const intercomId = current.intercom_conversation_id;

  // Source-specific rendering
  const renderSlackDetail = () => {
    if (!conv) return null;
    const resolvedChannelName =
      channelName ||
      channelNameOverrides[conv.slack_channel_id] ||
      (conv.slack_channel_id.startsWith("D") ? "Direct message" : conv.slack_channel_id);

    return (
      <>
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

        {/* Thread */}
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
                  <div key={msg.ts} className="flex gap-3">
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
            {intercomId ? (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${intercomId}?view=List`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Intercom conversation <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={creatingIntercom}
                onClick={createIntercom}
              >
                {creatingIntercom ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Ticket className="h-3.5 w-3.5 mr-1" />
                )}
                Create Intercom ticket
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Raw IDs */}
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
      </>
    );
  };

  const renderGmailDetail = () => {
    if (!gmailConv) return null;
    return (
      <>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <DetailRow label="From">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {gmailConv.from_name || gmailConv.from_email || "—"}
                {gmailConv.from_name && gmailConv.from_email && (
                  <span className="text-muted-foreground">({gmailConv.from_email})</span>
                )}
              </span>
            </DetailRow>
            <DetailRow label="Subject">{gmailConv.subject || "—"}</DetailRow>
            {gmailConv.to_emails && <DetailRow label="To">{gmailConv.to_emails}</DetailRow>}
            {gmailConv.cc_emails && <DetailRow label="Cc">{gmailConv.cc_emails}</DetailRow>}
            <DetailRow label="Received">{gmailConv.received_at ? new Date(gmailConv.received_at).toLocaleString() : "—"}</DetailRow>
            <DetailRow label="Created">{new Date(gmailConv.created_at).toLocaleString()}</DetailRow>
            {gmailConv.resolved_at && (
              <DetailRow label="Resolved">{new Date(gmailConv.resolved_at).toLocaleString()}</DetailRow>
            )}
          </CardContent>
        </Card>

        {gmailConv.snippet && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Snippet</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground whitespace-pre-wrap">{gmailConv.snippet}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-3">
            {gmailConv.gmail_thread_id && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${gmailConv.gmail_thread_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View in Gmail <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
            {intercomId ? (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${intercomId}?view=List`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Intercom conversation <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            ) : (
              <Button variant="default" size="sm" disabled={creatingIntercom} onClick={createIntercom}>
                {creatingIntercom ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Ticket className="h-3.5 w-3.5 mr-1" />}
                Create Intercom ticket
              </Button>
            )}
          </CardContent>
        </Card>
      </>
    );
  };

  const renderManualDetail = () => {
    if (!manualConv) return null;
    return (
      <>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <DetailRow label="Contact">{manualConv.contact_name || "—"}</DetailRow>
            <DetailRow label="Subject">{manualConv.subject || "—"}</DetailRow>
            <DetailRow label="Source"><span className="capitalize">{manualConv.source}</span></DetailRow>
            <DetailRow label="Created">{new Date(manualConv.created_at).toLocaleString()}</DetailRow>
            <DetailRow label="Updated">{new Date(manualConv.updated_at).toLocaleString()}</DetailRow>
          </CardContent>
        </Card>

        {/* Messages */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Messages</CardTitle>
          </CardHeader>
          <CardContent>
            {manualMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages.</p>
            ) : (
              <div className="space-y-4">
                {manualMessages.map((msg) => (
                  <div key={msg.id} className="flex gap-3">
                    <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                      <AvatarFallback className={msg.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}>
                        {msg.sender_name ? msg.sender_name.slice(0, 2).toUpperCase() : (msg.role === "admin" ? "A" : "U")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className={`text-sm font-medium ${msg.role === "admin" ? "text-primary" : "text-foreground"}`}>
                          {msg.sender_name || msg.role}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(msg.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className={`mt-0.5 text-sm whitespace-pre-wrap break-words ${
                        msg.role === "admin" ? "text-muted-foreground bg-muted/50 rounded-md p-2 -ml-2" : "text-foreground"
                      }`}>
                        {msg.message_text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-3">
            {manualConv.link && (
              <Button variant="outline" size="sm" asChild>
                <a href={manualConv.link} target="_blank" rel="noopener noreferrer">
                  External link <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
            {intercomId ? (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${intercomId}?view=List`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Intercom conversation <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
            ) : (
              <Button variant="default" size="sm" disabled={creatingIntercom} onClick={createIntercom}>
                {creatingIntercom ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Ticket className="h-3.5 w-3.5 mr-1" />}
                Create Intercom ticket
              </Button>
            )}
          </CardContent>
        </Card>
      </>
    );
  };

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
              <Switch checked={current.is_test} onCheckedChange={() => toggleField("is_test")} />
            </div>
          </div>

          {/* Header card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CardTitle
                  className="font-mono text-base cursor-pointer hover:text-primary transition-colors"
                  onClick={() => copyToClipboard(current.id, "ID")}
                  title="Click to copy full ID"
                >
                  #{current.id.slice(0, 8)}
                </CardTitle>
                <Badge variant={statusColor(current.status)}>{statusLabel(current.status)}</Badge>
                {current.is_test && <Badge variant="outline">test</Badge>}
                <Badge variant="secondary" className="text-xs capitalize">{source}</Badge>
              </div>
              <Select value={current.status} onValueChange={updateStatus} disabled={updating}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
          </Card>

          {/* Classification */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Bug</Label>
                <Switch checked={current.is_bug} onCheckedChange={() => toggleField("is_bug")} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Feature request</Label>
                <Switch checked={current.is_feature_request} onCheckedChange={() => toggleField("is_feature_request")} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Product area</Label>
                <Select value={current.product_area || "none"} onValueChange={updateProductArea}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {productAreas.map((area) => (
                      <SelectItem key={area} value={area}>{area}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Owner</Label>
                <Select value={current.owner || "none"} onValueChange={updateOwner}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {OWNER_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Source-specific content */}
          {source === "slack" && renderSlackDetail()}
          {source === "gmail" && renderGmailDetail()}
          {source === "manual" && renderManualDetail()}
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
