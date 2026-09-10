import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Link2, Check, AlertTriangle } from "lucide-react";

/**
 * Per-person Slack authorisation.
 *
 * Pax answers humans, not bots, so "Ask Pax" posts as the teammate who clicks
 * it. That requires each Enterprise Support teammate to authorise Slack once
 * with their own account. The connection key is exchanged and stored strictly
 * server-side — the browser only ever forwards a one-time code.
 */

export type SlackConnectionStatus = {
  connected: boolean;
  onRoster: boolean;
  slackUserId: string | null;
};

export function useSlackConnection() {
  const [status, setStatus] = useState<SlackConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("slack-user-connection", {
      body: { action: "status" },
    });
    if (error) setStatus({ connected: false, onRoster: false, slackUserId: null });
    else setStatus(data as SlackConnectionStatus);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, refresh };
}

function waitForOAuthCompletion(popup: Window) {
  return new Promise<void>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.data?.connectorId !== "slack" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      ) return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") return resolve();
      popup.close();
      reject(new Error(event.data?.reason ?? "Slack connection failed."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("The Slack window closed before the connection finished."));
    }, 500);
  });
}

export function SlackConnectControl({
  status,
  onChanged,
  compact = false,
}: {
  status: SlackConnectionStatus;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    setConfirmation(null);
    const popup = window.open("", "esh-slack-oauth", "width=600,height=760");
    if (!popup) {
      setError("Popup blocked. Allow popups for this site and try again.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("slack-user-connect", {
        body: { origin: window.location.origin },
      });
      if (fnError) throw fnError;
      const completion = waitForOAuthCompletion(popup);
      popup.location.href = (data as { authorizationUrl: string }).authorizationUrl;
      await completion;
      setConfirmation("Slack connected — Ask Pax will now post as you.");
      onChanged();
    } catch (e) {
      popup.close();
      setError(e instanceof Error ? e.message : "Could not connect Slack.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    setConfirmation(null);
    try {
      await supabase.functions.invoke("slack-user-connection", { body: { action: "disconnect" } });
      setConfirmation("Slack disconnected.");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!status.onRoster) {
    return (
      <p className="text-xs text-muted-foreground">
        Ask Pax is limited to the Enterprise Support team.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {status.connected ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> Your Slack account is connected
          </span>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="text-muted-foreground underline hover:text-foreground"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {!compact && (
            <p className="text-xs text-muted-foreground">
              Pax only answers people, so requests are posted as you. Connect your Slack account
              once to enable it.
            </p>
          )}
          <Button size="sm" variant="outline" onClick={connect} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
            Connect my Slack account
          </Button>
        </div>
      )}

      {confirmation && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{confirmation}</p>
      )}
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
