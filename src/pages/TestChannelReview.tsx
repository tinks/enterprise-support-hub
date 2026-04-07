import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { channelNameOverrides } from "@/lib/channelOverrides";
import { parseThread } from "@/lib/parseThread";
import { Loader2, Link, RefreshCw, Search, Trash2, ClipboardPaste, CalendarIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface ConversationRow {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  slack_user_id: string;
  original_message_text: string;
  status: string;
  owner: string | null;
  created_at: string;
  is_test: boolean;
}

function threadTsToDate(ts: string): Date {
  return new Date(parseFloat(ts) * 1000);
}

function driftLabel(createdAt: string, threadTs: string): { text: string; color: string } {
  const dbDate = new Date(createdAt);
  const threadDate = threadTsToDate(threadTs);
  const diffHours = Math.abs(dbDate.getTime() - threadDate.getTime()) / (1000 * 60 * 60);
  if (diffHours < 1) return { text: "OK", color: "bg-green-100 text-green-800" };
  if (diffHours < 24) return { text: `${Math.round(diffHours)}h drift`, color: "bg-yellow-100 text-yellow-800" };
  return { text: `${Math.round(diffHours / 24)}d drift`, color: "bg-red-100 text-red-800" };
}

const TARGET_CHANNEL = "C0AJP396C85";

export default function TestChannelReview() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [customUrls, setCustomUrls] = useState<Record<string, string>>({});
  const [relinkRow, setRelinkRow] = useState<ConversationRow | null>(null);
  const [relinkUrl, setRelinkUrl] = useState("");
  const [relinking, setRelinking] = useState(false);
  const [dupeResults, setDupeResults] = useState<Record<string, Array<{ id: string; subject: string; contact_name: string; source: string; created_at: string }>>>({});
  const [dupeLoading, setDupeLoading] = useState<string | null>(null);

  // Log & replace state
  const [logRow, setLogRow] = useState<ConversationRow | null>(null);
  const [logChannelName, setLogChannelName] = useState("");
  const [logDate, setLogDate] = useState<Date | undefined>(undefined);
  const [logRawThread, setLogRawThread] = useState("");
  const [logOwner, setLogOwner] = useState("");
  const [logSaving, setLogSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase
      .from("conversation_mappings")
      .select("id, slack_channel_id, slack_thread_ts, slack_user_id, original_message_text, status, owner, created_at, is_test")
      .eq("slack_channel_id", TARGET_CHANNEL)
      .eq("is_test", false)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load conversations");
      console.error(error);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  function selectDrifted() {
    const drifted = rows.filter((r) => {
      const diffHours = Math.abs(new Date(r.created_at).getTime() - threadTsToDate(r.slack_thread_ts).getTime()) / (1000 * 60 * 60);
      return diffHours >= 1;
    });
    setSelected(new Set(drifted.map((r) => r.id)));
  }

  async function reimportSelected() {
    const toImport = rows.filter((r) => selected.has(r.id));
    if (toImport.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    let success = 0;
    let failed = 0;

    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i];
      const defaultUrl = `https://lovable.slack.com/archives/${row.slack_channel_id}/p${row.slack_thread_ts.replace(".", "")}`;
      const finalUrl = customUrls[row.id] || defaultUrl;

      try {
        const { data, error } = await supabase.functions.invoke("import-slack-thread", {
          body: {
            url: finalUrl,
            force: true,
            existingId: row.id,
          },
        });

        if (error) {
          console.error(`Failed to re-import ${row.id}:`, error);
          failed++;
        } else if (data?.error) {
          console.error(`Re-import error for ${row.id}:`, data.error);
          failed++;
        } else {
          success++;
        }
      } catch (err) {
        console.error(`Exception re-importing ${row.id}:`, err);
        failed++;
      }

      setImportProgress(i + 1);
      // Rate limit
      if (i < toImport.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    toast.success(`Re-imported ${success} conversations${failed > 0 ? `, ${failed} failed` : ""}`);
    setImporting(false);
    setSelected(new Set());
    setCustomUrls({});
    loadData();
  }

  async function relinkConversation() {
    if (!relinkRow || !relinkUrl.trim()) return;
    setRelinking(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-slack-thread", {
        body: {
          url: relinkUrl.trim(),
          force: true,
          existingId: relinkRow.id,
        },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to relink");
      } else {
        toast.success("Conversation relinked successfully");
        setRelinkRow(null);
        setRelinkUrl("");
        loadData();
      }
    } catch (err) {
      toast.error("Failed to relink conversation");
    }
    setRelinking(false);
  }

  async function findDuplicates(row: ConversationRow) {
    const searchTerm = (row.original_message_text || "").substring(0, 40).trim();
    if (!searchTerm) {
      toast.error("No message text to search");
      return;
    }
    setDupeLoading(row.id);
    const { data, error } = await supabase
      .from("manual_conversations")
      .select("id, subject, contact_name, source, created_at")
      .ilike("subject", `%${searchTerm}%`);

    if (error) {
      toast.error("Failed to search duplicates");
    } else {
      setDupeResults((prev) => ({ ...prev, [row.id]: data || [] }));
    }
    setDupeLoading(null);
  }

  async function deleteDuplicate(manualId: string, rowId: string) {
    const { error: msgErr } = await supabase
      .from("manual_messages")
      .delete()
      .eq("conversation_id", manualId);
    if (msgErr) console.error("Failed to delete messages:", msgErr);

    const { error } = await supabase
      .from("manual_conversations")
      .delete()
      .eq("id", manualId);

    if (error) {
      toast.error("Failed to delete duplicate");
    } else {
      toast.success("Duplicate removed");
      setDupeResults((prev) => ({
        ...prev,
        [rowId]: (prev[rowId] || []).filter((d) => d.id !== manualId),
      }));
    }
  }

  const channelName = channelNameOverrides[TARGET_CHANNEL] || TARGET_CHANNEL;

  const driftedCount = rows.filter((r) => {
    const diffHours = Math.abs(new Date(r.created_at).getTime() - threadTsToDate(r.slack_thread_ts).getTime()) / (1000 * 60 * 60);
    return diffHours >= 1;
  }).length;

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Test channel review</h1>
            <p className="text-muted-foreground">
              #{channelName} — {rows.length} conversations, {driftedCount} with timestamp drift
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectDrifted} disabled={importing}>
              Select drifted ({driftedCount})
            </Button>
            <Button variant="outline" size="sm" onClick={selectAll} disabled={importing}>
              {selected.size === rows.length ? "Deselect all" : "Select all"}
            </Button>
            <Button
              size="sm"
              onClick={reimportSelected}
              disabled={importing || selected.size === 0}
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Re-importing {importProgress}/{selected.size}
                </>
              ) : (
                `Re-import selected (${selected.size})`
              )}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selected.size === rows.length && rows.length > 0}
                          onCheckedChange={selectAll}
                        />
                      </TableHead>
                      <TableHead className="w-[300px]">Message preview</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead className="w-[100px]">Owner</TableHead>
                      <TableHead className="w-[140px]">DB created_at</TableHead>
                      <TableHead className="w-[140px]">Thread time</TableHead>
                      <TableHead className="w-[100px]">Drift</TableHead>
                      <TableHead className="w-[50px]">URL</TableHead>
                      <TableHead className="w-[80px]">Relink</TableHead>
                      <TableHead className="w-[80px]">Dupes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const drift = driftLabel(row.created_at, row.slack_thread_ts);
                      const threadDate = threadTsToDate(row.slack_thread_ts);
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(row.id)}
                              onCheckedChange={() => toggleSelect(row.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="text-sm whitespace-normal break-words leading-relaxed max-w-[300px]">
                              {row.original_message_text || "(empty)"}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.status === "resolved" ? "secondary" : "default"}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.owner || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(row.created_at), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(threadDate, "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${drift.color}`}>
                              {drift.text}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant={customUrls[row.id] ? "default" : "ghost"} size="icon" className="h-7 w-7">
                                  <Link className="h-3.5 w-3.5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80" align="end">
                                <div className="space-y-2">
                                  <p className="text-sm font-medium">Custom Slack URL</p>
                                  <Input
                                    placeholder="https://lovable.slack.com/archives/..."
                                    value={customUrls[row.id] || ""}
                                    onChange={(e) =>
                                      setCustomUrls((prev) => ({
                                        ...prev,
                                        [row.id]: e.target.value,
                                      }))
                                    }
                                  />
                                  {customUrls[row.id] && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        setCustomUrls((prev) => {
                                          const next = { ...prev };
                                          delete next[row.id];
                                          return next;
                                        })
                                      }
                                    >
                                      Clear
                                    </Button>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                setRelinkRow(row);
                                setRelinkUrl("");
                              }}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Relink
                            </Button>
                          </TableCell>
                          <TableCell>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => findDuplicates(row)}
                                  disabled={dupeLoading === row.id}
                                >
                                  {dupeLoading === row.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Search className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-96" align="end">
                                <div className="space-y-2">
                                  <p className="text-sm font-medium">Manual log duplicates</p>
                                  {!dupeResults[row.id] ? (
                                    <p className="text-xs text-muted-foreground">Click to search</p>
                                  ) : dupeResults[row.id].length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No duplicates found</p>
                                  ) : (
                                    dupeResults[row.id].map((dupe) => (
                                      <div key={dupe.id} className="border rounded p-2 space-y-1">
                                        <p className="text-xs font-medium">{dupe.subject.slice(0, 120)}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {dupe.contact_name} · {dupe.source} · {format(new Date(dupe.created_at), "MMM d, HH:mm")}
                                        </p>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          className="h-6 text-xs"
                                          onClick={() => deleteDuplicate(dupe.id, row.id)}
                                        >
                                          <Trash2 className="h-3 w-3 mr-1" />
                                          Delete duplicate
                                        </Button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={!!relinkRow} onOpenChange={(open) => { if (!open) { setRelinkRow(null); setRelinkUrl(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Relink conversation</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-2">
              Paste the correct Slack thread URL. This will overwrite the channel, thread, user, message, and date for this conversation.
            </p>
            {relinkRow && (
              <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                Current: {relinkRow.original_message_text?.slice(0, 100) || "(empty)"}
              </p>
            )}
            <Input
              placeholder="https://lovable.slack.com/archives/..."
              value={relinkUrl}
              onChange={(e) => setRelinkUrl(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setRelinkRow(null); setRelinkUrl(""); }}>
                Cancel
              </Button>
              <Button onClick={relinkConversation} disabled={relinking || !relinkUrl.trim()}>
                {relinking ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Relinking...</> : "Relink"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
