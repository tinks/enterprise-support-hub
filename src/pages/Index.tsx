import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Settings, RefreshCw, Save, Link, Search, Hash, X, Plus } from "lucide-react";
import BotIdentityCard from "@/components/BotIdentityCard";
import lovableLogo from "@/assets/lovable-logo.png";

interface SettingsData {
  id: string;
  monitored_channels: string;
  intercom_inbox_id: string;
  intercom_assignee_id: string;
  slack_bot_user_id: string;
  testing_mode: boolean;
  test_intercom_inbox_id: string;
  auto_mark_employee_test: boolean;
}


interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  num_members: number;
}

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

const Index = () => {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [channelsOpen, setChannelsOpen] = useState(false);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");
  const [channelNameMap, setChannelNameMap] = useState<Record<string, string>>({});

  const edgeFunctionBaseUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

  const monitoredIds = (settings?.monitored_channels || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  useEffect(() => {
    loadData();
  }, []);

  // Fetch channel names on mount to resolve existing IDs
  useEffect(() => {
    if (settings && monitoredIds.length > 0 && Object.keys(channelNameMap).length === 0) {
      fetchChannelNames();
    }
  }, [settings]);

  const fetchChannelNames = async () => {
    try {
      const res = await fetch(`${edgeFunctionBaseUrl}/list-slack-channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.channels) {
        const map: Record<string, string> = {};
        for (const ch of data.channels) {
          map[ch.id] = ch.name;
        }
        setChannelNameMap(map);
        setChannels(data.channels);
      }
    } catch {
      // silent — names will just show as IDs
    }
  };

  const loadData = async () => {
    setLoading(true);
    const settingsRes = await supabase.from("settings").select("*").limit(1).single();
    if (settingsRes.data) setSettings(settingsRes.data as unknown as SettingsData);
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
        testing_mode: settings.testing_mode,
        test_intercom_inbox_id: settings.test_intercom_inbox_id,
        auto_mark_employee_test: settings.auto_mark_employee_test,
      })
      .eq("id", settings.id);

    if (error) {
      toast.error("Failed to save settings: " + error.message);
    } else {
      toast.success("Settings saved!");
    }
    setSaving(false);
  };

  const browseChannels = async () => {
    setChannelsOpen(true);
    setChannelSearch("");
    if (channels.length > 0) return; // already loaded
    setChannelsLoading(true);
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
        const chList = data.channels || [];
        setChannels(chList);
        const map: Record<string, string> = {};
        for (const ch of chList) {
          map[ch.id] = ch.name;
        }
        setChannelNameMap((prev) => ({ ...prev, ...map }));
      }
    } catch (err) {
      toast.error("Request failed: " + (err instanceof Error ? err.message : "Unknown error"));
      setChannels([]);
    }
    setChannelsLoading(false);
  };

  const toggleChannel = (channelId: string) => {
    setSettings((s) => {
      if (!s) return s;
      const existing = s.monitored_channels
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const updated = existing.includes(channelId)
        ? existing.filter((id) => id !== channelId)
        : [...existing, channelId];
      return { ...s, monitored_channels: updated.join(", ") };
    });
  };

  const removeChannel = (channelId: string) => {
    setSettings((s) => {
      if (!s) return s;
      const existing = s.monitored_channels
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      return { ...s, monitored_channels: existing.filter((id) => id !== channelId).join(", ") };
    });
  };


  const filteredChannels = channels.filter(
    (ch) => ch.name.toLowerCase().includes(channelSearch.toLowerCase()) || ch.id.includes(channelSearch)
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AppLayout>
    <div className="bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <img src={lovableLogo} alt="Ask Lovable" className="h-10 w-10 rounded-lg" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Ask Lovable — Slack ↔ Intercom bridge
            </h1>
            <p className="text-sm text-muted-foreground">
              Event-driven support bridge — @mention the bot to create tickets
            </p>
          </div>
        </div>

        {/* Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuration</CardTitle>
            <CardDescription>
              Set the channel IDs and Intercom settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Monitored Slack Channels</Label>
              <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 min-h-[44px]">
                {monitoredIds.length === 0 && (
                  <span className="text-sm text-muted-foreground">No channels monitored yet</span>
                )}
                {monitoredIds.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1 pr-1">
                    <Hash className="h-3 w-3" />
                    {channelNameMap[id] || id}
                    <button
                      onClick={() => removeChannel(id)}
                      className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Button variant="outline" size="sm" onClick={browseChannels} className="h-7 gap-1">
                  <Plus className="h-3 w-3" />
                  Browse
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                New channels are auto-enabled on first @mention after the bot is invited.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="expected-bot-id">Expected Bot User ID</Label>
                <Input
                  id="expected-bot-id"
                  placeholder="U0ABC123DEF"
                  value={settings?.slack_bot_user_id || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, slack_bot_user_id: e.target.value } : s
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  The Bot User ID from your Slack app. Use "Check Identity" below to find it. When set, edge functions will block posting if the token doesn't match.
                </p>
              </div>
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="test-inbox">Test Intercom Inbox ID</Label>
                <Input
                  id="test-inbox"
                  placeholder="10219738"
                  value={settings?.test_intercom_inbox_id || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, test_intercom_inbox_id: e.target.value } : s
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Conversations from @lovable.dev employees are auto-routed to this inbox
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="auto-mark-employee" className="text-sm font-medium">Auto-mark Lovable employee conversations as test</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, conversations from @lovable.dev users are automatically marked as test and routed to the test inbox
                </p>
              </div>
              <Switch
                id="auto-mark-employee"
                checked={settings?.auto_mark_employee_test ?? true}
                onCheckedChange={(checked) =>
                  setSettings((s) => s ? { ...s, auto_mark_employee_test: checked } : s)
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="testing-mode" className="text-sm font-medium">Testing mode</Label>
                <p className="text-xs text-muted-foreground">
                  Show Intercom conversation IDs in Slack messages for debugging
                </p>
              </div>
              <Switch
                id="testing-mode"
                checked={settings?.testing_mode || false}
                onCheckedChange={(checked) =>
                  setSettings((s) => s ? { ...s, testing_mode: checked } : s)
                }
              />
            </div>

            <Button onClick={saveSettings} disabled={saving} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        {/* Bot Identity Card */}
        <BotIdentityCard />

        {/* Webhook URLs Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Link className="h-5 w-5" />
              Webhook URLs
            </CardTitle>
            <CardDescription>
              Use these URLs when configuring your Slack app and Intercom webhooks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Slack Event Subscriptions URL
              </Label>
              <code className="block rounded bg-muted p-2 text-xs break-all">
                {edgeFunctionBaseUrl}/slack-events
              </code>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Slack Interactivity URL
              </Label>
              <code className="block rounded bg-muted p-2 text-xs break-all">
                {edgeFunctionBaseUrl}/slack-interactions
              </code>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Intercom Webhook URL
              </Label>
              <code className="block rounded bg-muted p-2 text-xs break-all">
                {edgeFunctionBaseUrl}/intercom-webhook
              </code>
            </div>
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
              filteredChannels.map((ch) => {
                const isSelected = monitoredIds.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    onClick={() => toggleChannel(ch.id)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors ${
                      isSelected ? "bg-accent/50" : ""
                    }`}
                  >
                    <Checkbox checked={isSelected} tabIndex={-1} className="pointer-events-none" />
                    <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium flex-1 text-left">{ch.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{ch.num_members} members</span>
                  </button>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setChannelsOpen(false)} className="w-full">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AppLayout>
  );
};

export default Index;
