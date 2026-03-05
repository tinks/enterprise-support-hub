import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Settings, RefreshCw, Save, Link } from "lucide-react";

interface SettingsData {
  id: string;
  monitored_channels: string;
  intercom_inbox_id: string;
  intercom_assignee_id: string;
  slack_bot_user_id: string;
}

interface ConversationMapping {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  intercom_conversation_id: string;
  status: string;
  created_at: string;
}

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

const Index = () => {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [mappings, setMappings] = useState<ConversationMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const statusColor = (status: string) => {
    switch (status) {
      case "active": return "default" as const;
      case "resolved": return "secondary" as const;
      case "escalated": return "destructive" as const;
      default: return "outline" as const;
    }
  };

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
              Set the channel IDs, Intercom inbox, and bot user to monitor
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channels">Monitored Slack Channel IDs</Label>
              <Input
                id="channels"
                placeholder="C1234567890, C0987654321"
                value={settings?.monitored_channels || ""}
                onChange={(e) =>
                  setSettings((s) =>
                    s ? { ...s, monitored_channels: e.target.value } : s
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated Slack channel IDs to watch for mentions
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
              <Label htmlFor="botuser">Slack Bot User ID</Label>
              <Input
                id="botuser"
                placeholder="U1234567890"
                value={settings?.slack_bot_user_id || ""}
                onChange={(e) =>
                  setSettings((s) =>
                    s ? { ...s, slack_bot_user_id: e.target.value } : s
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                The Slack user ID that triggers ticket creation when mentioned
              </p>
            </div>

            <Button onClick={saveSettings} disabled={saving} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Settings"}
            </Button>
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
              Use these URLs when configuring your Slack app and Intercom webhooks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Slack Events URL
              </Label>
              <code className="block rounded bg-muted p-2 text-xs break-all">
                {edgeFunctionBaseUrl}/slack-events
              </code>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">
                Slack Interactions URL
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
                No conversations yet. Mention the bot in a monitored channel to get
                started.
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
    </div>
  );
};

export default Index;
