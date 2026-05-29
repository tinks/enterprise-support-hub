import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Upload, Download, FileJson } from "lucide-react";

const TEMPLATE = [
  {
    subject: "SSO login failing for Okta users",
    contact_name: "Jane Doe",
    source: "slack",
    link: "https://yourteam.slack.com/archives/C08XXXXX/p1234567890123456",
    status: "active",
    created_at: "2026-05-29T10:00:00Z",
    owner: "Joel",
    is_bug: true,
    is_feature_request: false,
    product_area: "SSO",
    messages: [
      {
        role: "user",
        sender_name: "Jane Doe",
        message_text: "Our team can no longer sign in via Okta after the latest metadata refresh.",
        created_at: "2026-05-29T10:00:00Z",
        is_internal_note: false,
      },
      {
        role: "admin",
        sender_name: "Joel",
        message_text: "Looking into it now — can you share the error you're seeing?",
        created_at: "2026-05-29T10:05:00Z",
        is_internal_note: false,
      },
    ],
  },
];

const BulkSlackImportCard = () => {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; failed: number; errors: any[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = (() => {
    if (!raw.trim()) return { count: 0, error: null as string | null };
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : Array.isArray(j?.conversations) ? j.conversations : null;
      if (!arr) return { count: 0, error: "Expected an array or { conversations: [...] }" };
      return { count: arr.length, error: null };
    } catch (e) {
      return { count: 0, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  })();

  const handleFile = async (file: File) => {
    const text = await file.text();
    setRaw(text);
    setResult(null);
  };

  const downloadTemplate = () => {
    const blob = new Blob([JSON.stringify(TEMPLATE, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-slack-import-template.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    if (parsed.error || !parsed.count) {
      toast.error(parsed.error || "Paste or upload JSON first");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const body = JSON.parse(raw);
      const { data, error } = await supabase.functions.invoke("bulk-import-slack", { body });
      if (error) {
        toast.error(error.message || "Import failed");
        return;
      }
      setResult(data);
      toast.success(`Imported ${data.imported}, skipped ${data.skipped}, failed ${data.failed}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Bulk import Slack conversations</CardTitle>
        <CardDescription>
          Upload or paste a JSON array of Slack conversations to bulk-import them as manual logs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload .json
          </Button>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download template
          </Button>
        </div>

        <Textarea
          placeholder='Paste a JSON array of conversations, e.g. [{ "subject": "...", "contact_name": "...", "messages": [...] }]'
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setResult(null);
          }}
          className="min-h-[200px] font-mono text-xs"
        />

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            {parsed.error ? (
              <span className="text-destructive">{parsed.error}</span>
            ) : (
              <span>{parsed.count} conversation{parsed.count === 1 ? "" : "s"} detected</span>
            )}
          </div>
          <Button onClick={runImport} disabled={loading || !parsed.count || !!parsed.error}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import {parsed.count > 0 ? `(${parsed.count})` : ""}
          </Button>
        </div>

        {result && (
          <div className="rounded-md border p-3 space-y-2 text-sm">
            <div className="flex gap-4">
              <span className="text-green-600">Imported: {result.imported}</span>
              <span className="text-yellow-600">Skipped: {result.skipped}</span>
              <span className="text-destructive">Failed: {result.failed}</span>
            </div>
            {result.errors?.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Show {result.errors.length} error{result.errors.length === 1 ? "" : "s"}
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto bg-muted p-2 rounded">
                  {JSON.stringify(result.errors, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BulkSlackImportCard;
