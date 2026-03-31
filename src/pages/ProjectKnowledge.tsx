import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Save,
  FileText,
  Eye,
  Pencil,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

const DOC_ID = "project-knowledge";

const ProjectKnowledge = () => {
  const [content, setContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      if ((data as any).pending_content) {
        setMode("review");
      }
    } else {
      // First load — seed from the static file
      try {
        const res = await fetch("/.lovable/project-knowledge.md");
        if (res.ok) {
          const text = await res.text();
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
    const { error } = await supabase
      .from("knowledge_documents")
      .update({
        content: editContent,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", DOC_ID);

    if (error) {
      toast.error("Failed to save");
    } else {
      setContent(editContent);
      toast.success("Knowledge document saved");
    }
    setSaving(false);
  }, [editContent]);

  const handleApprove = useCallback(async () => {
    if (!pendingContent) return;
    const { error } = await supabase
      .from("knowledge_documents")
      .update({
        content: pendingContent,
        pending_content: null,
        pending_summary: null,
        pending_at: null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", DOC_ID);

    if (error) {
      toast.error("Failed to approve");
    } else {
      setContent(pendingContent);
      setEditContent(pendingContent);
      setPendingContent(null);
      setPendingSummary(null);
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

  const hasEdits = editContent !== content;

  // Compute a simple line-level diff for review
  const computeDiff = (
    oldText: string,
    newText: string
  ): Array<{ type: "same" | "added" | "removed"; text: string }> => {
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    const result: Array<{ type: "same" | "added" | "removed"; text: string }> =
      [];

    // Simple LCS-based diff
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

    const diffLines: Array<{ type: "same" | "added" | "removed"; text: string }> = [];
    let i = m,
      j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diffLines.unshift({ type: "same", text: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diffLines.unshift({ type: "added", text: newLines[j - 1] });
        j--;
      } else {
        diffLines.unshift({ type: "removed", text: oldLines[i - 1] });
        i--;
      }
    }

    return diffLines;
  };

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
            `<pre class="bg-muted rounded-md p-3 text-xs overflow-x-auto my-2 font-mono"><code>${codeBlock
              .join("\n")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")}</code></pre>`
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
              `<th class="border border-border px-3 py-1.5 text-left font-medium bg-muted/50">${c.trim()}</th>`
            )
          );
          html.push("</tr></thead><tbody>");
        } else {
          html.push("<tr>");
          cells.forEach((c) => {
            const formatted = c
              .trim()
              .replace(
                /`([^`]+)`/g,
                '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>'
              )
              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
          `<h3 class="text-base font-semibold mt-6 mb-2 text-foreground">${line.slice(4)}</h3>`
        );
      } else if (line.startsWith("## ")) {
        html.push(
          `<h2 class="text-lg font-bold mt-8 mb-3 text-foreground border-b border-border pb-1">${line.slice(3)}</h2>`
        );
      } else if (line.startsWith("# ")) {
        html.push(
          `<h1 class="text-2xl font-bold mb-4 text-foreground">${line.slice(2)}</h1>`
        );
      } else if (line.startsWith("> ")) {
        html.push(
          `<blockquote class="border-l-4 border-primary/30 pl-4 py-1 text-muted-foreground italic my-2">${line.slice(2)}</blockquote>`
        );
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        const formatted = line
          .slice(2)
          .replace(
            /`([^`]+)`/g,
            '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>'
          )
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html.push(
          `<li class="ml-4 list-disc text-sm leading-relaxed">${formatted}</li>`
        );
      } else if (line.startsWith("---")) {
        html.push('<hr class="my-4 border-border" />');
      } else if (line.trim() === "") {
        html.push("<br />");
      } else {
        const formatted = line
          .replace(
            /`([^`]+)`/g,
            '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>'
          )
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
          </div>
          <div className="flex items-center gap-2">
            {mode === "review" ? (
              <div className="flex items-center gap-2">
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
                    className="text-xs border-orange-500/50 text-orange-600 dark:text-orange-400"
                  >
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                    Review
                  </Button>
                )}
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
              <div className="font-mono text-xs leading-relaxed">
                {computeDiff(content, pendingContent).map((line, i) => (
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
