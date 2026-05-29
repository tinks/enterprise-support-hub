import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, X, Hash } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Mapping {
  slack_channel_id: string;
  account_domain: string | null;
  account_label: string;
  channel_name: string | null;
}

const SlackChannelAccountMapCard = () => {
  const [rows, setRows] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [accountDomain, setAccountDomain] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("slack_channel_account_map" as any)
      .select("*")
      .order("account_label", { ascending: true });
    if (error) toast.error("Failed to load: " + error.message);
    else setRows((data || []) as unknown as Mapping[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    const id = channelId.trim();
    const label = accountLabel.trim();
    const domain = accountDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (!id || !label) {
      toast.error("Channel ID and account label are required");
      return;
    }
    if (!/^C[A-Z0-9]+$/i.test(id)) {
      toast.error("Channel ID should look like C0ABC123DEF");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("slack_channel_account_map" as any)
      .upsert({
        slack_channel_id: id.toUpperCase(),
        account_label: label,
        account_domain: domain || null,
      }, { onConflict: "slack_channel_id" });
    if (error) {
      toast.error("Save failed: " + error.message);
    } else {
      toast.success("Mapping saved");
      setChannelId("");
      setAccountLabel("");
      setAccountDomain("");
      await load();
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from("slack_channel_account_map" as any)
      .delete()
      .eq("slack_channel_id", id);
    if (error) toast.error("Delete failed: " + error.message);
    else {
      setRows((r) => r.filter((x) => x.slack_channel_id !== id));
      toast.success("Removed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Slack channel → account mapping
        </CardTitle>
        <CardDescription>
          Link Slack channel IDs to a company domain or account name. Analytics will merge Slack channels and
          email domains from the same company into one account when counting unique accounts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
          {!loading && rows.length === 0 && (
            <span className="text-sm text-muted-foreground">No mappings yet</span>
          )}
          {rows.map((r) => (
            <Badge key={r.slack_channel_id} variant="secondary" className="gap-1 pr-1">
              <Hash className="h-3 w-3" />
              {r.channel_name || r.slack_channel_id} → {r.account_label}
              {r.account_domain && <span className="text-muted-foreground">({r.account_domain})</span>}
              <button
                onClick={() => remove(r.slack_channel_id)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Slack channel ID</Label>
            <Input placeholder="C0ABC123DEF" value={channelId} onChange={(e) => setChannelId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Account label</Label>
            <Input placeholder="McKinsey" value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Domain (optional)</Label>
            <Input placeholder="mckinsey.com" value={accountDomain} onChange={(e) => setAccountDomain(e.target.value)} />
          </div>
          <Button variant="outline" onClick={add} disabled={saving} className="gap-1">
            <Plus className="h-3 w-3" />
            Add mapping
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Provide a domain (e.g. <code>mckinsey.com</code>) to merge this Slack channel with email tickets from the same
          domain. Without a domain, the channel still rolls up under the account label.
        </p>
      </CardContent>
    </Card>
  );
};

export default SlackChannelAccountMapCard;
