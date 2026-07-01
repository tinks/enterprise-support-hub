import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, Building2 } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

interface Account {
  account_key: string;
  label: string;
  domains: string[];
  notes: string | null;
}

const emptyDraft = (): Account => ({ account_key: "", label: "", domains: [], notes: null });

export default function CustomerAccountsCard() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Account>(emptyDraft());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [domainsText, setDomainsText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: ticketRows }] = await Promise.all([
      supabase.from("v3_customer_accounts").select("*").order("label"),
      // Single GROUP BY-style aggregation query for ticket counts by customer_key.
      supabase.from("intercom_tickets_v3").select("customer_key"),
    ]);
    setRows((data ?? []) as Account[]);
    const c: Record<string, number> = {};
    for (const r of (ticketRows ?? []) as { customer_key: string | null }[]) {
      const k = r.customer_key ?? "unknown";
      c[k] = (c[k] ?? 0) + 1;
    }
    setCounts(c);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const openNew = () => {
    setDraft(emptyDraft());
    setDomainsText("");
    setEditingKey(null);
    setOpen(true);
  };

  const openEdit = (a: Account) => {
    setDraft({ ...a });
    setDomainsText(a.domains.join(", "));
    setEditingKey(a.account_key);
    setOpen(true);
  };

  const parseDomains = (s: string): string[] =>
    Array.from(new Set(
      s.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
    ));

  const save = async () => {
    if (!draft.account_key.trim() || !draft.label.trim()) {
      toast.error("Account key and label are required");
      return;
    }
    setSaving(true);
    const payload = {
      account_key: draft.account_key.trim(),
      label: draft.label.trim(),
      domains: parseDomains(domainsText),
      notes: draft.notes || null,
    };
    const query = editingKey
      ? supabase.from("v3_customer_accounts").update(payload).eq("account_key", editingKey)
      : supabase.from("v3_customer_accounts").insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingKey ? "Account updated" : "Account created");
    setOpen(false);
    load();
  };

  const remove = async (key: string) => {
    if (!confirm(`Delete account "${key}"? Affected tickets will re-derive automatically.`)) return;
    const { error } = await supabase.from("v3_customer_accounts").delete().eq("account_key", key);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); load(); }
  };

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (counts[b.account_key] ?? 0) - (counts[a.account_key] ?? 0)),
    [rows, counts],
  );

  if (adminLoading) return null;
  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Customer accounts
          </CardTitle>
          <CardDescription>
            Map email domains to a labeled customer account. Used by Inbox v3 and Analytics v3 to slice by customer.
            Deriving a ticket's customer runs: manual override → account domain match → personal-email bucket → generic domain.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3 w-3 mr-1" /> New account
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Domains</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right w-[160px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  No customer accounts yet
                </TableCell>
              </TableRow>
            )}
            {sortedRows.map((a) => (
              <TableRow key={a.account_key}>
                <TableCell className="font-medium">{a.label}</TableCell>
                <TableCell className="font-mono text-xs">{a.account_key}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {a.domains.map((d) => (
                      <Badge key={d} variant="secondary" className="text-xs">{d}</Badge>
                    ))}
                    {a.domains.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{counts[a.account_key] ?? 0}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(a.account_key)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingKey ? "Edit customer account" : "New customer account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Account key</Label>
              <Input
                placeholder="acme"
                value={draft.account_key}
                onChange={(e) => setDraft({ ...draft, account_key: e.target.value })}
                disabled={!!editingKey}
              />
              <p className="text-xs text-muted-foreground">Stable identifier used in URLs and analytics. Cannot be changed later.</p>
            </div>
            <div className="space-y-1">
              <Label>Label</Label>
              <Input
                placeholder="Acme Corp"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Domains</Label>
              <Textarea
                placeholder="acme.com, acme.co.uk"
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
                rows={2}
              />
              <p className="text-xs text-muted-foreground">Comma or space-separated. Domains must be unique across all accounts.</p>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional"
                value={draft.notes ?? ""}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editingKey ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
