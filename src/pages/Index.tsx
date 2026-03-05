import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings, RefreshCw, Save, Link, Play, Search, Users, Hash } from "lucide-react";

interface SettingsData {
  id: string;
  monitored_channels: string;
  intercom_inbox_id: string;
  intercom_assignee_id: string;
  slack_bot_user_id: string;
  last_polled_ts: string;
}

interface ConversationMapping {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  intercom_conversation_id: string;
  status: string;
  created_at: string;
}

interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  num_members: number;
}

interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  display_name: string;
}

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

const Index = () => {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [mappings, setMappings] = useState<ConversationMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);

  const [channelsOpen, setChannelsOpen] = useState(false);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");

  const [usersOpen, setUsersOpen] = useState(false);
  const [users, setUsers] = useState<SlackUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const edgeFunctionBaseUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [settingsRes, mappingsRes] = await Promise.all([
      supabase.from("settings").select("*").limit(1).single(),
      supabase
        .from("conversation_mappings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (settingsRes.data) setSettings(settingsRes.data as unknown as SettingsData);
    if (mappingsRes.data) setMappings(mappingsRes.data as unknown as ConversationMapping[]);
    setLoading(false);
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("settings")
      .update({
        monitored_channels: settings.monitored_channels,
        intercom_inbox_id: settings.intercom_inbox_id,
        intercom_assignee_id: settings.intercom_assignee_id,
        slack_bot_user_id: settings.slack_bot_user_id,
      })
      .eq("id", settings.id);

    if (error) {
      toast.error("Failed to save settings: " + error.message);
    } else {
      toast.success("Settings saved!");
    }
    setSaving(false);
  };

  const pollNow = async () => {
    setPolling(true);
    try {
      const res = await fetch(`${edgeFunctionBaseUrl}/poll-slack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Poll failed: " + (data.error || res.statusText));
      } else {
        toast.success(`Poll complete — ${data.processed || 0} new conversation(s) created`);
        loadData();
      }
    } catch (err) {
      toast.error("Poll request failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
    setPolling(false);
  };

  const browseChannels = async () => {
    setChannelsOpen(true);
    setChannelsLoading(true);
    setChannelSearch("");
    try {
      const res = await fetch(`${edgeFunctionBaseUrl}/list-slack-channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.error) {
        toast.error("Failed to load channels: " + data.error);
        setChannels([]);
      } else {
        setChannels(data.channels || []);
      }
    } catch (err) {
      toast.error("Request failed: " + (err instanceof Error ? err.message : "Unknown error"));
      setChannels([]);
    }
    setChannelsLoading(false);
  };

  const selectChannel = (channelId: string) => {
    setSettings((s) => {
      if (!s) return s;
      const existing = s.monitored_channels
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (existing.includes(channelId)) return s;
      return { ...s, monitored_channels: [...existing, channelId].join(", ") };
    });
    toast.success(`Added channel ${channelId}`);
    setChannelsOpen(false);
  };

  const browseUsers = async () => {
    setUsersOpen(true);
    setUsersLoading(true);
    setUserSearch("");
    try {
      const res = await fetch(`${edgeFunctionBaseUrl}/list-slack-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.error) {
        toast.error("Failed to load users: " + data.error);
        setUsers([]);
      } else {
        setUsers(data.users || []);
      }
    } catch (err) {
      toast.error("Request failed: " + (err instanceof Error ? err.message : "Unknown error"));
      setUsers([]);
    }
    setUsersLoading(false);
  };

  const selectUser = (userId: string) => {
    setSettings((s) => (s ? { ...s, slack_bot_user_id: userId } : s));
    toast.success(`Set user ID to ${userId}`);
    setUsersOpen(false);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "active": return "default" as const;
      case "resolved": return "secondary" as const;
      case "escalated": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  const filteredChannels = channels.filter(
    (ch) => ch.name.toLowerCase().includes(channelSearch.toLowerCase()) || ch.id.includes(channelSearch)
  );

  const filteredUsers = users.filter(
    (u) =>
      u.real_name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.id.includes(userSearch)
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Slack ↔ Intercom Bridge
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure your support bridge settings
            </p>
          </div>
        </div>

        {/* Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuration</CardTitle>
            <CardDescription>
              Set the channel IDs, Intercom inbox, and user to monitor for mentions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channels">Monitored Slack Channel IDs</Label>
              <div className="flex gap-2">
                <Input
                  id="channels"
                  placeholder="C1234567890, C0987654321"
                  value={settings?.monitored_channels || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, monitored_channels: e.target.value } : s
                    )
                  }
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={browseChannels} className="shrink-0">
                  <Hash className="mr-1 h-4 w-4" />
                  Browse
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Comma-separated Slack channel IDs to poll for mentions
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inbox">Intercom Inbox ID</Label>
                <Input
                  id="inbox"
                  placeholder="12345"
                  value={settings?.intercom_inbox_id || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, intercom_inbox_id: e.target.value } : s
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assignee">Intercom Assignee ID (AI Bot)</Label>
                <Input
                  id="assignee"
                  placeholder="67890"
                  value={settings?.intercom_assignee_id || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, intercom_assignee_id: e.target.value } : s
                    )
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="botuser">Slack User ID to Monitor</Label>
              <div className="flex gap-2">
                <Input
                  id="botuser"
                  placeholder="U1234567890"
                  value={settings?.slack_bot_user_id || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, slack_bot_user_id: e.target.value } : s
                    )
                  }
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={browseUsers} className="shrink-0">
                  <Users className="mr-1 h-4 w-4" />
                  Lookup
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Messages mentioning this user (@mention) will create Intercom tickets
              </p>
            </div>

            <Button onClick={saveSettings} disabled={saving} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        {/* Poll Control Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="h-5 w-5" />
              Poll Slack
            </CardTitle>
            <CardDescription>
              Manually trigger polling to check monitored channels for new mentions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={pollNow} disabled={polling} className="w-full" variant="secondary">
              {polling ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Polling...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Poll Now
                </>
              )}
            </Button>
            {settings?.last_polled_ts && settings.last_polled_ts !== "" && (
              <p className="text-xs text-muted-foreground text-center">
                Last polled: {new Date(parseFloat(settings.last_polled_ts) * 1000).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Webhook URLs Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Link className="h-5 w-5" />
              Webhook URLs
            </CardTitle>
            <CardDescription>
              Use these URLs when configuring your Intercom webhooks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Intercom Webhook URL
              </Label>
              <code className="block rounded bg-muted p-2 text-xs break-all">
                {edgeFunctionBaseUrl}/intercom-webhook
              </code>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Slack Interactions URL (requires custom Slack app)
              </Label>
              <code className="block rounded bg-muted p-2 text-xs break-all">
                {edgeFunctionBaseUrl}/slack-interactions
              </code>
            </div>
          </CardContent>
        </Card>

        {/* Conversation Mappings */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Recent Conversations</CardTitle>
              <CardDescription>
                Slack thread ↔ Intercom conversation mappings
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {mappings.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No conversations yet. Tag the monitored user in a channel and click Poll Now.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Thread</TableHead>
                    <TableHead>Intercom ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">
                        {m.slack_channel_id}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {m.slack_thread_ts}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {m.intercom_conversation_id}
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

      {/* Channel Browser Dialog */}
      <Dialog open={channelsOpen} onOpenChange={setChannelsOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Browse Slack Channels</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search channels..."
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-1 max-h-[50vh]">
            {channelsLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredChannels.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No channels found</p>
            ) : (
              filteredChannels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => selectChannel(ch.id)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{ch.name}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{ch.id}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* User Lookup Dialog */}
      <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Lookup Slack Users</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-1 max-h-[50vh]">
            {usersLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No users found</p>
            ) : (
              filteredUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => selectUser(u.id)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <span className="flex flex-col items-start">
                    <span className="font-medium">{u.real_name}</span>
                    <span className="text-xs text-muted-foreground">@{u.name}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{u.id}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
