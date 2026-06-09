import { useState, useCallback, useRef, useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, ChevronDown, ChevronRight, Loader2, FileText, CheckCircle2, AlertTriangle, HelpCircle, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface CsvRow {
  conversationId: string;
  subject: string;
  userEmail: string;
  userName: string;
  date: string;
  state: string;
  assignedTeammate: string;
}

interface ExistingConversation {
  id: string;
  subject: string;
  source: "slack" | "gmail" | "manual";
  intercomId: string | null;
  contactOrEmail: string;
  createdAt: string;
}

type MatchStatus = "tracked" | "possible_duplicate" | "missing";

interface ReviewRow extends CsvRow {
  status: MatchStatus;
  matches: ExistingConversation[];
  selected: boolean;
  fileName: string;
}

interface ImportResult {
  id: string;
  status: "imported" | "skipped" | "failed" | "out_of_inbox";
  error?: string;
  dbId?: string;
  currentTeamId?: string;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current);
        current = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        row.push(current);
        current = "";
        if (row.length > 1) rows.push(row);
        row = [];
        if (ch === "\r") i++;
      } else {
        current += ch;
      }
    }
  }
  if (current || row.length) {
    row.push(current);
    if (row.length > 1) rows.push(row);
  }
  return rows;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/^(re:|fwd:|fw:)\s*/gi, "").trim();
}

function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

const OWNER_MAP: Record<string, string> = {
  "joel samuelson": "Joel",
  "kristina": "Kristina",
  joel: "Joel",
  eren: "Eren",
  tine: "Tine",
  matt: "Matt",
  "matt niiro": "Matt",
};

function mapOwner(teammate: string): string | null {
  const lower = teammate.toLowerCase().trim();
  for (const [key, val] of Object.entries(OWNER_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

type StatusFilter = "all" | MatchStatus;

const BulkImportReview = () => {
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [fileFilter, setFileFilter] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const fileNames = useMemo(() => {
    const names = new Set(reviewRows.map(r => r.fileName));
    return Array.from(names).sort();
  }, [reviewRows]);

  const filteredRows = useMemo(() => {
    let rows = reviewRows;
    if (statusFilter !== "all") {
      rows = rows.filter(r => r.status === statusFilter);
    }
    if (fileFilter !== "all") {
      rows = rows.filter(r => r.fileName === fileFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      rows = rows.filter(r =>
        r.subject.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        r.userName.toLowerCase().includes(q) ||
        r.conversationId.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [reviewRows, statusFilter, searchQuery, fileFilter]);

  const loadExistingConversations = useCallback(async () => {
    const [slackRes, gmailRes, manualRes] = await Promise.all([
      supabase.from("conversation_mappings").select("id, original_message_text, intercom_conversation_id, slack_channel_id, slack_thread_ts, created_at").limit(1000),
      supabase.from("gmail_conversations").select("id, subject, intercom_conversation_id, from_email, created_at").limit(1000),
      supabase.from("manual_conversations").select("id, subject, intercom_conversation_id, contact_name, created_at").limit(1000),
    ]);

    const existing: ExistingConversation[] = [];

    if (slackRes.data) {
      for (const r of slackRes.data) {
        existing.push({ id: r.id, subject: r.original_message_text || "", source: "slack", intercomId: r.intercom_conversation_id, contactOrEmail: "", createdAt: r.created_at });
      }
    }
    if (gmailRes.data) {
      for (const r of gmailRes.data) {
        existing.push({ id: r.id, subject: r.subject || "", source: "gmail", intercomId: r.intercom_conversation_id, contactOrEmail: r.from_email || "", createdAt: r.created_at });
      }
    }
    if (manualRes.data) {
      for (const r of manualRes.data) {
        existing.push({ id: r.id, subject: r.subject || "", source: "manual", intercomId: r.intercom_conversation_id, contactOrEmail: r.contact_name || "", createdAt: r.created_at });
      }
    }

    return existing;
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setLoading(true);
    try {
      const existing = await loadExistingConversations();
      const existingIntercomIds = new Set(existing.filter(e => e.intercomId).map(e => e.intercomId!));

      const allRows: ReviewRow[] = [];

      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsed = parseCSV(text);
        if (parsed.length < 2) continue;

        const headers = parsed[0].map(h => h.trim());
        const idIdx = headers.indexOf("Conversation ID");
        const titleIdx = headers.indexOf("Title");
        const emailIdx = headers.indexOf("User email");
        const nameIdx = headers.indexOf("User name");
        const dateIdx = headers.indexOf("Conversation started at (Europe/Berlin)");
        const stateIdx = headers.indexOf("Current conversation state");
        const teammateIdx = headers.indexOf("Teammate currently assigned");

        if (idIdx === -1) {
          toast.error(`No "Conversation ID" column in ${file.name}`);
          continue;
        }

        for (let i = 1; i < parsed.length; i++) {
          const row = parsed[i];
          const convId = row[idIdx]?.trim();
          if (!convId) continue;

          const csvRow: CsvRow = {
            conversationId: convId,
            subject: titleIdx >= 0 ? row[titleIdx]?.trim() || "" : "",
            userEmail: emailIdx >= 0 ? row[emailIdx]?.trim() || "" : "",
            userName: nameIdx >= 0 ? row[nameIdx]?.trim() || "" : "",
            date: dateIdx >= 0 ? row[dateIdx]?.trim() || "" : "",
            state: stateIdx >= 0 ? row[stateIdx]?.trim() || "" : "",
            assignedTeammate: teammateIdx >= 0 ? row[teammateIdx]?.trim() || "" : "",
          };

          if (existingIntercomIds.has(convId)) {
            const matches = existing.filter(e => e.intercomId === convId);
            allRows.push({ ...csvRow, status: "tracked", matches, selected: false, fileName: file.name });
            continue;
          }

          const fuzzyMatches: ExistingConversation[] = [];
          if (csvRow.subject) {
            for (const e of existing) {
              if (fuzzyMatch(csvRow.subject, e.subject)) {
                fuzzyMatches.push(e);
              }
            }
          }
          if (csvRow.userEmail) {
            for (const e of existing) {
              if (e.contactOrEmail.toLowerCase() === csvRow.userEmail.toLowerCase() && !fuzzyMatches.find(m => m.id === e.id)) {
                if (csvRow.subject && fuzzyMatch(csvRow.subject, e.subject)) {
                  fuzzyMatches.push(e);
                }
              }
            }
          }

          if (fuzzyMatches.length > 0) {
            allRows.push({ ...csvRow, status: "possible_duplicate", matches: fuzzyMatches, selected: false, fileName: file.name });
          } else {
            allRows.push({ ...csvRow, status: "missing", matches: [], selected: true, fileName: file.name });
          }
        }
      }

      setReviewRows(allRows);
      const missing = allRows.filter(r => r.status === "missing").length;
      const tracked = allRows.filter(r => r.status === "tracked").length;
      const possible = allRows.filter(r => r.status === "possible_duplicate").length;
      toast.success(`Parsed ${allRows.length} conversations`, {
        description: `${tracked} tracked, ${possible} possible duplicates, ${missing} missing`,
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse CSV files");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (convId: string) => {
    setReviewRows(prev => prev.map(r =>
      r.conversationId === convId ? { ...r, selected: !r.selected } : r
    ));
  };

  const toggleSelectAll = (status: MatchStatus, checked: boolean) => {
    setReviewRows(prev => prev.map(r =>
      r.status === status ? { ...r, selected: checked } : r
    ));
  };

  const toggleExpand = (convId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(convId)) next.delete(convId); else next.add(convId);
      return next;
    });
  };

  const handleBulkImport = async (forceInbox = false, onlyIds?: string[]) => {
    const selected = onlyIds
      ? reviewRows.filter(r => onlyIds.includes(r.conversationId))
      : reviewRows.filter(r => r.selected && r.status !== "tracked");
    if (selected.length === 0) {
      toast.error("No conversations selected");
      return;
    }

    setImporting(true);
    setImportProgress({ done: 0, total: selected.length });
    if (!onlyIds) setImportResults([]);

    const BATCH_SIZE = 10;
    const allResults: ImportResult[] = onlyIds ? [...importResults.filter(r => !onlyIds.includes(r.id))] : [];

    for (let i = 0; i < selected.length; i += BATCH_SIZE) {
      const batch = selected.slice(i, i + BATCH_SIZE);
      const ids = batch.map(r => r.conversationId);
      const owner = mapOwner(batch[0]?.assignedTeammate || "");

      try {
        const { data, error } = await supabase.functions.invoke("bulk-import-intercom", {
          body: { ids, owner, forceInbox },
        });

        if (error) {
          for (const id of ids) {
            allResults.push({ id, status: "failed", error: "Function error" });
          }
        } else if (data?.results) {
          allResults.push(...data.results);
        }
      } catch {
        for (const id of ids) {
          allResults.push({ id, status: "failed", error: "Network error" });
        }
      }

      setImportProgress({ done: Math.min(i + BATCH_SIZE, selected.length), total: selected.length });
      setImportResults([...allResults]);
    }

    const imported = allResults.filter(r => r.status === "imported").length;
    const failed = allResults.filter(r => r.status === "failed").length;
    const outOfInbox = allResults.filter(r => r.status === "out_of_inbox").length;
    toast.success(`Import complete: ${imported} imported, ${failed} failed${outOfInbox ? `, ${outOfInbox} outside enterprise inbox` : ""}`);

    const importedIds = new Set(allResults.filter(r => r.status === "imported").map(r => r.id));
    setReviewRows(prev => prev.map(r =>
      importedIds.has(r.conversationId) ? { ...r, status: "tracked", selected: false } : r
    ));

    setImporting(false);
  };

  const handleForceOutOfInbox = () => {
    const ids = importResults.filter(r => r.status === "out_of_inbox").map(r => r.id);
    if (ids.length === 0) {
      toast.error("No out-of-inbox rows to retry");
      return;
    }
    handleBulkImport(true, ids);
  };

  const statusBadge = (status: MatchStatus) => {
    switch (status) {
      case "tracked":
        return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Tracked</Badge>;
      case "possible_duplicate":
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><AlertTriangle className="h-3 w-3 mr-1" />Possible duplicate</Badge>;
      case "missing":
        return <Badge className="bg-red-100 text-red-800 border-red-200"><HelpCircle className="h-3 w-3 mr-1" />Missing</Badge>;
    }
  };

  const missingCount = reviewRows.filter(r => r.status === "missing").length;
  const trackedCount = reviewRows.filter(r => r.status === "tracked").length;
  const possibleCount = reviewRows.filter(r => r.status === "possible_duplicate").length;
  const selectedCount = reviewRows.filter(r => r.selected && r.status !== "tracked").length;

  const sourceLabel = (s: string) => s === "slack" ? "Slack" : s === "gmail" ? "Gmail" : "Manual";

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Bulk import review</h1>
            <p className="text-muted-foreground">Upload Intercom CSV exports to compare and import missing conversations</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/import")}>Back to import</Button>
        </div>

        {/* Upload area */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload CSV files</CardTitle>
            <CardDescription>Select one or more Intercom CSV exports to compare against existing conversations</CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="w-full h-24 border-dashed border-2 flex flex-col gap-2"
            >
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Upload className="h-6 w-6" />
              )}
              <span>{loading ? "Parsing..." : "Click to upload CSV files"}</span>
            </Button>
          </CardContent>
        </Card>

        {reviewRows.length > 0 && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-4 gap-4">
              <Card className={`cursor-pointer transition-colors ${statusFilter === "all" ? "ring-2 ring-primary" : ""}`} onClick={() => setStatusFilter("all")}>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold">{reviewRows.length}</p>
                  <p className="text-sm text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card className={`cursor-pointer transition-colors ${statusFilter === "tracked" ? "ring-2 ring-green-500" : ""}`} onClick={() => setStatusFilter(statusFilter === "tracked" ? "all" : "tracked")}>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{trackedCount}</p>
                  <p className="text-sm text-muted-foreground">Tracked</p>
                </CardContent>
              </Card>
              <Card className={`cursor-pointer transition-colors ${statusFilter === "possible_duplicate" ? "ring-2 ring-yellow-500" : ""}`} onClick={() => setStatusFilter(statusFilter === "possible_duplicate" ? "all" : "possible_duplicate")}>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-yellow-600">{possibleCount}</p>
                  <p className="text-sm text-muted-foreground">Possible duplicates</p>
                </CardContent>
              </Card>
              <Card className={`cursor-pointer transition-colors ${statusFilter === "missing" ? "ring-2 ring-red-500" : ""}`} onClick={() => setStatusFilter(statusFilter === "missing" ? "all" : "missing")}>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{missingCount}</p>
                  <p className="text-sm text-muted-foreground">Missing</p>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by subject, email, name, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {fileNames.length > 1 && (
                <Select value={fileFilter} onValueChange={setFileFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All files" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All files</SelectItem>
                    {fileNames.map(f => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Showing {filteredRows.length} of {reviewRows.length}
              </span>
            </div>

            {/* Import controls */}
            <div className="flex items-center gap-4">
              <Button onClick={() => handleBulkImport()} disabled={importing || selectedCount === 0}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Import {selectedCount} selected
              </Button>
              <Button variant="outline" onClick={() => toggleSelectAll("missing", true)}>Select all missing</Button>
              <Button variant="outline" onClick={() => toggleSelectAll("missing", false)}>Deselect all</Button>
              {importResults.some(r => r.status === "out_of_inbox") && (
                <Button variant="outline" onClick={handleForceOutOfInbox} disabled={importing}>
                  Import {importResults.filter(r => r.status === "out_of_inbox").length} outside-inbox anyway
                </Button>
              )}
            </div>

            {/* Progress */}
            {importing && (
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-4">
                    <Progress value={(importProgress.done / importProgress.total) * 100} className="flex-1" />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {importProgress.done} / {importProgress.total}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Results table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]"></TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Teammate</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => {
                      const hasMatches = row.matches.length > 0;
                      const isExpanded = expandedRows.has(row.conversationId);
                      const result = importResults.find(r => r.id === row.conversationId);

                      return (
                        <Collapsible key={row.conversationId} asChild open={isExpanded}>
                          <>
                            <TableRow className={row.status === "tracked" ? "opacity-60" : ""}>
                              <TableCell>
                                {row.status !== "tracked" && (
                                  <Checkbox
                                    checked={row.selected}
                                    onCheckedChange={() => toggleSelect(row.conversationId)}
                                    disabled={importing}
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                {hasMatches && (
                                  <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleExpand(row.conversationId)}>
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </Button>
                                  </CollapsibleTrigger>
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{row.conversationId}</TableCell>
                              <TableCell className="max-w-[200px] truncate" title={row.subject}>{row.subject || "—"}</TableCell>
                              <TableCell className="max-w-[150px] truncate" title={row.userEmail}>
                                {row.userName || row.userEmail || "—"}
                              </TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{row.date ? new Date(row.date).toLocaleDateString() : "—"}</TableCell>
                              <TableCell className="text-xs">{row.assignedTeammate || "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">{row.state}</Badge>
                              </TableCell>
                              <TableCell>
                                {result?.status === "imported" ? (
                                  <Badge className="bg-green-100 text-green-800 border-green-200">Imported</Badge>
                                ) : result?.status === "failed" ? (
                                  <Badge className="bg-red-100 text-red-800 border-red-200">Failed</Badge>
                                ) : result?.status === "out_of_inbox" ? (
                                  <Badge className="bg-amber-100 text-amber-800 border-amber-200" title={`Currently in team ${result.currentTeamId}`}>Outside enterprise inbox</Badge>
                                ) : (
                                  statusBadge(row.status)
                                )}
                              </TableCell>
                              <TableCell className="text-xs max-w-[100px] truncate" title={row.fileName}>
                                <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{row.fileName}</span>
                              </TableCell>
                            </TableRow>
                            <CollapsibleContent asChild>
                              <TableRow className="bg-muted/30">
                                <TableCell colSpan={10} className="p-4">
                                  <p className="text-xs font-medium mb-3">Matched conversations ({row.matches.length}):</p>
                                  <div className="space-y-2">
                                    {row.matches.map(m => (
                                      <div
                                        key={m.id}
                                        className="p-3 rounded-lg border bg-background cursor-pointer hover:bg-muted/50 transition-colors"
                                        onClick={() => {
                                          const params = m.source !== "slack" ? `?source=${m.source}` : "";
                                          navigate(`/conversations/${m.id}${params}`);
                                        }}
                                      >
                                        <div className="flex items-center gap-2 mb-1.5">
                                          <Badge variant="secondary" className="text-xs">{sourceLabel(m.source)}</Badge>
                                          {m.intercomId && (
                                            <span className="text-xs text-muted-foreground font-mono">IC: {m.intercomId}</span>
                                          )}
                                          <span className="text-xs text-muted-foreground ml-auto">
                                            {new Date(m.createdAt).toLocaleDateString()}
                                          </span>
                                        </div>
                                        <p className="text-sm whitespace-normal break-words leading-relaxed">
                                          {m.subject || "No subject"}
                                        </p>
                                        {m.contactOrEmail && (
                                          <p className="text-xs text-muted-foreground mt-1">{m.contactOrEmail}</p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            </CollapsibleContent>
                          </>
                        </Collapsible>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default BulkImportReview;
