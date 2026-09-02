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
import { Settings, RefreshCw, Save, Link, Search, Hash, X, Plus, Mail, CheckCircle2, AlertCircle, Ticket } from "lucide-react";
import BotIdentityCard from "@/components/BotIdentityCard";
import ProductAreasCard from "@/components/ProductAreasCard";
import AdminMappingCard from "@/components/AdminMappingCard";
import SlackChannelAccountMapCard from "@/components/SlackChannelAccountMapCard";
import IntegrationHealthCard from "@/components/IntegrationHealthCard";
import ScheduledJobsCard from "@/components/ScheduledJobsCard";
import IntercomFieldOptionsCard from "@/components/IntercomFieldOptionsCard";
import InboxV3SyncCard from "@/components/InboxV3SyncCard";
import TicketChannelTestCard from "@/components/TicketChannelTestCard";
// CustomerAccountsCard retired from Settings (7 Aug 2026) — customer accounts are now
// edited only in Admin → Customers → Registry. Component intentionally kept on disk as rollback.
import { Building2, ArrowRight } from "lucide-react";
import lovableLogo from "@/assets/lovable-logo.png";

interface SettingsData {
  id: string;
  monitored_channels: string;
  intercom_inbox_id: string;
  sse_intercom_inbox_id: string;
  intercom_assignee_id: string;
  slack_bot_user_id: string;
  testing_mode: boolean;
  test_intercom_inbox_id: string;
  auto_mark_employee_test: boolean;
  product_areas: string;
  new_ticket_alert_mentions: string;
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

  const [gmailConnected, setGmailConnected] = useState<string | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [intercomPolling, setIntercomPolling] = useState(false);
  const [lastPolledIntercom, setLastPolledIntercom] = useState<string | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditReport, setAuditReport] = useState<{ total: number; mismatches: Array<{ table: string; id: string; intercomId: string; currentTeamId: string; subject: string; contact: string }> } | null>(null);

  const edgeFunctionBaseUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

  const monitoredIds = (settings?.monitored_channels || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const checkGmailConnection = async () => {
    // Security-definer RPC: returns only { connected, email_address } — never
    // the token row itself.
    const { data } = await supabase.rpc("gmail_connection_status");
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.connected) {
      setGmailConnected(row.email_address || "Connected");
    } else {
      setGmailConnected(null);
    }
  };

  const connectGmail = async () => {
    setGmailLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-auth-url", {
        body: {},
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank", "width=600,height=700");
        toast.info("Complete the Google sign-in in the popup, then click 'Refresh status'");
      } else {
        toast.error("Failed to get auth URL: " + (data?.error || "Unknown error"));
      }
    } catch (err) {
      toast.error("Request failed: " + (err instanceof Error ? err.message : "Unknown"));
    }
    setGmailLoading(false);
  };

  const cleanupBadIntercomImports = async () => {
    if (!confirm("This will check every Intercom-sourced conversation against Intercom's API and delete any that aren't currently in the enterprise inbox. Runs in batches; may take several minutes. Continue?")) return;
    setCleanupRunning(true);
    let totalDeleted = 0;
    let totalKept = 0;
    let totalNotFound = 0;
    let totalApiErrors = 0;
    let offset = 0;
    let batchNum = 0;
    try {
      while (true) {
        batchNum++;
        const { data: invokeData, error: invokeError } = await supabase.functions.invoke("cleanup-bad-intercom-imports", { body: { dryRun: false, batchSize: 80, offset } });
        const data: any = invokeError ? { error: invokeError.message } : invokeData;
        if (data.error) {
          toast.error("Cleanup failed: " + data.error);
          break;
        }
        totalDeleted += data.deleted || 0;
        totalKept += data.kept || 0;
        totalNotFound += data.notFound || 0;
        totalApiErrors += data.apiErrors || 0;
        toast.info(`Batch ${batchNum}: ${data.deleted} deleted, ${data.kept} kept (${data.totalRemaining} remaining)`);
        if (data.done || data.batchCount === 0) break;
        offset = data.nextOffset || 0;
        if (batchNum > 50) { toast.error("Stopped after 50 batches as a safety guard"); break; }
      }
      toast.success(`Cleanup complete: ${totalDeleted} deleted, ${totalKept} kept, ${totalNotFound} not found, ${totalApiErrors} API errors`);
    } catch (err) {
      toast.error("Cleanup request failed: " + (err instanceof Error ? err.message : "Unknown"));
    }
    setCleanupRunning(false);
  };

  const backfillEnterpriseInbox = async () => {
    if (!confirm("This paginates through ALL Intercom tickets ever assigned to the enterprise inbox and imports any not already tracked. May take several minutes. Continue?")) return;
    setBackfillRunning(true);
    let totalImported = 0;
    let totalSkipped = 0;
    let totalProcessed = 0;
    let startingAfter: string | undefined = undefined;
    let batchNum = 0;
    try {
      while (true) {
        batchNum++;
        const { data: invokeData, error: invokeError } = await supabase.functions.invoke("backfill-enterprise-inbox", { body: { startingAfter, maxBatch: 25 } });
        const data: any = invokeError ? { error: invokeError.message } : invokeData;
        if (data.error) {
          toast.error("Backfill failed: " + data.error);
          break;
        }
        totalImported += data.imported || 0;
        totalSkipped += data.skipped || 0;
        totalProcessed += data.processed || 0;
        toast.info(`Batch ${batchNum}: +${data.imported} imported, ${data.skipped} skipped`);
        if (data.done || !data.nextStartingAfter) break;
        startingAfter = data.nextStartingAfter;
        if (batchNum > 50) { toast.error("Stopped after 50 batches as a safety guard"); break; }
      }
      toast.success(`Backfill complete: ${totalImported} imported, ${totalSkipped} skipped (${totalProcessed} checked)`);
    } catch (err) {
      toast.error("Backfill request failed: " + (err instanceof Error ? err.message : "Unknown"));
    }
    setBackfillRunning(false);
  };

  const runInboxAudit = async (apply: boolean) => {
    if (apply && !confirm("Flag every Intercom-linked ticket that is NOT currently in the enterprise inbox as is_test=true? They will be hidden from analytics but remain viewable. Continue?")) return;
    setAuditRunning(true);
    const all: Array<{ table: string; id: string; intercomId: string; currentTeamId: string; subject: string; contact: string }> = [];
    let total = 0;
    let totalChecked = 0;
    let totalFlagged = 0;
    const purgedMonths = new Set<string>();
    let offset = 0;
    let batchNum = 0;
    try {
      while (true) {
        batchNum++;
        const { data: invokeData, error: invokeError } = await supabase.functions.invoke("audit-out-of-inbox-tickets", { body: { apply, batchSize: 80, offset } });
        const data: any = invokeError ? { error: invokeError.message } : invokeData;
        if (data.error) { toast.error("Audit failed: " + data.error); break; }
        total = data.total || 0;
        totalChecked += data.checked || 0;
        totalFlagged += data.flagged || 0;
        if (Array.isArray(data.mismatches)) all.push(...data.mismatches);
        if (Array.isArray(data.purgedMonths)) for (const m of data.purgedMonths) purgedMonths.add(m);
        toast.info(`Batch ${batchNum}: ${data.checked} checked, ${data.mismatchCount} mismatches${apply ? `, ${data.flagged} flagged` : ""}`);
        if (data.done) break;
        offset = data.nextOffset || 0;
        if (batchNum > 100) { toast.error("Stopped after 100 batches as a safety guard"); break; }
      }
      setAuditReport({ total, mismatches: all });
      const purgeSuffix = apply && purgedMonths.size > 0 ? ` — purged insights for ${purgedMonths.size} month(s): ${Array.from(purgedMonths).sort().join(", ")}` : "";
      toast.success(`Audit ${apply ? "applied" : "scan"} complete: ${totalChecked} checked, ${all.length} mismatches${apply ? `, ${totalFlagged} flagged` : ""}${purgeSuffix}`);
    } catch (err) {
      toast.error("Audit request failed: " + (err instanceof Error ? err.message : "Unknown"));
    }
    setAuditRunning(false);
  };

  const pollIntercomInbox = async () => {
    setIntercomPolling(true);
    try {
      const { data: invokeData, error: invokeError } = await supabase.functions.invoke("poll-intercom-inbox", { body: {} });
      const data: any = invokeError ? { error: invokeError.message } : invokeData;
      if (data.error) {
        toast.error("Poll failed: " + data.error);
      } else {
        const parts = [];
        if (data.imported > 0) parts.push(`${data.imported} imported`);
        if (data.linkedGmail > 0) parts.push(`${data.linkedGmail} linked to Gmail`);
        if (data.alreadyTracked > 0) parts.push(`${data.alreadyTracked} already tracked`);
        toast.success(`Intercom poll complete: ${parts.join(", ") || "no new conversations"}`);
        setLastPolledIntercom(new Date().toISOString());
      }
    } catch (err) {
      toast.error("Poll request failed: " + (err instanceof Error ? err.message : "Unknown"));
    }
    setIntercomPolling(false);
  };

  useEffect(() => {
    loadData();
    checkGmailConnection();
  }, []);

  // Fetch channel names on mount to resolve existing IDs
  useEffect(() => {
    if (settings && monitoredIds.length > 0 && Object.keys(channelNameMap).length === 0) {
      fetchChannelNames();
    }
  }, [settings]);

  const fetchChannelNames = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("list-slack-channels", {
        body: {},
      });
      if (error) throw error;

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
    if (settingsRes.data) {
      setSettings(settingsRes.data as unknown as SettingsData);
      setLastPolledIntercom((settingsRes.data as any).last_polled_intercom_at || null);
    }
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
        sse_intercom_inbox_id: settings.sse_intercom_inbox_id ?? "",
        intercom_assignee_id: settings.intercom_assignee_id,
        slack_bot_user_id: settings.slack_bot_user_id,
        testing_mode: settings.testing_mode,
        test_intercom_inbox_id: settings.test_intercom_inbox_id,
        auto_mark_employee_test: settings.auto_mark_employee_test,
        product_areas: settings.product_areas,
        new_ticket_alert_mentions: settings.new_ticket_alert_mentions ?? "",
        admin_owner_map: (settings as any).admin_owner_map,

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
      const { data, error } = await supabase.functions.invoke("list-slack-channels", {
        body: {},
      });
      if (error) throw error;
      if (data?.error) {

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

        <IntegrationHealthCard />

        <ScheduledJobsCard />

        <InboxV3SyncCard />

        <TicketChannelTestCard />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg">People</CardTitle>
              <CardDescription>
                Access, roles and teammate attribution now live on Admin → People.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/people">
                Open People <ArrowRight className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </CardHeader>
        </Card>




        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Customer accounts
              </CardTitle>
              <CardDescription>
                Customer accounts have moved to Admin → Customers → Registry, the single place to manage them.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/customers?tab=registry">
                Open Registry <ArrowRight className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </CardHeader>
        </Card>





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
              <div className="space-y-2">
                <Label htmlFor="new-ticket-mentions">New-ticket alert mentions (float coverage)</Label>
                <Input
                  id="new-ticket-mentions"
                  placeholder="U0B7TCDJRTQ, U09..."
                  value={settings?.new_ticket_alert_mentions || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, new_ticket_alert_mentions: e.target.value } : s
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Slack user IDs (comma-separated) @-pinged on every new-ticket alert in
                  #enterprise-support-tickets. Leave blank for no ping. Change here to rotate float
                  coverage — no deploy needed.
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
                <Label htmlFor="sse-inbox">Self-serve enterprise Inbox ID</Label>
                <Input
                  id="sse-inbox"
                  placeholder="Leave blank until the SSE inbox exists"
                  value={settings?.sse_intercom_inbox_id || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, sse_intercom_inbox_id: e.target.value } : s
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Tickets assigned to this inbox are ingested as plan tier <strong>SSE</strong>: triage target only,
                  no first-response, resolution or cadence commitments.
                </p>
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

        {/* Product Areas Card */}
        <ProductAreasCard settings={settings} setSettings={setSettings} onSave={saveSettings} />

        {/* Intercom field options (drift only, no validation change) */}
        <IntercomFieldOptionsCard />

        {/* Teammates table hidden — superseded by Admin → People. Component kept for rollback. */}
        {false && <AdminMappingCard settings={settings} setSettings={setSettings} onSave={saveSettings} />}


        {/* Slack channel → account mapping */}
        <SlackChannelAccountMapCard />

        {/* Bot Identity Card */}
        <BotIdentityCard />

        {/* Gmail OAuth Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Gmail connection
            </CardTitle>
            <CardDescription>
              Connect a Gmail account to monitor incoming emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {gmailConnected ? (
              <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-4">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">Connected</p>
                  <p className="text-xs text-green-600 dark:text-green-400">{gmailConnected}</p>
                </div>
                <Button variant="outline" size="sm" onClick={connectGmail} disabled={gmailLoading}>
                  Reconnect
                </Button>
                <Button variant="outline" size="sm" onClick={checkGmailConnection}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-4">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Not connected</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">Click connect to authorize Gmail access</p>
                </div>
                <Button size="sm" onClick={connectGmail} disabled={gmailLoading}>
                  {gmailLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Connect Gmail"}
                </Button>
                <Button variant="outline" size="sm" onClick={checkGmailConnection}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Intercom Inbox Poller Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Ticket className="h-5 w-5" />
              Intercom inbox poller
            </CardTitle>
            <CardDescription>
              Poll Intercom for conversations assigned to the enterprise inbox that were missed by webhooks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <div className="flex-1">
                <p className="text-sm font-medium">Last polled</p>
                <p className="text-xs text-muted-foreground">
                  {lastPolledIntercom
                    ? new Date(lastPolledIntercom).toLocaleString()
                    : "Never"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Auto-runs every 5 minutes via scheduled job
                </p>
              </div>
              <Button size="sm" onClick={pollIntercomInbox} disabled={intercomPolling}>
                {intercomPolling ? (
                  <><RefreshCw className="mr-2 h-3 w-3 animate-spin" /> Polling...</>
                ) : (
                  <><RefreshCw className="mr-2 h-3 w-3" /> Poll now</>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Searches the last 48 hours of enterprise inbox assignments. New conversations are auto-imported or linked to existing Gmail threads.
            </p>

            <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex-1">
                <p className="text-sm font-medium">Clean up mis-imported rows</p>
                <p className="text-xs text-muted-foreground">
                  Verifies every Intercom-sourced conversation against Intercom and deletes those not currently in the enterprise inbox.
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={cleanupBadIntercomImports} disabled={cleanupRunning}>
                {cleanupRunning ? (
                  <><RefreshCw className="mr-2 h-3 w-3 animate-spin" /> Cleaning...</>
                ) : (
                  <>Run cleanup</>
                )}
              </Button>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex-1">
                <p className="text-sm font-medium">Backfill all enterprise inbox tickets</p>
                <p className="text-xs text-muted-foreground">
                  Paginates through every Intercom ticket assigned to the enterprise inbox (open + closed) and imports anything missing.
                </p>
              </div>
              <Button size="sm" onClick={backfillEnterpriseInbox} disabled={backfillRunning}>
                {backfillRunning ? (
                  <><RefreshCw className="mr-2 h-3 w-3 animate-spin" /> Backfilling...</>
                ) : (
                  <>Run backfill</>
                )}
              </Button>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-amber-300/60 bg-amber-50/50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">Inbox audit (flag, don't delete)</p>
                  <p className="text-xs text-muted-foreground">
                    Scans every Intercom-linked ticket across all sources. Mismatches can be flagged as <code>is_test=true</code> so they drop out of analytics but stay viewable.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => runInboxAudit(false)} disabled={auditRunning}>
                  {auditRunning ? <><RefreshCw className="mr-2 h-3 w-3 animate-spin" /> Scanning...</> : <>Scan</>}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => runInboxAudit(true)} disabled={auditRunning}>
                  Flag all as test
                </Button>
              </div>
              {auditReport && (
                <div className="text-xs">
                  <p className="font-medium mb-2">{auditReport.mismatches.length} of {auditReport.total} tickets are outside the enterprise inbox</p>
                  {auditReport.mismatches.length > 0 && (
                    <div className="max-h-48 overflow-auto rounded border bg-background p-2 space-y-1">
                      {auditReport.mismatches.slice(0, 100).map(m => (
                        <div key={m.id} className="flex gap-2 font-mono text-[11px]">
                          <span className="text-muted-foreground">{m.table.replace("_conversations","").replace("conversation_","")}</span>
                          <span>#{m.intercomId}</span>
                          <span className="text-muted-foreground">team {m.currentTeamId}</span>
                          <span className="truncate flex-1">{m.subject || m.contact}</span>
                        </div>
                      ))}
                      {auditReport.mismatches.length > 100 && <p className="text-muted-foreground">+{auditReport.mismatches.length - 100} more</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

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
