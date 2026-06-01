import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, StickyNote, User as UserIcon, MessageSquare } from "lucide-react";
import { format } from "date-fns";

export type InlineSource = "slack" | "gmail" | "manual";

const OWNER_OPTIONS = ["Joel", "Kristina", "Sam", "CSM", "Eren", "Tine"] as const;
const STATUS_OPTIONS = ["active", "resolved", "cancelled", "escalated", "awaiting_context", "awaiting_support", "awaiting_engineering", "open"];

const statusLabel = (s: string) => {
  switch (s) {
    case "awaiting_context": return "Awaiting customer";
    case "awaiting_support": return "Awaiting support";
    case "awaiting_engineering": return "Awaiting engineering";
    default: return s.replace(/_/g, " ");
  }
};

interface Message {
  id: string;
  sender: string;
  text: string;
  ts: string;
  role?: string;
  isNote?: boolean;
}

interface Note {
  id: string;
  author: string;
  note_text: string;
  created_at: string;
}

interface Props {
  id: string;
  source: InlineSource;
  contactName: string;
  subject: string;
  owner: string | null;
  status: string;
  productArea: string | null;
  productAreas: string[];
  onOwnerChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onProductAreaChange: (v: string) => void;
  slackChannelId?: string;
  slackThreadTs?: string;
  gmailThreadId?: string | null;
}

const InlineConversationDetail = ({
  id, source, contactName, subject, owner, status, productArea, productAreas,
  onOwnerChange, onStatusChange, onProductAreaChange,
  slackChannelId, slackThreadTs, gmailThreadId,
}: Props) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const msgs: Message[] = [];
      try {
        if (source === "slack" && slackChannelId && slackThreadTs) {
          const res = await supabase.functions.invoke("fetch-thread-messages", {
            body: { channelId: slackChannelId, threadTs: slackThreadTs },
          });
          const list = (res.data?.messages || []) as Array<{ text: string; user_name: string; ts: string; is_bot: boolean }>;
          list.forEach((m, i) => msgs.push({
            id: `${m.ts}-${i}`,
            sender: m.user_name || (m.is_bot ? "Bot" : "User"),
            text: m.text || "",
            ts: new Date(parseFloat(m.ts) * 1000).toISOString(),
            role: m.is_bot ? "admin" : "user",
          }));
        } else if (source === "gmail" && gmailThreadId) {
          const res = await supabase.functions.invoke("fetch-gmail-thread", {
            body: { threadId: gmailThreadId },
          });
          const list = (res.data?.messages || []) as Array<{ id: string; from_name: string; from_email: string; date: string; body: string; snippet: string }>;
          list.forEach((m) => msgs.push({
            id: m.id,
            sender: m.from_name || m.from_email || "—",
            text: m.body || m.snippet || "",
            ts: m.date,
          }));
        } else if (source === "manual") {
          const { data } = await supabase
            .from("manual_messages")
            .select("*")
            .eq("conversation_id", id)
            .order("created_at", { ascending: true });
          (data || []).forEach((m: any) => msgs.push({
            id: m.id,
            sender: m.sender_name || (m.role === "admin" ? "Support" : "Customer"),
            text: m.message_text || "",
            ts: m.created_at,
            role: m.role,
            isNote: !!m.is_internal_note,
          }));
        }

        const { data: noteRows } = await supabase
          .from("conversation_notes")
          .select("*")
          .eq("conversation_id", id)
          .eq("conversation_source", source)
          .order("created_at", { ascending: false });
        if (!cancelled) {
          setMessages(msgs);
          setNotes((noteRows || []) as Note[]);
        }
      } catch (err) {
        console.error("Inline detail load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, source, slackChannelId, slackThreadTs, gmailThreadId]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="bg-muted/30 border-y border-border p-4 space-y-4" onClick={stop}>
      <div className="flex flex-wrap gap-2 items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground truncate">{subject || "(no subject)"}</div>
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-0.5">
            <UserIcon className="h-3 w-3" />
            {contactName || "—"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Owner</label>
            <Select value={owner || ""} onValueChange={onOwnerChange}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {OWNER_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                {owner && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</label>
            <Select value={status} onValueChange={onStatusChange}>
              <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue>{statusLabel(status)}</SelectValue></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Product area</label>
            <Select value={productArea || ""} onValueChange={onProductAreaChange}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {productAreas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                {productArea && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> Messages
          </div>
          <div className="rounded border border-border bg-background max-h-[360px] overflow-y-auto divide-y divide-border">
            {loading ? (
              <div className="p-4 flex items-center justify-center text-muted-foreground text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading messages…
              </div>
            ) : messages.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">No messages found.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`p-2.5 text-xs ${m.isNote ? "bg-amber-50" : m.role === "admin" ? "bg-primary/5" : ""}`}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="font-medium text-foreground">{m.sender}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {m.ts ? format(new Date(m.ts), "MMM d, HH:mm") : ""}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-foreground/90 break-words">{m.text}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1">
            <StickyNote className="h-3 w-3" /> Notes
          </div>
          <div className="rounded border border-border bg-background max-h-[360px] overflow-y-auto divide-y divide-border">
            {loading ? (
              <div className="p-4 text-xs text-muted-foreground">Loading…</div>
            ) : notes.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">No notes.</div>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="p-2.5 text-xs">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="font-medium text-foreground">{n.author || "Unknown"}</span>
                    <span className="text-[10px] text-muted-foreground">{format(new Date(n.created_at), "MMM d, HH:mm")}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-foreground/90 break-words">{n.note_text}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InlineConversationDetail;
