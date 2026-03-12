import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RefreshCw, Bot, Copy, AlertTriangle, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface BotIdentity {
  ok: boolean;
  app_id: string | null;
  bot_user_id: string;
  team_id: string;
  team_name: string;
  bot_name: string;
  display_name: string;
  icon_url: string | null;
  mention_format: string;
}

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

const BotIdentityCard = () => {
  const [identity, setIdentity] = useState<BotIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edgeFunctionBaseUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

  const checkIdentity = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${edgeFunctionBaseUrl}/check-bot-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setIdentity(null);
      } else {
        setIdentity(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setIdentity(null);
    }
    setLoading(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const nameMatches = identity
    ? identity.display_name.toLowerCase().includes("ask lovable") ||
      identity.bot_name.toLowerCase().includes("ask lovable")
    : false;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Slack Bot Identity
          </CardTitle>
          <CardDescription>
            Verify the active bot token matches your Slack app
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={checkIdentity} disabled={loading}>
          <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {identity ? "Re-check" : "Check Identity"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Identity check failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {identity && (
          <>
            {!nameMatches && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Identity mismatch</AlertTitle>
                <AlertDescription>
                  The active token's identity is "{identity.display_name || identity.bot_name}" — not "Ask Lovable". 
                  This means the <code>SLACK_BOT_TOKEN</code> secret may point to the wrong Slack app. To fix:
                  <ol className="mt-2 ml-4 list-decimal space-y-1 text-xs">
                    <li>Open the "Ask Lovable" app in api.slack.com/apps</li>
                    <li>Go to <strong>OAuth & Permissions</strong> → copy the <strong>Bot User OAuth Token</strong></li>
                    <li>Update the <code>SLACK_BOT_TOKEN</code> secret with the new token</li>
                    <li>Reinstall the app to your workspace</li>
                    <li>Restart your Slack client to clear cache</li>
                  </ol>
                </AlertDescription>
              </Alert>
            )}

            {nameMatches && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Identity verified</AlertTitle>
                <AlertDescription>
                  The active token matches "Ask Lovable". Mention handle and message sender will use this identity.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Bot Name</span>
                <p className="font-medium">{identity.bot_name}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Display Name</span>
                <p className="font-medium">{identity.display_name}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Bot User ID</span>
                <p className="font-mono text-xs">{identity.bot_user_id}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">App ID</span>
                <p className="font-mono text-xs">{identity.app_id || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Workspace</span>
                <p className="font-medium">{identity.team_name}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Mention Format</span>
                <div className="flex items-center gap-1">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{identity.mention_format}</code>
                  <button
                    onClick={() => copyToClipboard(identity.mention_format)}
                    className="rounded p-1 hover:bg-muted transition-colors"
                  >
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              </div>
            </div>

            {identity.icon_url && (
              <div className="flex items-center gap-2 pt-1">
                <img src={identity.icon_url} alt="Bot avatar" className="h-8 w-8 rounded" />
                <span className="text-xs text-muted-foreground">Bot avatar from Slack profile</span>
              </div>
            )}
          </>
        )}

        {!identity && !error && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Click "Check Identity" to verify which Slack app the active token belongs to.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default BotIdentityCard;
