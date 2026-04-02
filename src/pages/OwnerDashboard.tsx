import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, AlertCircle, Lightbulb, CheckCircle2, Clock } from "lucide-react";

interface UnifiedRow {
  id: string;
  source: "slack" | "gmail" | "manual";
  subject: string;
  status: string;
  date: string;
  isBug: boolean;
  isFeatureRequest: boolean;
  sourceLabel: string;
}

const OwnerDashboard = () => {
  const { owner } = useParams<{ owner: string }>();
  const navigate = useNavigate();
  const ownerName = owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : "";

  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [slackRes, gmailRes, manualRes] = await Promise.all([
      supabase.from("conversation_mappings").select("id, status, created_at, original_message_text, is_bug, is_feature_request, intercom_conversation_id").eq("owner", ownerName),
      supabase.from("gmail_conversations").select("id, status, created_at, subject, snippet, is_bug, is_feature_request").eq("owner", ownerName),
      supabase.from("manual_conversations").select("id, status, created_at, subject, source, is_bug, is_feature_request").eq("owner", ownerName),
    ]);

    const unified: UnifiedRow[] = [];

    (slackRes.data || []).forEach((r: any) => {
      unified.push({
        id: r.id,
        source: "slack",
        subject: r.original_message_text?.slice(0, 120) || "(no message)",
        status: r.status,
        date: r.created_at,
        isBug: r.is_bug,
        isFeatureRequest: r.is_feature_request,
        sourceLabel: r.intercom_conversation_id ? "Slack bot" : "Slack import",
      });
    });

    (gmailRes.data || []).forEach((r: any) => {
      unified.push({
        id: r.id,
        source: "gmail",
        subject: r.subject || r.snippet?.slice(0, 120) || "(no subject)",
        status: r.status,
        date: r.created_at,
        isBug: r.is_bug,
        isFeatureRequest: r.is_feature_request,
        sourceLabel: "Gmail",
      });
    });

    (manualRes.data || []).forEach((r: any) => {
      const sourceLabels: Record<string, string> = {
        teams: "Teams", phone: "Phone", slack_dm: "Slack DM", intercom: "Intercom import", other: "Other",
      };
      unified.push({
        id: r.id,
        source: "manual",
        subject: r.subject || "(no subject)",
        status: r.status,
        date: r.created_at,
        isBug: r.is_bug,
        isFeatureRequest: r.is_feature_request,
        sourceLabel: sourceLabels[r.source] || r.source,
      });
    });

    unified.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setRows(unified);
    setLoading(false);
  }, [ownerName]);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = useMemo(() => {
    const open = rows.filter(r => !["resolved", "cancelled", "test"].includes(r.status)).length;
    const resolved = rows.filter(r => r.status === "resolved").length;
    const bugs = rows.filter(r => r.isBug).length;
    const frs = rows.filter(r => r.isFeatureRequest).length;
    return { open, resolved, bugs, frs };
  }, [rows]);

  const statusColor = (status: string) => {
    switch (status) {
      case "active": case "awaiting_context": case "open": return "default" as const;
      case "resolved": return "secondary" as const;
      case "escalated": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">{ownerName}'s conversations</h1>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-4 w-4" /> Open
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-foreground">{stats.open}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Resolved
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-foreground">{stats.resolved}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" /> Bugs
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-foreground">{stats.bugs}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Lightbulb className="h-4 w-4" /> Feature requests
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-bold text-foreground">{stats.frs}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Source</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[100px]">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No conversations assigned
                    </TableCell>
                  </TableRow>
                )}
                {rows.map(row => (
                  <TableRow
                    key={`${row.source}-${row.id}`}
                    className="cursor-pointer"
                    onClick={() => navigate(`/conversations/${row.id}?source=${row.source}`)}
                  >
                    <TableCell>
                      <Badge variant="outline" className="text-xs whitespace-nowrap">{row.sourceLabel}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[400px] truncate text-sm">{row.subject}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor(row.status)} className="text-xs">{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default OwnerDashboard;
