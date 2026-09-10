import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Landing route for the per-person Slack OAuth popup.
 * Forwards ONLY the one-time code to the completion edge function; the
 * connection key never exists in the browser.
 */
export default function SlackReturn() {
  const [message, setMessage] = useState("Finishing your Slack connection…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const notify = (
      type: "appUserConnectorOAuthComplete" | "appUserConnectorOAuthFailed",
      reason?: string,
    ) => {
      window.opener?.postMessage(
        { type, connectorId: "slack", reason },
        window.location.origin,
      );
    };

    if (params.get("success") !== "true") {
      const reason = params.get("error") ?? "Slack authorization did not complete.";
      setMessage(reason);
      notify("appUserConnectorOAuthFailed", reason);
      window.close();
      return;
    }

    const code = params.get("code");
    if (!code) {
      const reason =
        params.get("offline_access_allowed") === "false"
          ? "This Slack connection cannot be used yet: offline access must be enabled on the connector client."
          : "Slack authorization completed without an exchange code.";
      setMessage(reason);
      notify("appUserConnectorOAuthFailed", reason);
      return;
    }

    void supabase.functions
      .invoke("slack-user-connect-complete", { body: { code } })
      .then(({ error }) => {
        if (error) throw error;
        setMessage("Connected. You can close this window.");
        notify("appUserConnectorOAuthComplete");
        window.close();
      })
      .catch(() => {
        const reason = "Could not finish the Slack connection.";
        setMessage(reason);
        notify("appUserConnectorOAuthFailed", reason);
      });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
