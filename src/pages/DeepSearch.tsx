import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RefreshCw, Search as SearchIcon, ExternalLink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TopicDeepDive from "@/pages/search/TopicDeepDive";

type Hit = {
  kind: string;
  ref_id: string;
  title: string | null;
  url_path: string | null;
  snippet: string | null;
  meta: Record<string, unknown> | null;
  source_updated_at: string | null;
  rank: number | null;
  match_mode: string | null;
};

const KINDS = [
  { value: "v3_ticket", label: "Tickets (v3)" },
  { value: "note", label: "Notes" },
  { value: "escalation", label: "Escalations" },
  { value: "backlog", label: "Backlog" },
  { value: "customer", label: "Customers" },
  { value: "severity_proposal", label: "Severity proposals" },
] as const;

const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;

function Snippet({ text }: { text: string }) {
  // The RPC marks matches with << >>; render those as highlighted spans.
  const parts = text.split(/(<<[^>]*?>>)/g);
  return (
    <p className="text-sm text-muted-foreground leading-relaxed">
      {parts.map((p, i) =>
        p.startsWith("<<") && p.endsWith(">>") ? (
          <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

export default function DeepSearch() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const initial = params.get("q") ?? "";

  const [term, setTerm] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const [kinds, setKinds] = useState<string[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [indexedAt, setIndexedAt] = useState<string | null>(null);
  const [indexSize, setIndexSize] = useState<number | null>(null);

  const loadIndexMeta = useCallback(async () => {
    const { data, error } = await supabase
      .from("esh_search_index")
      .select("indexed_at")
      .order("indexed_at", { ascending: false })
      .limit(1);
    if (!error && data?.[0]) setIndexedAt(data[0].indexed_at as string);
    const { count } = await supabase
      .from("esh_search_index")
      .select("ref_id", { count: "exact", head: true });
    setIndexSize(count ?? null);
  }, []);

  useEffect(() => {
    void loadIndexMeta();
  }, [loadIndexMeta]);

  const runSearch = useCallback(
    async (q: string, activeKinds: string[]) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setHits([]);
        return;
      }
      setLoading(true);
      const { data, error } = await supabase.rpc("esh_deep_search", {
        p_q: trimmed,
        p_kinds: activeKinds.length ? activeKinds : null,
        p_limit: 200,
      });
      setLoading(false);
      if (error) {
        toast.error(`Search failed: ${error.message}`);
        return;
      }
      setHits((data ?? []) as Hit[]);
    },
    [],
  );

  useEffect(() => {
    if (submitted) void runSearch(submitted, kinds);
    else setHits([]);
  }, [submitted, kinds, runSearch]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(term);
    const next = new URLSearchParams(params);
    if (term.trim()) next.set("q", term.trim());
    else next.delete("q");
    setParams(next, { replace: true });
  };

  const reindex = async () => {
    setReindexing(true);
    const { error } = await supabase.rpc("esh_refresh_search_index", { p_kinds: null });
    setReindexing(false);
    if (error) {
      toast.error(`Reindex failed: ${error.message}`);
      return;
    }
    toast.success("Search index rebuilt");
    await loadIndexMeta();
    if (submitted) void runSearch(submitted, kinds);
  };

  const toggleKind = (k: string) =>
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const h of hits) m[h.kind] = (m[h.kind] ?? 0) + 1;
    return m;
  }, [hits]);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-[1400px]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Deep search</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Searches ticket subjects, message bodies, custom attributes (Linear / Escalated Issue),
              notes, escalations, backlog items, the customer registry, and severity rationales.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {indexSize !== null && <span>{indexSize.toLocaleString()} indexed records</span>}
            {indexedAt && <span>· refreshed {new Date(indexedAt).toLocaleString()}</span>}
            <Button variant="outline" size="sm" onClick={reindex} disabled={reindexing}>
              {reindexing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Reindex now
            </Button>
          </div>
        </div>

        <Tabs defaultValue="search" className="space-y-6">
          <TabsList>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="topic">Topic deep dive</TabsTrigger>
          </TabsList>

          <TabsContent value="topic">
            <TopicDeepDive />
          </TabsContent>

          <TabsContent value="search" className="space-y-6">
        <form onSubmit={submit} className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="SCA-3522, a phrase from a message, an email, a Slack channel ID…"
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => {
            const active = kinds.includes(k.value);
            return (
              <button
                key={k.value}
                type="button"
                onClick={() => toggleKind(k.value)}
                className={`text-xs rounded-full border px-3 py-1 transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {k.label}
                {counts[k.value] ? ` (${counts[k.value]})` : ""}
              </button>
            );
          })}
          {kinds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setKinds([])}>
              Clear filters
            </Button>
          )}
        </div>

        {submitted && !loading && (
          <p className="text-sm text-muted-foreground">
            {hits.length === 0
              ? `No matches for "${submitted}".`
              : `${hits.length} match${hits.length === 1 ? "" : "es"} for "${submitted}"${
                  hits.length >= 200 ? " (capped at 200)" : ""
                }`}
          </p>
        )}

        <div className="space-y-3">
          {hits.map((h) => {
            const intercomId = (h.meta as { intercom_id?: string } | null)?.intercom_id;
            return (
              <Card key={`${h.kind}:${h.ref_id}`} className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">{kindLabel(h.kind)}</Badge>
                      <button
                        type="button"
                        className="text-sm font-medium text-left hover:underline"
                        onClick={() => {
                          const path =
                            h.kind === "backlog" && h.title
                              ? `/backlog?q=${encodeURIComponent(h.title)}`
                              : h.url_path;
                          if (path) navigate(path);
                        }}
                        disabled={!h.url_path}
                      >
                        {h.title || h.ref_id}
                      </button>
                      {h.match_mode === "ident" && (
                        <Badge variant="outline" className="text-[10px]">
                          id / name match
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {h.source_updated_at && (
                        <span>{new Date(h.source_updated_at).toLocaleDateString()}</span>
                      )}
                      {intercomId && (
                        <>
                          <span className="font-mono">ID {intercomId}</span>
                          <a
                            href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${intercomId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            Intercom <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                    </div>

                  </div>
                  {h.snippet && <Snippet text={h.snippet} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
