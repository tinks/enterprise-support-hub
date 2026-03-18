import { useState, useEffect, useCallback } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, FileText, Eye, Pencil } from "lucide-react";

const FILE_PATH = ".lovable/project-knowledge.md";

const ProjectKnowledge = () => {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("preview");

  useEffect(() => {
    fetch(`/${FILE_PATH}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.text();
      })
      .then((text) => {
        setContent(text);
        setOriginalContent(text);
      })
      .catch(() => {
        setContent("# Project Knowledge\n\nNo content yet.");
        setOriginalContent("");
      })
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = content !== originalContent;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Save via Supabase storage or local — for now we download as file
      const blob = new Blob([content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "project-knowledge.md";
      a.click();
      URL.revokeObjectURL(url);
      setOriginalContent(content);
      toast.success("File downloaded — replace .lovable/project-knowledge.md with it");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [content]);

  // Simple markdown renderer for preview
  const renderMarkdown = (md: string) => {
    const lines = md.split("\n");
    const html: string[] = [];
    let inTable = false;
    let inCode = false;
    let codeBlock: string[] = [];

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCode) {
          html.push(`<pre class="bg-muted rounded-md p-3 text-xs overflow-x-auto my-2 font-mono"><code>${codeBlock.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
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

      // Tables
      if (line.startsWith("|")) {
        if (!inTable) {
          html.push('<div class="overflow-x-auto my-3"><table class="w-full text-sm border-collapse">');
          inTable = true;
        }
        if (line.match(/^\|[\s-:|]+\|$/)) continue; // separator row
        const cells = line.split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1);
        const isHeader = !html.some((h) => h.includes("<tbody>"));
        if (isHeader && !html.some((h) => h.includes("<thead>"))) {
          html.push("<thead><tr>");
          cells.forEach((c) => html.push(`<th class="border border-border px-3 py-1.5 text-left font-medium bg-muted/50">${c.trim()}</th>`));
          html.push("</tr></thead><tbody>");
        } else {
          html.push("<tr>");
          cells.forEach((c) => {
            const formatted = c.trim()
              .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>')
              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
            html.push(`<td class="border border-border px-3 py-1.5">${formatted}</td>`);
          });
          html.push("</tr>");
        }
        continue;
      }
      if (inTable && !line.startsWith("|")) {
        html.push("</tbody></table></div>");
        inTable = false;
      }

      // Headings
      if (line.startsWith("### ")) {
        html.push(`<h3 class="text-base font-semibold mt-6 mb-2 text-foreground">${line.slice(4)}</h3>`);
      } else if (line.startsWith("## ")) {
        html.push(`<h2 class="text-lg font-bold mt-8 mb-3 text-foreground border-b border-border pb-1">${line.slice(3)}</h2>`);
      } else if (line.startsWith("# ")) {
        html.push(`<h1 class="text-2xl font-bold mb-4 text-foreground">${line.slice(2)}</h1>`);
      } else if (line.startsWith("> ")) {
        html.push(`<blockquote class="border-l-4 border-primary/30 pl-4 py-1 text-muted-foreground italic my-2">${line.slice(2)}</blockquote>`);
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        const formatted = line.slice(2)
          .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>')
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html.push(`<li class="ml-4 list-disc text-sm leading-relaxed">${formatted}</li>`);
      } else if (line.startsWith("---")) {
        html.push('<hr class="my-4 border-border" />');
      } else if (line.trim() === "") {
        html.push("<br />");
      } else {
        const formatted = line
          .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>')
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html.push(`<p class="text-sm leading-relaxed text-foreground/90">${formatted}</p>`);
      }
    }
    if (inTable) html.push("</tbody></table></div>");
    return html.join("\n");
  };

  return (
    <AppLayout>
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-card px-6 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span className="font-medium text-foreground">project-knowledge.md</span>
            {hasChanges && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                unsaved changes
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
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
                onClick={() => setMode("edit")}
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
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              {saving ? "Saving…" : "Download"}
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Loading…
            </div>
          ) : mode === "edit" ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
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
