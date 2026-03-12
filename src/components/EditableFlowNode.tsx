import { useState } from "react";
import { Position, Handle } from "@xyflow/react";
import { Pencil, Check, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export type FlowNodeData = {
  label: string;
  desc: string;
  icon: React.ElementType;
  details?: string[];
  message?: string;
  messageKey?: string;
  edgeFunction?: string;
  reactions?: string[];
  status?: string;
  accent?: "blue" | "green" | "orange" | "default";
  wide?: boolean;
  onMessageSave?: (key: string, text: string) => void;
  botIdentity?: { name: string; avatarUrl: string };
};

const accentBorder: Record<string, string> = {
  blue: "border-l-[hsl(var(--primary))]",
  green: "border-l-green-500",
  orange: "border-l-orange-500",
  default: "border-l-[hsl(var(--border))]",
};

const accentIcon: Record<string, string> = {
  blue: "text-primary",
  green: "text-green-600 dark:text-green-400",
  orange: "text-orange-600 dark:text-orange-400",
  default: "text-muted-foreground",
};

export default function EditableFlowNode({ data }: { data: FlowNodeData }) {
  const Icon = data.icon;
  const accent = data.accent || "default";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.message || "");
  const isEditable = !!data.messageKey && !!data.onMessageSave;

  const handleSave = () => {
    if (data.messageKey && data.onMessageSave) {
      data.onMessageSave(data.messageKey, draft);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(data.message || "");
    setEditing(false);
  };

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground/40 !w-2 !h-2" />
      <div
        className={`rounded-lg border border-border bg-card shadow-md border-l-4 ${accentBorder[accent]} ${data.wide ? "w-[340px]" : "w-[280px]"} cursor-default`}
      >
        <div className="p-3">
          <div className="flex items-start gap-2">
            <div className={`shrink-0 mt-0.5 ${accentIcon[accent]}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="font-semibold text-xs text-foreground leading-tight">{data.label}</h3>
                {data.edgeFunction && (
                  <span className="rounded bg-accent px-1 py-0.5 font-mono text-[9px] text-accent-foreground leading-none">
                    {data.edgeFunction}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{data.desc}</p>
            </div>
          </div>

          {data.details && data.details.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-muted-foreground pl-6">
              {data.details.map((d, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}

          {data.message && (
            <div className="mt-2 group relative">
              {data.botIdentity && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <img
                    src={data.botIdentity.avatarUrl}
                    alt={data.botIdentity.name}
                    className="h-4 w-4 rounded-sm"
                  />
                  <span className="text-[9px] font-semibold text-foreground">{data.botIdentity.name}</span>
                  <span className="rounded bg-muted px-1 py-px text-[8px] font-medium text-muted-foreground leading-none">APP</span>
                </div>
              )}
              {editing ? (
                <div className="space-y-1.5">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="font-mono text-[9px] leading-snug min-h-[60px] p-2 bg-muted/50 border-border resize-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.metaKey) handleSave();
                      if (e.key === "Escape") handleCancel();
                    }}
                  />
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={handleCancel}
                      className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted/80 flex items-center gap-0.5"
                    >
                      <X className="h-2.5 w-2.5" /> Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      className="rounded bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground hover:bg-primary/90 flex items-center gap-0.5"
                    >
                      <Check className="h-2.5 w-2.5" /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`rounded border border-border bg-muted/50 px-2 py-1.5 font-mono text-[9px] text-muted-foreground leading-snug ${isEditable ? "cursor-pointer hover:border-primary/50 hover:bg-muted/80 transition-colors" : ""}`}
                  onClick={isEditable ? () => setEditing(true) : undefined}
                >
                  {data.message}
                  {isEditable && (
                    <Pencil className="h-3 w-3 absolute top-1 right-1 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                  )}
                </div>
              )}
            </div>
          )}

          {(data.reactions || data.status) && (
            <div className="mt-2 flex items-center gap-2 text-[10px]">
              {data.reactions && (
                <span className="flex gap-0.5">
                  {data.reactions.map((r, i) => (
                    <span key={i} className="text-sm">{r}</span>
                  ))}
                </span>
              )}
              {data.status && (
                <span className="rounded bg-accent px-1 py-0.5 text-[9px] font-medium text-accent-foreground">
                  status → {data.status}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground/40 !w-2 !h-2" />
    </>
  );
}
