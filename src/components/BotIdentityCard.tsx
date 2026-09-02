import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RefreshCw, Bot, Copy, AlertTriangle, CheckCircle, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BotIdentity {
  ok: boolean;
  token_type_guess: string;
  is_bot_token: boolean;
  app_id: string | null;
  bot_user_id: string;
  expected_bot_user_id: string | null;
  id_match: boolean;
  mismatch_reason: string | null;
  team_id: string;
  team_name: string;
  bot_name: string;
  display_name: string;
  icon_url: string | null;
  mention_format: string;
}

interface ErrorResponse {
  error: string;
  token_type_guess?: string;
  is_bot_token?: boolean;
  hint?: string;
}

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

const BotIdentityCard = () => {
  const [identity, setIdentity] = useState<BotIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorResponse | null>(null);

  const edgeFunctionBaseUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

  const checkIdentity = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: invokeData, error: invokeError } = await supabase.functions.invoke("check-bot-identity", { body: {} });
      const data = invokeError ? { error: invokeError.message } : invokeData;
      if (data.error) {
        setError(data);
        setIdentity(null);
      } else {
        setIdentity(data);
      }
    } catch (err) {
      setError({ error: err instanceof Error ? err.message : "Request failed" });
      setIdentity(null);
    }
    setLoading(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

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
            <AlertDescription className="space-y-2">
              <p>{error.error}</p>
              {error.token_type_guess && (
                <p className="text-xs">Token type: <code>{error.token_type_guess}</code> {!error.is_bot_token && "⚠️ Not a bot token!"}</p>
              )}
              {error.hint && <p className="text-xs">{error.hint}</p>}
            </AlertDescription>
          </Alert>
        )}

        {identity && (
          <>
            {/* ID Match Status */}
            {identity.expected_bot_user_id && !identity.id_match && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Bot ID mismatch — wrong token!</AlertTitle>
                <AlertDescription>
                  <p className="mb-2">{identity.mismatch_reason}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                    <div>
                      <span className="text-muted-foreground">Current ID:</span>
                      <code className="ml-1 rounded bg-destructive/20 px-1">{identity.bot_user_id}</code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expected ID:</span>
                      <code className="ml-1 rounded bg-destructive/20 px-1">{identity.expected_bot_user_id}</code>
                    </div>
                  </div>
                  <p className="text-xs font-medium">Edge functions will block all Slack posting until this is fixed.</p>
                  <ol className="mt-2 ml-4 list-decimal space-y-1 text-xs">
                    <li>Open the correct app at <strong>api.slack.com/apps</strong></li>
                    <li>Go to <strong>OAuth & Permissions</strong> → copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>)</li>
                    <li>Update the <code>SLACK_BOT_TOKEN</code> secret with the correct token</li>
                    <li>Click "Re-check" to verify</li>
                  </ol>
                </AlertDescription>
              </Alert>
            )}

            {identity.expected_bot_user_id && identity.id_match && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Identity verified ✓</AlertTitle>
                <AlertDescription>
                  Bot User ID <code>{identity.bot_user_id}</code> matches the expected ID. All systems go.
                </AlertDescription>
              </Alert>
            )}

            {!identity.expected_bot_user_id && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>No expected Bot User ID configured</AlertTitle>
                <AlertDescription>
                  Set the <strong>Expected Bot User ID</strong> in Configuration above to <code>{identity.bot_user_id}</code> to enable identity verification and prevent wrong-token posting.
                </AlertDescription>
              </Alert>
            )}

            {/* Token type warning */}
            {!identity.is_bot_token && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Wrong token type</AlertTitle>
                <AlertDescription>
                  Token is type "<code>{identity.token_type_guess}</code>" — it must be a Bot token (<code>xoxb-...</code>).
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
                <div className="flex items-center gap-1">
                  <p className="font-mono text-xs">{identity.bot_user_id}</p>
                  <button
                    onClick={() => copyToClipboard(identity.bot_user_id)}
                    className="rounded p-1 hover:bg-muted transition-colors"
                  >
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
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
                <span className="text-xs text-muted-foreground">Token Type</span>
                <Badge variant={identity.is_bot_token ? "default" : "destructive"} className="text-xs">
                  {identity.token_type_guess}
                </Badge>
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
