import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Trash2, Save, ExternalLink, CalendarIcon, ClipboardPaste } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseThread, ADMIN_OPTIONS, type ParsedMessage } from "@/lib/parseThread";

type ManualMessage = ParsedMessage;

interface ManualConversation {
  id: string;
  source: string;
  contact_name: string;
  subject: string;
  link: string | null;
  status: string;
  created_at: string;
}

const ManualLogTab = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"manual" | "paste">("manual");
  const [source, setSource] = useState("teams");
  const [contactName, setContactName] = useState("");
  const [subject, setSubject] = useState("");
  const [link, setLink] = useState("");
  const [messages, setMessages] = useState<ManualMessage[]>([
    { role: "user", sender_name: "", message_text: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [recentConvos, setRecentConvos] = useState<ManualConversation[]>([]);

  // Paste mode state
  const [channelName, setChannelName] = useState("");
  const [rawThread, setRawThread] = useState("");
  const [threadDate, setThreadDate] = useState<Date | undefined>(undefined);
  const [parsed, setParsed] = useState(false);

  const loadRecent = async () => {
    const { data } = await supabase
      .from("manual_conversations")
      .select("id, source, contact_name, subject, link, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setRecentConvos(data);
  };

  useEffect(() => {
    loadRecent();
  }, []);

  const addMessage = () => {
    setMessages((prev) => [...prev, { role: "user", sender_name: "", message_text: "" }]);
  };

  const removeMessage = (idx: number) => {
    if (messages.length <= 1) return;
    setMessages((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateMessage = (idx: number, field: keyof ManualMessage, value: string) => {
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        if (field === "role") {
          return { ...m, role: value as "user" | "admin", sender_name: "" };
        }
        return { ...m, [field]: value };
      })
    );
  };

  const handleParse = () => {
    if (!rawThread.trim()) {
      toast.error("Paste a thread first");
      return;
    }
    const parsed = parseThread(rawThread);
    if (parsed.length === 0) {
      toast.error("Could not parse any messages. Expected format: Name [HH:MM AM/PM]");
      return;
    }
    setMessages(parsed);
    // Auto-set contact name from first user message
    const firstUser = parsed.find((m) => m.role === "user");
    if (firstUser) setContactName(firstUser.sender_name);
    // Auto-set subject from first message (truncated)
    const firstMsg = parsed[0].message_text;
    setSubject(firstMsg.length > 60 ? firstMsg.slice(0, 60) + "…" : firstMsg);
    setParsed(true);
    toast.success(`Parsed ${parsed.length} messages`);
  };

  const handleSave = async () => {
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    if (messages.every((m) => !m.message_text.trim())) {
      toast.error("Add at least one message");
      return;
    }
    if (mode === "paste" && !threadDate) {
      toast.error("Pick a date for the thread");
      return;
    }

    setSaving(true);

    const insertData: Record<string, unknown> = {
      source: mode === "paste" ? "slack_thread" : source,
      contact_name: contactName.trim(),
      subject: subject.trim(),
      link: mode === "paste" ? (channelName.trim() || null) : (link.trim() || null),
    };
    if (mode === "paste" && threadDate) {
      insertData.created_at = threadDate.toISOString();
    }

    const { data: convo, error: convoErr } = await supabase
      .from("manual_conversations")
      .insert(insertData)
      .select("id")
      .single();

    if (convoErr || !convo) {
      toast.error("Failed to save conversation");
      setSaving(false);
      return;
    }

    const messagesToInsert = messages
      .filter((m) => m.message_text.trim())
      .map((m) => ({
        conversation_id: convo.id,
        role: m.role,
        sender_name: m.sender_name.trim(),
        message_text: m.message_text.trim(),
      }));

    const { error: msgErr } = await supabase
      .from("manual_messages")
      .insert(messagesToInsert);

    if (msgErr) {
      toast.error("Conversation saved but messages failed");
    } else {
      toast.success("Conversation logged");
    }

    // Reset form
    setContactName("");
    setSubject("");
    setLink("");
    setChannelName("");
    setRawThread("");
    setThreadDate(undefined);
    setParsed(false);
    setMessages([{ role: "user", sender_name: "", message_text: "" }]);
    setSaving(false);
    loadRecent();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => { setMode(v as "manual" | "paste"); setParsed(false); }}>
            <TabsList>
              <TabsTrigger value="manual">Log manually</TabsTrigger>
              <TabsTrigger value="paste" className="gap-1">
                <ClipboardPaste className="h-3.5 w-3.5" /> Paste thread
              </TabsTrigger>
            </TabsList>

            {/* ---- Manual mode ---- */}
            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Source</label>
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="teams">Teams</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                      <SelectItem value="slack_dm">Slack DM/Private chat</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Contact name</label>
                  <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Customer name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Subject</label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Conversation topic" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Link (optional)</label>
                  <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://teams.microsoft.com/..." />
                </div>
              </div>
            </TabsContent>

            {/* ---- Paste mode ---- */}
            <TabsContent value="paste" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Channel name</label>
                  <Input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="#ai-days-march" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Thread date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !threadDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {threadDate ? format(threadDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={threadDate} onSelect={setThreadDate} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Subject</label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Auto-filled on parse" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Paste full thread</label>
                <Textarea
                  value={rawThread}
                  onChange={(e) => { setRawThread(e.target.value); setParsed(false); }}
                  placeholder={'Mark Schlosser  [1:47 PM]\nGood Morning, I am trying to...'}
                  className="min-h-[200px] text-sm font-mono"
                />
              </div>
              <Button variant="outline" onClick={handleParse} className="gap-1">
                <ClipboardPaste className="h-3.5 w-3.5" /> Parse thread
              </Button>
              {parsed && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Contact name</label>
                  <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Auto-filled from first user message" />
                </div>
              )}
            </TabsContent>
          </Tabs>

          <Separator />

          {/* Messages — shared between modes */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Messages {parsed && <span className="text-muted-foreground text-xs ml-1">(parsed — edit if needed)</span>}</label>
            {messages.map((msg, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-md border p-3">
                <div className="flex flex-col gap-2 flex-1">
                  <div className="flex items-center gap-2">
                    <Select value={msg.role} onValueChange={(v) => updateMessage(idx, "role", v)}>
                      <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Support representative</SelectItem>
                      </SelectContent>
                    </Select>
                    {msg.role === "admin" ? (
                      <Select value={msg.sender_name} onValueChange={(v) => updateMessage(idx, "sender_name", v)}>
                        <SelectTrigger className="h-8 text-sm flex-1">
                          <SelectValue placeholder="Select support representative" />
                        </SelectTrigger>
                        <SelectContent>
                          {ADMIN_OPTIONS.map((a) => (
                            <SelectItem key={a.slackId} value={a.name}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={msg.sender_name}
                        onChange={(e) => updateMessage(idx, "sender_name", e.target.value)}
                        placeholder="Sender name"
                        className="h-8 text-sm flex-1"
                      />
                    )}
                  </div>
                  <Textarea
                    value={msg.message_text}
                    onChange={(e) => updateMessage(idx, "message_text", e.target.value)}
                    placeholder="Message text..."
                    className="min-h-[60px] text-sm"
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeMessage(idx)} disabled={messages.length <= 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addMessage} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add message
            </Button>
          </div>

          <Separator />

          <Button onClick={handleSave} disabled={saving} className="gap-1">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save conversation"}
          </Button>
        </CardContent>
      </Card>

      {/* Recently logged */}
      {recentConvos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently logged</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentConvos.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-xs shrink-0 capitalize">{c.source}</Badge>
                    <span className="truncate font-medium">{c.subject || "No subject"}</span>
                    {c.contact_name && <span className="text-muted-foreground truncate">— {c.contact_name}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
                    {c.link && (
                      <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ManualLogTab;
