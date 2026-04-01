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
import { Plus, Trash2, Save, ExternalLink } from "lucide-react";

interface ManualMessage {
  role: "user" | "admin";
  sender_name: string;
  message_text: string;
}

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
  const [source, setSource] = useState("teams");
  const [contactName, setContactName] = useState("");
  const [subject, setSubject] = useState("");
  const [link, setLink] = useState("");
  const [messages, setMessages] = useState<ManualMessage[]>([
    { role: "user", sender_name: "", message_text: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [recentConvos, setRecentConvos] = useState<ManualConversation[]>([]);

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
      prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
    );
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

    setSaving(true);
    const { data: convo, error: convoErr } = await supabase
      .from("manual_conversations")
      .insert({
        source,
        contact_name: contactName.trim(),
        subject: subject.trim(),
        link: link.trim() || null,
      })
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
          {/* Header fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Source</label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="teams">Teams</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Contact name</label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Customer name"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Subject</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Conversation topic"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Link (optional)</label>
              <Input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://teams.microsoft.com/..."
              />
            </div>
          </div>

          <Separator />

          {/* Messages */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Messages</label>
            {messages.map((msg, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-md border p-3">
                <div className="flex flex-col gap-2 flex-1">
                  <div className="flex items-center gap-2">
                    <Select
                      value={msg.role}
                      onValueChange={(v) => updateMessage(idx, "role", v)}
                    >
                      <SelectTrigger className="w-[100px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={msg.sender_name}
                      onChange={(e) => updateMessage(idx, "sender_name", e.target.value)}
                      placeholder="Sender name"
                      className="h-8 text-sm flex-1"
                    />
                  </div>
                  <Textarea
                    value={msg.message_text}
                    onChange={(e) => updateMessage(idx, "message_text", e.target.value)}
                    placeholder="Message text..."
                    className="min-h-[60px] text-sm"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => removeMessage(idx)}
                  disabled={messages.length <= 1}
                >
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
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-xs shrink-0 capitalize">
                      {c.source}
                    </Badge>
                    <span className="truncate font-medium">{c.subject || "No subject"}</span>
                    {c.contact_name && (
                      <span className="text-muted-foreground truncate">— {c.contact_name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                    {c.link && (
                      <a
                        href={c.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80"
                      >
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
