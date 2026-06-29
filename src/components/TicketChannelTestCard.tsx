import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, CheckCircle2, AlertCircle } from "lucide-react";

const TICKET_NOTIFY_CHANNEL_ID = "C0BDZAY8R8A";

export default function TicketChannelTestCard() {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const runTest = async () => {
    setLoading(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("test-ticket-channel-notify");
      if (error) throw error;
      if (data?.ok) {
        setLastResult({ ok: true, detail: `Posted to ${TICKET_NOTIFY_CHANNEL_ID} (ts=${data.ts || "?"})` });
        toast.success("Test message posted to ticket channel");
      } else {
        const detail = data?.error || data?.diagnosis || "Unknown error";
        setLastResult({ ok: false, detail });
        toast.error(`Test failed: ${detail}`);
      }
    } catch (e: any) {
      setLastResult({ ok: false, detail: e.message || String(e) });
      toast.error(`Test failed: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ticket notification channel</CardTitle>
        <CardDescription>
          Verify the Slack channel that receives new-ticket notifications is reachable by the bot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Channel:</span>
          <Badge variant="secondary">{TICKET_NOTIFY_CHANNEL_ID}</Badge>
        </div>
        <Button onClick={runTest} disabled={loading} size="sm" className="gap-2">
          <Send className="h-4 w-4" />
          {loading ? "Sending..." : "Send test message"}
        </Button>
        {lastResult && (
          <div
            className={`flex items-start gap-2 text-sm rounded-md border p-2 ${
              lastResult.ok ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"
            }`}
          >
            {lastResult.ok ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
            )}
            <span className="break-all">{lastResult.detail}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
