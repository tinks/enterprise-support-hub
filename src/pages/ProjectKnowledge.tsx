import { useState, useEffect, useCallback, useMemo } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadKnowledgeFile } from "@/lib/knowledgeSource";
import {
  Save,
  FileText,
  Eye,
  Pencil,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  DownloadCloud,
  Columns2,
  AlignJustify,
  ChevronsUpDown,
} from "lucide-react";

const DOC_ID = "project-knowledge";


const ProjectKnowledge = () => {
  const [content, setContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [mode, setMode] = useState<"preview" | "edit" | "review">("preview");

  const loadFromDb = useCallback(async () => {
    const { data } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", DOC_ID)
      .maybeSingle();

    if (data) {
      setContent(data.content || "");
      setEditContent(data.content || "");
      setPendingContent((data as any).pending_content || null);
      setPendingSummary((data as any).pending_summary || null);
      setUpdatedAt((data as any).updated_at || null);
      if ((data as any).pending_content) {
        setMode("review");
      }
    } else {
      // First load — seed from the static file
      try {
        const text = await loadKnowledgeFile();
        {
          await supabase
            .from("knowledge_documents")
            .update({ content: text } as any)
            .eq("id", DOC_ID);
          setContent(text);
          setEditContent(text);
        }
      } catch {
        // ignore
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadFromDb();
  }, [loadFromDb]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("knowledge_documents")
      .update({
        content: editContent,
        updated_at: nowIso,
      } as any)
      .eq("id", DOC_ID);

    if (error) {
      toast.error("Failed to save");
    } else {
      setContent(editContent);
      setUpdatedAt(nowIso);
      toast.success("Knowledge document saved");
    }
    setSaving(false);
  }, [editContent]);

  const handleApprove = useCallback(async () => {
    if (!pendingContent) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("knowledge_documents")
      .update({
        content: pendingContent,
        pending_content: null,
        pending_summary: null,
        pending_at: null,
        updated_at: nowIso,
      } as any)
      .eq("id", DOC_ID);

    if (error) {
      toast.error("Failed to approve");
    } else {
      setContent(pendingContent);
      setEditContent(pendingContent);
      setPendingContent(null);
      setPendingSummary(null);
      setUpdatedAt(nowIso);
      setMode("preview");
      toast.success("Changes approved and applied");
    }
  }, [pendingContent]);

  const handleReject = useCallback(async () => {
    const { error } = await supabase
      .from("knowledge_documents")
      .update({
        pending_content: null,
        pending_summary: null,
        pending_at: null,
      } as any)
      .eq("id", DOC_ID);

    if (error) {
      toast.error("Failed to reject");
    } else {
      setPendingContent(null);
      setPendingSummary(null);
      setMode("preview");
      toast.success("Pending changes rejected");
    }
  }, []);

  // Stage the doc shipped with the running app as pending_content for review.
  // The edge function refuses any host outside this project's own origins, so
  // we only pass an explicit sourceUrl when we are actually on one of them.
  const handleSync = useCallback(async () => {
    setSyncing(true);

    // Read the doc bundled with the running app (no network, so it works in
    // dev, preview and published) and hand the text to the function.
    let markdown = "";
    try {
      markdown = await loadKnowledgeFile();
    } catch {
      /* handled below */
    }

    if (!markdown) {
      toast.error("Sync failed", {
        description:
          "Couldn't read the documentation file from this app. Try again from the preview or the published site.",
      });
      setSyncing(false);
      return;
    }

    const { data, error } = await supabase.functions.invoke(
      "sync-knowledge-pending",
      {
        body: {
          markdown,
          summary: "Sync from app — staged from the Knowledge page",
        },
      }
    );

    if (error || (data as any)?.error) {
      toast.error("Sync failed", {
        description: (data as any)?.error || error?.message,
      });
    } else {
      await loadFromDb();
      setMode("review");
      toast.success("Update staged — review the diff, then Approve");
    }
    setSyncing(false);
  }, [loadFromDb]);

  const hasEdits = editContent !== content;

  // --- Diff viewer state (review mode only) ----------------------------------
  type DiffView = "split" | "unified";
  const [diffView, setDiffView] = useState<DiffView>(() => {
    if (typeof window === "undefined") return "split";
    return (localStorage.getItem("knowledge_diff_view") as DiffView) || "split";
  });
  const [onlyChanges, setOnlyChanges] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("knowledge_diff_only_changes");
    return v === null ? true : v === "true";
  });
  const [expandedHunks, setExpandedHunks] = useState<Record<number, boolean>>({});

  useEffect(() => {
    localStorage.setItem("knowledge_diff_view", diffView);
  }, [diffView]);
  useEffect(() => {
    localStorage.setItem("knowledge_diff_only_changes", String(onlyChanges));
  }, [onlyChanges]);

  // Reset collapsed-hunk expansion state when the diff itself changes
  useEffect(() => {
    setExpandedHunks({});
  }, [content, pendingContent]);

  // Compute a line-level LCS diff, with per-side line numbers.
  type DiffLine = {
    type: "same" | "added" | "removed";
    text: string;
    oldNo: number | null;
    newNo: number | null;
  };

  const computeDiff = (oldText: string, newText: string): DiffLine[] => {
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");

    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0)
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          oldLines[i - 1] === newLines[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    const out: DiffLine[] = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        out.unshift({ type: "same", text: oldLines[i - 1], oldNo: i, newNo: j });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        out.unshift({ type: "added", text: newLines[j - 1], oldNo: null, newNo: j });
        j--;
      } else {
        out.unshift({ type: "removed", text: oldLines[i - 1], oldNo: i, newNo: null });
        i--;
      }
    }
    return out;
  };

  // Aligned-row representation for the side-by-side view.
  // Each row has an optional left (current) and right (pending) cell.
  type SplitRow = {
    left: { no: number; text: string; changed: boolean } | null;
    right: { no: number; text: string; changed: boolean } | null;
  };

  const buildSplitRows = (diff: DiffLine[]): SplitRow[] => {
    const rows: SplitRow[] = [];
    let k = 0;
    while (k < diff.length) {
      const d = diff[k];
      if (d.type === "same") {
        rows.push({
          left: { no: d.oldNo!, text: d.text, changed: false },
          right: { no: d.newNo!, text: d.text, changed: false },
        });
        k++;
        continue;
      }
      // Collect a contiguous run of removed and added lines and pair them up
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];
      while (k < diff.length && (diff[k].type === "removed" || diff[k].type === "added")) {
        if (diff[k].type === "removed") removed.push(diff[k]);
        else added.push(diff[k]);
        k++;
      }
      const len = Math.max(removed.length, added.length);
      for (let p = 0; p < len; p++) {
        const r = removed[p];
        const a = added[p];
        rows.push({
          left: r ? { no: r.oldNo!, text: r.text, changed: true } : null,
          right: a ? { no: a.newNo!, text: a.text, changed: true } : null,
        });
      }
    }
    return rows;
  };

  // Group consecutive unchanged rows into a collapsible hunk when "only changes"
  // is on. We always keep CONTEXT lines around each change.
  const CONTEXT = 3;
  type RenderItem =
    | { kind: "row"; row: SplitRow; key: string }
    | { kind: "collapsed"; count: number; key: string; id: number };

  const buildRenderItems = (rows: SplitRow[]): RenderItem[] => {
    if (!onlyChanges) {
      return rows.map((row, idx) => ({ kind: "row", row, key: `r-${idx}` }));
    }
    // Mark each row as changed or unchanged
    const changedFlags = rows.map(
      (r) => (r.left?.changed ?? false) || (r.right?.changed ?? false)
    );
    // For each row, compute distance to nearest changed row in either direction
    const keep = new Array(rows.length).fill(false);
    for (let idx = 0; idx < rows.length; idx++) {
      if (changedFlags[idx]) {
        for (let p = Math.max(0, idx - CONTEXT); p <= Math.min(rows.length - 1, idx + CONTEXT); p++) {
          keep[p] = true;
        }
      }
    }
    const items: RenderItem[] = [];
    let collapsedRun = 0;
    let collapsedId = 0;
    for (let idx = 0; idx < rows.length; idx++) {
      if (keep[idx]) {
        if (collapsedRun > 0) {
          const id = collapsedId++;
          if (expandedHunks[id]) {
            for (let p = idx - collapsedRun; p < idx; p++) {
              items.push({ kind: "row", row: rows[p], key: `r-${p}` });
            }
          } else {
            items.push({ kind: "collapsed", count: collapsedRun, key: `c-${id}`, id });
          }
          collapsedRun = 0;
        }
        items.push({ kind: "row", row: rows[idx], key: `r-${idx}` });
      } else {
        collapsedRun++;
      }
    }
    if (collapsedRun > 0) {
      const id = collapsedId++;
      if (expandedHunks[id]) {
        for (let p = rows.length - collapsedRun; p < rows.length; p++) {
          items.push({ kind: "row", row: rows[p], key: `r-${p}` });
        }
      } else {
        items.push({ kind: "collapsed", count: collapsedRun, key: `c-${id}`, id });
      }
    }
    return items;
  };

  const diffLines = useMemo(
    () => (pendingContent ? computeDiff(content, pendingContent) : []),
    [content, pendingContent]
  );
  const splitRows = useMemo(() => buildSplitRows(diffLines), [diffLines]);
  const renderItems = useMemo(
    () => buildRenderItems(splitRows),
    [splitRows, onlyChanges, expandedHunks]
  );
  const additions = useMemo(
    () => diffLines.filter((d) => d.type === "added").length,
    [diffLines]
  );
  const deletions = useMemo(
    () => diffLines.filter((d) => d.type === "removed").length,
    [diffLines]
  );

  // Escape first, then apply inline markdown — never interpolate raw text.
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const inlineMd = (value: string) =>
    escapeHtml(value)
      .replace(
        /`([^`]+)`/g,
        '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>'
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Simple markdown renderer
  const renderMarkdown = (md: string) => {
    const lines = md.split("\n");
    const html: string[] = [];
    let inCode = false;
    let codeBlock: string[] = [];
    let inTable = false;

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCode) {
          html.push(
            `<pre class="bg-muted rounded-md p-3 text-xs overflow-x-auto my-2 font-mono"><code>${escapeHtml(codeBlock.join("\n"))}</code></pre>`
          );
          codeBlock = [];
          inCode = false;
        } else {
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeBlock.push(line);
        continue;
      }

      if (line.startsWith("|")) {
        if (!inTable) {
          html.push(
            '<div class="overflow-x-auto my-3"><table class="w-full text-sm border-collapse">'
          );
          inTable = true;
        }
        if (line.match(/^\|[\s-:|]+\|$/)) continue;
        const cells = line
          .split("|")
          .filter((_, i, arr) => i > 0 && i < arr.length - 1);
        const isHeader = !html.some((h) => h.includes("<tbody>"));
        if (isHeader && !html.some((h) => h.includes("<thead>"))) {
          html.push("<thead><tr>");
          cells.forEach((c) =>
            html.push(
              `<th class="border border-border px-3 py-1.5 text-left font-medium bg-muted/50">${inlineMd(c.trim())}</th>`
            )
          );
          html.push("</tr></thead><tbody>");
        } else {
          html.push("<tr>");
          cells.forEach((c) => {
            const formatted = inlineMd(c.trim());
            html.push(
              `<td class="border border-border px-3 py-1.5">${formatted}</td>`
            );
          });
          html.push("</tr>");
        }
        continue;
      }
      if (inTable && !line.startsWith("|")) {
        html.push("</tbody></table></div>");
        inTable = false;
      }

      if (line.startsWith("### ")) {
        html.push(
          `<h3 class="text-base font-semibold mt-6 mb-2 text-foreground">${inlineMd(line.slice(4))}</h3>`
        );
      } else if (line.startsWith("## ")) {
        html.push(
          `<h2 class="text-lg font-bold mt-8 mb-3 text-foreground border-b border-border pb-1">${inlineMd(line.slice(3))}</h2>`
        );
      } else if (line.startsWith("# ")) {
        html.push(
          `<h1 class="text-2xl font-bold mb-4 text-foreground">${inlineMd(line.slice(2))}</h1>`
        );
      } else if (line.startsWith("> ")) {
        html.push(
          `<blockquote class="border-l-4 border-primary/30 pl-4 py-1 text-muted-foreground italic my-2">${inlineMd(line.slice(2))}</blockquote>`
        );
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        const formatted = inlineMd(line.slice(2));
        html.push(
          `<li class="ml-4 list-disc text-sm leading-relaxed">${formatted}</li>`
        );
      } else if (line.startsWith("---")) {
        html.push('<hr class="my-4 border-border" />');
      } else if (line.trim() === "") {
        html.push("<br />");
      } else {
        const formatted = inlineMd(line);
        html.push(
          `<p class="text-sm leading-relaxed text-foreground/90">${formatted}</p>`
        );
      }
    }
    if (inTable) html.push("</tbody></table></div>");
    return html.join("\n");
  };

  return (
    <AppLayout>
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Pending change banner */}
        {pendingContent && mode !== "review" && (
          <div className="flex items-center gap-3 bg-primary/10 border-b border-primary/20 px-6 py-2">
            <AlertTriangle className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm text-primary font-medium">
              Pending changes await your review
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => setMode("review")}
            >
              Review Changes
            </Button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-card px-6 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span className="font-medium text-foreground">
              project-knowledge.md
            </span>
            {hasEdits && mode === "edit" && (
              <Badge variant="secondary" className="text-xs">
                unsaved
              </Badge>
            )}
            {pendingContent && (
              <Badge
                variant="outline"
                className="text-xs border-primary/50 text-primary"
              >
                pending review
              </Badge>
            )}
            {updatedAt && (
              <span className="text-xs text-muted-foreground ml-1">
                Last updated {new Date(updatedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {mode === "review" ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs">
                  <Badge
                    variant="outline"
                    className="border-green-500/30 text-green-700 dark:text-green-400 bg-green-500/5 px-1.5 py-0 h-5"
                  >
                    +{additions}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-red-500/30 text-red-700 dark:text-red-400 bg-red-500/5 px-1.5 py-0 h-5"
                  >
                    −{deletions}
                  </Badge>
                </div>
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button
                    onClick={() => setDiffView("split")}
                    title="Side-by-side"
                    className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition-colors ${
                      diffView === "split"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Columns2 className="h-3 w-3" />
                    Side-by-side
                  </button>
                  <button
                    onClick={() => setDiffView("unified")}
                    title="Unified"
                    className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition-colors ${
                      diffView === "unified"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <AlignJustify className="h-3 w-3" />
                    Unified
                  </button>
                </div>
                <button
                  onClick={() => setOnlyChanges((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors ${
                    onlyChanges
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={onlyChanges ? "Showing changes only" : "Showing entire document"}
                >
                  <ChevronsUpDown className="h-3 w-3" />
                  {onlyChanges ? "Only changes" : "Full file"}
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReject}
                  className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Reject
                </Button>
                <Button size="sm" onClick={handleApprove} className="text-xs">
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Approve
                </Button>
              </div>
            ) : (
              <>
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button
                    onClick={() => setMode("preview")}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors ${
                      mode === "preview"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                  <button
                    onClick={() => {
                      setEditContent(content);
                      setMode("edit");
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium transition-colors ${
                      mode === "edit"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                </div>
                {mode === "edit" && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || !hasEdits}
                  >
                    <Save className="mr-1 h-3.5 w-3.5" />
                    {saving ? "Saving…" : "Save"}
                  </Button>
                )}
                {pendingContent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMode("review")}
                    className="text-xs border-primary/50 text-primary"
                  >
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                    Review
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncing}
                  className="text-xs"
                  title="Stage the documentation shipped with this app for review"
                >
                  <DownloadCloud className="mr-1 h-3.5 w-3.5" />
                  {syncing ? "Syncing…" : "Sync from app"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadFromDb}
                  className="text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              Loading…
            </div>
          ) : mode === "review" && pendingContent ? (
            <div className="h-full overflow-y-auto">
              {/* Review header */}
              <div className="bg-muted/30 border-b border-border px-6 py-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Proposed Changes
                </h3>
                {pendingSummary && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {pendingSummary}
                  </p>
                )}
              </div>
              {/* Diff view */}
              {diffView === "unified" ? (
                <div className="font-mono text-xs leading-relaxed">
                  {diffLines.map((line, i) => (
                    <div
                      key={i}
                      className={`px-6 py-0.5 ${
                        line.type === "added"
                          ? "bg-green-500/10 text-green-700 dark:text-green-400"
                          : line.type === "removed"
                            ? "bg-red-500/10 text-red-700 dark:text-red-400 line-through"
                            : "text-foreground/70"
                      }`}
                    >
                      <span className="select-none inline-block w-5 text-right mr-3 text-muted-foreground/50">
                        {line.type === "added"
                          ? "+"
                          : line.type === "removed"
                            ? "−"
                            : " "}
                      </span>
                      {line.text || " "}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="font-mono text-xs leading-relaxed overflow-x-auto">
                  {/* Column headers */}
                  <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-border bg-muted/40 backdrop-blur">
                    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-r border-border">
                      Current (live)
                    </div>
                    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Pending
                    </div>
                  </div>
                  {renderItems.length === 0 && (
                    <div className="px-6 py-6 text-muted-foreground text-center">
                      No differences detected.
                    </div>
                  )}
                  {renderItems.map((item) => {
                    if (item.kind === "collapsed") {
                      return (
                        <button
                          key={item.key}
                          onClick={() =>
                            setExpandedHunks((prev) => ({ ...prev, [item.id]: true }))
                          }
                          className="w-full grid grid-cols-1 border-y border-border bg-muted/30 hover:bg-muted/60 transition-colors text-muted-foreground text-[11px] py-1.5 px-3 text-center"
                        >
                          … Show {item.count} unchanged line{item.count === 1 ? "" : "s"}
                        </button>
                      );
                    }
                    const { left, right } = item.row;
                    const cellClass = (
                      side: "left" | "right",
                      cell: SplitRow["left"]
                    ) => {
                      if (!cell) {
                        // Filler cell (no line on this side) — striped background
                        return "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,hsl(var(--muted))_6px,hsl(var(--muted))_7px)] opacity-60";
                      }
                      if (cell.changed) {
                        return side === "left"
                          ? "bg-red-500/10 text-red-700 dark:text-red-400"
                          : "bg-green-500/10 text-green-700 dark:text-green-400";
                      }
                      return "text-foreground/75";
                    };
                    return (
                      <div key={item.key} className="grid grid-cols-2">
                        {/* Left (current) */}
                        <div
                          className={`flex items-start border-r border-border ${cellClass(
                            "left",
                            left
                          )}`}
                        >
                          <span className="select-none shrink-0 w-10 text-right pr-2 py-0.5 text-muted-foreground/50 border-r border-border/40">
                            {left?.no ?? ""}
                          </span>
                          <span className="select-none shrink-0 w-4 text-center py-0.5 text-muted-foreground/60">
                            {left?.changed ? "−" : ""}
                          </span>
                          <pre className="whitespace-pre-wrap break-words py-0.5 pr-3 flex-1 font-mono">
                            {left ? left.text || " " : " "}
                          </pre>
                        </div>
                        {/* Right (pending) */}
                        <div
                          className={`flex items-start ${cellClass("right", right)}`}
                        >
                          <span className="select-none shrink-0 w-10 text-right pr-2 py-0.5 text-muted-foreground/50 border-r border-border/40">
                            {right?.no ?? ""}
                          </span>
                          <span className="select-none shrink-0 w-4 text-center py-0.5 text-muted-foreground/60">
                            {right?.changed ? "+" : ""}
                          </span>
                          <pre className="whitespace-pre-wrap break-words py-0.5 pr-3 flex-1 font-mono">
                            {right ? right.text || " " : " "}
                          </pre>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : mode === "edit" ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full resize-none bg-background text-foreground text-sm font-mono p-6 focus:outline-none leading-relaxed"
              spellCheck={false}
            />
          ) : (
            <div
              className="h-full overflow-y-auto p-6 max-w-4xl mx-auto"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default ProjectKnowledge;
