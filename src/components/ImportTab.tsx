import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Import, Loader2, Ticket } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface RecentImport {
  id: string;
  label: string;
  source: "slack" | "gmail" | "manual";
  status: string;
  created_at: string;
}

const ImportTab = () => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [intercomUrl, setIntercomUrl] = useState("");
  const [intercomLoading, setIntercomLoading] = useState(false);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadRecentImports();
  }, []);

  const loadRecentImports = async () => {
    const [slackRes, gmailRes, manualRes] = await Promise.all([
      supabase
        .from("conversation_mappings")
        .select("id, original_message_text, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("gmail_conversations")
        .select("id, subject, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("manual_conversations")
        .select("id, subject, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const items: RecentImport[] = [];

    if (slackRes.data) {
      for (const r of slackRes.data) {
        items.push({ id: r.id, label: r.original_message_text || "(no message)", source: "slack", status: r.status, created_at: r.created_at });
      }
    }
    if (gmailRes.data) {
      for (const r of gmailRes.data) {
        items.push({ id: r.id, label: r.subject || "(no subject)", source: "gmail", status: r.status, created_at: r.created_at });
      }
    }
    if (manualRes.data) {
      for (const r of manualRes.data) {
        items.push({ id: r.id, label: r.subject || "(no subject)", source: "manual", status: r.status, created_at: r.created_at });
      }
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setRecentImports(items.slice(0, 5));
  };

  const handleImport = async () => {
    if (!url.trim()) {
      toast.error("Please paste a Slack thread URL");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-slack-thread", {
        body: { url: url.trim() },
      });

      if (error) {
        let errorBody: any = data;
        if (!errorBody && error?.context?.body) {
          try {
            const reader = error.context.body.getReader();
            const { value } = await reader.read();
            errorBody = JSON.parse(new TextDecoder().decode(value));
          } catch {}
        }
        if (!errorBody) {
          try {
            errorBody = JSON.parse(error.message);
          } catch {}
        }

        if (errorBody?.existingId) {
          toast.error("Already imported", {
            description: "This thread already exists in conversations.",
            action: {
              label: "View",
              onClick: () => navigate(`/conversations/${errorBody.existingId}`),
            },
          });
        } else {
          toast.error(errorBody?.error || error.message || "Import failed");
        }
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success("Thread imported successfully", {
        description: `Channel: ${data.channelName}`,
      });
      setUrl("");
      loadRecentImports();
    } catch (err) {
      toast.error("Failed to import thread");
    } finally {
      setLoading(false);
    }
  };

  const handleIntercomImport = async () => {
    const trimmed = intercomUrl.trim();
    if (!trimmed) {
      toast.error("Please paste an Intercom URL");
      return;
    }
    if (!trimmed.includes("/conversation/")) {
      toast.error("Invalid URL — expected a link containing /conversation/");
      return;
    }

    setIntercomLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-intercom-ticket", {
        body: { url: trimmed },
      });

      if (error) {
        let errorBody: any = data;
        if (!errorBody && error?.context?.body) {
          try {
            const reader = error.context.body.getReader();
            const { value } = await reader.read();
            errorBody = JSON.parse(new TextDecoder().decode(value));
          } catch {}
        }
        if (!errorBody) {
          try {
            errorBody = JSON.parse(error.message);
          } catch {}
        }

        if (errorBody?.existingId) {
          const source = errorBody.existingSource || "manual";
          toast.error("Already imported", {
            description: "This Intercom conversation already exists.",
            action: {
              label: "View",
              onClick: () => navigate(`/conversations/${errorBody.existingId}?source=${source}`),
            },
          });
        } else {
          toast.error(errorBody?.error || error.message || "Import failed");
        }
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success("Intercom ticket imported", {
        description: data.subject || "Conversation saved",
      });
      setIntercomUrl("");
      loadRecentImports();
      navigate(`/conversations/${data.id}?source=manual`);
    } catch (err) {
      toast.error("Failed to import Intercom ticket");
    } finally {
      setIntercomLoading(false);
    }
  };

  const navigateToConversation = (item: RecentImport) => {
    const params = item.source !== "slack" ? `?source=${item.source}` : "";
    navigate(`/conversations/${item.id}${params}`);
  };

  const sourceLabel = (source: string) => {
    switch (source) {
      case "slack": return "Slack";
      case "gmail": return "Gmail";
      case "manual": return "Manual";
      default: return source;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Import Slack thread</CardTitle>
          <CardDescription>
            Paste a Slack thread URL to import it as a conversation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="https://yourteam.slack.com/archives/C08XXXXX/p1234567890123456"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleImport()}
              className="flex-1"
            />
            <Button onClick={handleImport} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Import className="h-4 w-4" />
              )}
              Import
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Import Intercom ticket</CardTitle>
          <CardDescription>
            Paste an Intercom conversation URL to import it
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="https://app.intercom.com/.../conversation/215473724302724"
              value={intercomUrl}
              onChange={(e) => setIntercomUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleIntercomImport()}
              className="flex-1"
            />
            <Button onClick={handleIntercomImport} disabled={intercomLoading}>
              {intercomLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ticket className="h-4 w-4" />
              )}
              Import
            </Button>
          </div>
        </CardContent>
      </Card>

      {recentImports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recently imported</CardTitle>
            <CardDescription>
              Last 5 conversations across all sources
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentImports.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigateToConversation(item)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <Badge variant="secondary" className="text-xs">
                      {sourceLabel(item.source)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {item.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ImportTab;
