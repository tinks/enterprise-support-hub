import { useState, useEffect, useMemo, useRef, useCallback, Fragment, type ReactNode } from "react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ExternalLink, Hash, User, Mail, X, ArrowLeft, Bug, Filter, GripVertical, RotateCcw, Search, CalendarIcon, Ticket, ChevronRight, ChevronDown, Pencil, ChevronsUpDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { channelNameOverrides } from "@/lib/channelOverrides";
import { Calendar } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay } from "date-fns";

interface ConversationMapping {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  slack_user_id: string;
  intercom_conversation_id: string;
  intercom_ticket_id: string | null;
  status: string;
  created_at: string;
  is_test: boolean;
  original_message_text: string;
  product_area: string | null;
  is_bug: boolean;
  is_feature_request: boolean;
  owner: string | null;
  classification: string | null;
}

interface GmailConversation {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  snippet: string | null;
  is_test: boolean;
  created_at: string;
  status: string;
  resolved_at: string | null;
  product_area: string | null;
  is_bug: boolean;
  is_feature_request: boolean;
  intercom_conversation_id: string | null;
  owner: string | null;
  classification: string | null;
}

interface ManualConversation {
  id: string;
  source: string;
  contact_name: string;
  subject: string;
  link: string | null;
  status: string;
  is_bug: boolean;
  is_feature_request: boolean;
  is_test: boolean;
  product_area: string | null;
  created_at: string;
  intercom_conversation_id: string | null;
  owner: string | null;
  classification: string | null;
}

type SourceFilter = "all" | "slack" | "slack_import" | "gmail" | "manual";

type UnifiedRow =
  | { source: "slack"; data: ConversationMapping; sortDate: string; groupedEmails?: undefined; groupCount?: undefined }
  | { source: "gmail"; data: GmailConversation; sortDate: string; groupedEmails?: GmailConversation[]; groupCount?: number; groupKey?: string }
  | { source: "manual"; data: ManualConversation; sortDate: string; groupedEmails?: undefined; groupCount?: undefined };

const normalizeSubject = (subject: string | null): string => {
  if (!subject) return "";
  return subject.replace(/^(re:|fwd?:)\s*/gi, "").trim().toLowerCase();
};

type NameMap = Record<string, string>;

const statusColor = (status: string) => {
  switch (status) {
    case "active": return "default" as const;
    case "resolved": return "secondary" as const;
    case "escalated": return "destructive" as const;
    case "cancelled": return "outline" as const;
    case "awaiting_context": return "outline" as const;
    case "awaiting_support": return "outline" as const;
    default: return "outline" as const;
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "awaiting_context": return "Awaiting customer";
    case "awaiting_support": return "Awaiting support";
    default: return status.replace(/_/g, " ");
  }
};

const buildSlackLink = (channelId: string, threadTs: string) =>
  `https://lovable-dev.slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;

const getCET = (dateStr: string) => {
  const d = new Date(dateStr);
  return {
    day: d.toLocaleDateString("en-GB", { timeZone: "Europe/Berlin", weekday: "short" }),
    hour: parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false })),
  };
};

const CLASSIFICATION_OPTIONS = ["Issue", "Configuration", "Bug", "FR", "Question"] as const;
const STATUS_OPTIONS = ["active", "resolved", "cancelled", "escalated", "awaiting_context", "awaiting_support"] as const;

const ALL_COLUMNS = ["id", "source", "sent_by", "message", "channel", "link", "intercom", "status", "owner", "date", "test", "resolved", "product_area", "bug", "classification"] as const;
type ColKey = typeof ALL_COLUMNS[number];

type OwnerFilter = "all" | "Joel" | "Kristina" | "unassigned";
const OWNER_OPTIONS = ["Joel", "Kristina"] as const;

const COLUMN_STORAGE_KEY = "conv-column-order";

interface ConversationsProps {
  forceOwner?: string;
}

const Conversations = ({ forceOwner }: ConversationsProps = {}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramDay = searchParams.get("day");
  const paramHour = searchParams.get("hour") !== null ? parseInt(searchParams.get("hour")!) : null;
  const paramSource = searchParams.get("source") as SourceFilter | null;

  const [mappings, setMappings] = useState<ConversationMapping[]>([]);
  const [gmailRows, setGmailRows] = useState<GmailConversation[]>([]);
  const [manualRows, setManualRows] = useState<ManualConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [userNames, setUserNames] = useState<NameMap>({});
  const [channelNames, setChannelNames] = useState<NameMap>({});
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [gmailOffset, setGmailOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [hasMoreGmail, setHasMoreGmail] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const savedSource = localStorage.getItem("conv-source-filter") as SourceFilter | null;
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(paramSource || savedSource || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const savedOwner = localStorage.getItem("conv-owner-filter") as OwnerFilter | null;
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>(forceOwner as OwnerFilter || savedOwner || "all");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ slack: ConversationMapping[]; gmail: GmailConversation[]; manual: ManualConversation[] } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
   const [datePopoverOpen, setDatePopoverOpen] = useState(false);
   const [dateStep, setDateStep] = useState<"from" | "to">("from");
  const [creatingTicket, setCreatingTicket] = useState<Set<string>>(new Set());
  const [expandedGmailGroups, setExpandedGmailGroups] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleIdExpand = (id: string) => { setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const [editingIntercomId, setEditingIntercomId] = useState<string | null>(null);
  const [editingIntercomValue, setEditingIntercomValue] = useState("");

  const createIntercomTicket = async (e: React.MouseEvent, rowId: string, source: "slack" | "gmail" | "manual" = "slack") => {
    e.stopPropagation();
    setCreatingTicket((prev) => new Set(prev).add(rowId));
    try {
      const { data, error } = await supabase.functions.invoke("create-intercom-from-import", {
        body: { mappingId: rowId, source },
      });
      if (error) {
        toast.error("Failed to create Intercom ticket");
        return;
      }
      if (data?.intercomConversationId) {
        toast.success("Intercom ticket created");
        if (source === "slack") {
          setMappings((prev) => prev.map((m) => m.id === rowId ? { ...m, intercom_conversation_id: data.intercomConversationId, intercom_ticket_id: data.ticketId || null } : m));
          if (searchResults) {
            setSearchResults((prev) => prev ? { ...prev, slack: prev.slack.map((m) => m.id === rowId ? { ...m, intercom_conversation_id: data.intercomConversationId, intercom_ticket_id: data.ticketId || null } : m) } : prev);
          }
        } else if (source === "gmail") {
          const updater = (g: GmailConversation) => g.id === rowId ? { ...g, intercom_conversation_id: data.intercomConversationId } : g;
          setGmailRows((prev) => prev.map(updater));
          if (searchResults) setSearchResults((prev) => prev ? { ...prev, gmail: prev.gmail.map(updater) } : prev);
        } else {
          const updater = (mc: ManualConversation) => mc.id === rowId ? { ...mc, intercom_conversation_id: data.intercomConversationId } : mc;
          setManualRows((prev) => prev.map(updater));
          if (searchResults) setSearchResults((prev) => prev ? { ...prev, manual: prev.manual.map(updater) } : prev);
        }
      } else {
        toast.error(data?.error || "Failed to create ticket");
      }
    } catch {
      toast.error("Failed to create Intercom ticket");
    } finally {
      setCreatingTicket((prev) => { const next = new Set(prev); next.delete(rowId); return next; });
    }
  };

  const saveIntercomId = async (rowId: string, value: string, source: "slack" | "gmail" | "manual") => {
    const trimmed = value.trim() || null;
    const table = source === "slack" ? "conversation_mappings" : source === "gmail" ? "gmail_conversations" : "manual_conversations";
    const { error } = await supabase.from(table).update({ intercom_conversation_id: trimmed } as any).eq("id", rowId);
    if (error) { toast.error("Failed to save Intercom ID"); return; }
    toast.success("Intercom ID updated");
    if (source === "slack") {
      const updater = (m: ConversationMapping) => m.id === rowId ? { ...m, intercom_conversation_id: trimmed || "" } : m;
      setMappings((prev) => prev.map(updater));
      if (searchResults) setSearchResults((prev) => prev ? { ...prev, slack: prev.slack.map(updater) } : prev);
    } else if (source === "gmail") {
      const updater = (g: GmailConversation) => g.id === rowId ? { ...g, intercom_conversation_id: trimmed } : g;
      setGmailRows((prev) => prev.map(updater));
      if (searchResults) setSearchResults((prev) => prev ? { ...prev, gmail: prev.gmail.map(updater) } : prev);
    } else {
      const updater = (mc: ManualConversation) => mc.id === rowId ? { ...mc, intercom_conversation_id: trimmed } : mc;
      setManualRows((prev) => prev.map(updater));
      if (searchResults) setSearchResults((prev) => prev ? { ...prev, manual: prev.manual.map(updater) } : prev);
    }
    setEditingIntercomId(null);
  };

  const renderIntercomCell = (id: string, intercomId: string | null, source: "slack" | "gmail" | "manual", showCreateButton?: boolean, onCreateClick?: (e: React.MouseEvent) => void, isCreating?: boolean) => {
    if (editingIntercomId === id) {
      return (
        <Input
          autoFocus
          className="h-7 w-[140px] text-xs font-mono"
          value={editingIntercomValue}
          onChange={(e) => setEditingIntercomValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveIntercomId(id, editingIntercomValue, source);
            if (e.key === "Escape") setEditingIntercomId(null);
          }}
          onBlur={() => saveIntercomId(id, editingIntercomValue, source)}
          onClick={(e) => e.stopPropagation()}
        />
      );
    }
    const handleEditClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingIntercomId(id);
      setEditingIntercomValue(intercomId || "");
    };
    const editButton = (
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover/intercom:opacity-100 transition-opacity"
        onClick={handleEditClick}
        title="Edit Intercom ID"
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </Button>
    );
    if (intercomId) {
      return (
         <span className="group/intercom inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <a
            href={`https://app.intercom.com/a/apps/esqnv6i1/conversations/${intercomId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {intercomId} <ExternalLink className="h-3 w-3" />
          </a>
          {editButton}
        </span>
      );
    }
    if (showCreateButton && onCreateClick) {
      return (
         <span className="group/intercom inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={isCreating}
            onClick={onCreateClick}
          >
            <Ticket className="h-3 w-3" />
            {isCreating ? "Creating…" : "Create"}
          </Button>
          {editButton}
        </span>
      );
    }
    return (
      <span className="group/intercom inline-flex items-center gap-1 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
        —
        {editButton}
      </span>
    );
  };


  const ALL_STATUSES = ["active", "awaiting_context", "awaiting_support", "escalated", "resolved", "cancelled", "test"] as const;
  const DEFAULT_HIDDEN = new Set(["test", "cancelled", "resolved"]);
  const savedHidden = localStorage.getItem("conv-hidden-statuses");
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(
    savedHidden ? new Set(JSON.parse(savedHidden)) : new Set(DEFAULT_HIDDEN)
  );
  const hiddenDiffersFromDefault = hiddenStatuses.size !== DEFAULT_HIDDEN.size || [...hiddenStatuses].some(s => !DEFAULT_HIDDEN.has(s));

  // Column order state
  const savedColOrder = localStorage.getItem(COLUMN_STORAGE_KEY);
  const [columnOrder, setColumnOrder] = useState<ColKey[]>(() => {
    if (savedColOrder) {
      try {
        const parsed = JSON.parse(savedColOrder) as string[];
        // Validate: only keep known keys, append any missing ones
        const valid = parsed.filter((k): k is ColKey => (ALL_COLUMNS as readonly string[]).includes(k));
        const missing = ALL_COLUMNS.filter((k) => !valid.includes(k));
        return [...valid, ...missing];
      } catch { return [...ALL_COLUMNS]; }
    }
    return [...ALL_COLUMNS];
  });

  // Drag state
  const dragCol = useRef<ColKey | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColKey | null>(null);

  useEffect(() => { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnOrder)); }, [columnOrder]);
  useEffect(() => { localStorage.setItem("conv-source-filter", sourceFilter); }, [sourceFilter]);
  useEffect(() => { if (!forceOwner) localStorage.setItem("conv-owner-filter", ownerFilter); }, [ownerFilter, forceOwner]);
  useEffect(() => { localStorage.setItem("conv-hidden-statuses", JSON.stringify([...hiddenStatuses])); }, [hiddenStatuses]);

  const handleDragStart = useCallback((col: ColKey) => { dragCol.current = col; }, []);
  const handleDragOver = useCallback((e: React.DragEvent, col: ColKey) => {
    e.preventDefault();
    setDragOverCol(col);
  }, []);
  const handleDrop = useCallback((col: ColKey) => {
    const from = dragCol.current;
    if (!from || from === col) { setDragOverCol(null); dragCol.current = null; return; }
    setColumnOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(from);
      const toIdx = next.indexOf(col);
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      return next;
    });
    setDragOverCol(null);
    dragCol.current = null;
  }, []);
  const handleDragEnd = useCallback(() => { setDragOverCol(null); dragCol.current = null; }, []);
  const resetColumns = useCallback(() => { setColumnOrder([...ALL_COLUMNS]); }, []);

  const toggleHidden = (status: string) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const toggleMessage = (id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateStatus = async (id: string, newStatus: string, source: "slack" | "gmail" | "manual") => {
    const table = source === "slack" ? "conversation_mappings" : source === "gmail" ? "gmail_conversations" : "manual_conversations";
    const setState = source === "slack" ? setMappings : source === "gmail" ? setGmailRows : setManualRows;
    const resolvedAt = newStatus === "resolved" ? new Date().toISOString() : null;

    setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, status: newStatus, ...(resolvedAt !== undefined ? { resolved_at: resolvedAt } : {}) } : m));
    if (searchResults) {
      setSearchResults((prev: any) => prev ? prev.map((m: any) => m.id === id ? { ...m, status: newStatus } : m) : prev);
    }
    const { error } = await supabase.from(table).update({ status: newStatus, resolved_at: resolvedAt } as any).eq("id", id);
    if (error) {
      toast.error("Failed to update status");
      loadData();
    }
  };

  const toggleTest = async (id: string, currentValue: boolean, source: "slack" | "gmail") => {
    const newValue = !currentValue;
    if (source === "slack") {
      setMappings((prev) => prev.map((m) => m.id === id ? { ...m, is_test: newValue } : m));
      const { error } = await supabase.from("conversation_mappings").update({ is_test: newValue }).eq("id", id);
      if (error) {
        setMappings((prev) => prev.map((m) => m.id === id ? { ...m, is_test: currentValue } : m));
        toast.error("Failed to update test flag");
      }
    } else {
      setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, is_test: newValue } : m));
      const { error } = await supabase.from("gmail_conversations").update({ is_test: newValue }).eq("id", id);
      if (error) {
        setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, is_test: currentValue } : m));
        toast.error("Failed to update test flag");
      }
    }
  };

  const toggleResolved = async (id: string, currentStatus: string, source: "slack" | "gmail") => {
    const isResolved = currentStatus === "resolved";
    const newStatus = isResolved ? (source === "slack" ? "active" : "open") : "resolved";
    const resolvedAt = isResolved ? null : new Date().toISOString();

    if (source === "slack") {
      setMappings((prev) => prev.map((m) => m.id === id ? { ...m, status: newStatus, resolved_at: resolvedAt } as ConversationMapping : m));
      const { error } = await supabase.from("conversation_mappings").update({ status: newStatus, resolved_at: resolvedAt }).eq("id", id);
      if (error) {
        setMappings((prev) => prev.map((m) => m.id === id ? { ...m, status: currentStatus } : m));
        toast.error("Failed to update resolved status");
      }
    } else {
      setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, status: newStatus, resolved_at: resolvedAt } : m));
      const { error } = await supabase.from("gmail_conversations").update({ status: newStatus, resolved_at: resolvedAt }).eq("id", id);
      if (error) {
        setGmailRows((prev) => prev.map((m) => m.id === id ? { ...m, status: currentStatus } : m));
        toast.error("Failed to update resolved status");
      }
    }
  };

  const [productAreas, setProductAreas] = useState<string[]>(["SSO", "SCIM", "Credits", "Account access", "Remix/transfer", "Cloud/AI"]);

  const updateProductArea = async (id: string, value: string, source: "slack" | "gmail") => {
    const newValue = value === "clear" ? null : value;
    const table = source === "slack" ? "conversation_mappings" : "gmail_conversations";
    const setState = source === "slack" ? setMappings : setGmailRows;

    setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, product_area: newValue } : m));
    const { error } = await supabase.from(table).update({ product_area: newValue } as any).eq("id", id);
    if (error) {
      setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, product_area: value === "clear" ? value : null } : m));
      toast.error("Failed to update product area");
    }
  };

  const updateOwner = async (id: string, value: string, source: "slack" | "gmail" | "manual") => {
    const newValue = value === "clear" ? null : value;
    const table = source === "slack" ? "conversation_mappings" : source === "gmail" ? "gmail_conversations" : "manual_conversations";
    if (source === "slack") {
      setMappings((prev) => prev.map((m) => m.id === id ? { ...m, owner: newValue } : m));
    } else if (source === "gmail") {
      setGmailRows((prev) => prev.map((g) => g.id === id ? { ...g, owner: newValue } : g));
    } else {
      setManualRows((prev) => prev.map((mc) => mc.id === id ? { ...mc, owner: newValue } : mc));
    }
    const { error } = await supabase.from(table).update({ owner: newValue } as any).eq("id", id);
    if (error) toast.error("Failed to update owner");
  };

  const toggleBug = async (id: string, currentValue: boolean, source: "slack" | "gmail") => {
    const newValue = !currentValue;
    const table = source === "slack" ? "conversation_mappings" : "gmail_conversations";
    const setState = source === "slack" ? setMappings : setGmailRows;

    setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, is_bug: newValue } : m));
    const { error } = await supabase.from(table).update({ is_bug: newValue } as any).eq("id", id);
    if (error) {
      setState((prev: any[]) => prev.map((m: any) => m.id === id ? { ...m, is_bug: currentValue } : m));
      toast.error("Failed to update bug flag");
    }
  };


  const updateClassification = async (id: string, value: string, source: "slack" | "gmail" | "manual") => {
    const newValue = value === "clear" ? null : value;
    const table = source === "slack" ? "conversation_mappings" : source === "gmail" ? "gmail_conversations" : "manual_conversations";
    if (source === "slack") {
      setMappings((prev) => prev.map((m) => m.id === id ? { ...m, classification: newValue } : m));
    } else if (source === "gmail") {
      setGmailRows((prev) => prev.map((g) => g.id === id ? { ...g, classification: newValue } : g));
    } else {
      setManualRows((prev) => prev.map((mc) => mc.id === id ? { ...mc, classification: newValue } : mc));
    }
    const { error } = await supabase.from(table).update({ classification: newValue } as any).eq("id", id);
    if (error) toast.error("Failed to update classification");
  };

  const loadLookups = async (rows: ConversationMapping[]) => {
    const usersRes = await supabase.functions.invoke("list-slack-users");
    if (usersRes.data?.users) {
      const map: NameMap = {};
      for (const u of usersRes.data.users) {
        map[u.id] = u.display_name || u.real_name || u.name;
      }
      setUserNames(map);
    }

    const uniqueChannelIds = [...new Set(rows.map((r) => r.slack_channel_id))];
    const channelsRes = await supabase.functions.invoke("list-slack-channels", {
      body: { channelIds: uniqueChannelIds },
    });
    if (channelsRes.data?.channels) {
      const map: NameMap = {};
      for (const c of channelsRes.data.channels) {
        if (uniqueChannelIds.includes(c.id)) {
          map[c.id] = c.name;
        }
      }
      for (const channelId of uniqueChannelIds) {
        if (!map[channelId] && channelNameOverrides[channelId]) {
          map[channelId] = channelNameOverrides[channelId];
        }
      }
      setChannelNames(map);
    }
  };

  const isHeatmapMode = paramDay !== null && paramHour !== null;

  const loadData = async (append = false) => {
    const currentOffset = append ? offset : 0;
    const currentGmailOffset = append ? gmailOffset : 0;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setOffset(0);
      setGmailOffset(0);
    }

    const pageSize = isHeatmapMode ? 1000 : 50;

    let slackQuery = supabase
      .from("conversation_mappings")
      .select("*")
      .order("created_at", { ascending: false });
    let gmailQuery = supabase
      .from("gmail_conversations")
      .select("*")
      .order("received_at", { ascending: false });
    let manualQuery = supabase
      .from("manual_conversations")
      .select("*")
      .order("created_at", { ascending: false });

    if (dateFrom) {
      const fromIso = startOfDay(dateFrom).toISOString();
      slackQuery = slackQuery.gte("created_at", fromIso);
      gmailQuery = gmailQuery.gte("received_at", fromIso);
      manualQuery = manualQuery.gte("created_at", fromIso);
    }
    if (dateTo) {
      const toIso = endOfDay(dateTo).toISOString();
      slackQuery = slackQuery.lte("created_at", toIso);
      gmailQuery = gmailQuery.lte("received_at", toIso);
      manualQuery = manualQuery.lte("created_at", toIso);
    }

    const [slackRes, gmailRes, manualRes] = await Promise.all([
      slackQuery.range(currentOffset, currentOffset + pageSize - 1),
      gmailQuery.range(currentGmailOffset, currentGmailOffset + pageSize - 1),
      manualQuery.limit(pageSize),
    ]);

    const slackRows = (slackRes.data ?? []) as unknown as ConversationMapping[];
    const gmailData = (gmailRes.data ?? []) as unknown as GmailConversation[];
    const manualData = (manualRes.data ?? []) as unknown as ManualConversation[];

    setHasMore(slackRows.length === pageSize);
    setHasMoreGmail(gmailData.length === pageSize);

    if (append) {
      setMappings((prev) => [...prev, ...slackRows]);
      setGmailRows((prev) => [...prev, ...gmailData]);
      setManualRows(manualData);
      setOffset(currentOffset + pageSize);
      setGmailOffset(currentGmailOffset + pageSize);
      setLoadingMore(false);
    } else {
      setMappings(slackRows);
      setGmailRows(gmailData);
      setManualRows(manualData);
      setOffset(pageSize);
      setGmailOffset(pageSize);
      setLoading(false);
    }
    return slackRows;
  };

  useEffect(() => {
    loadData().then((rows) => loadLookups(rows));
    supabase.from("settings").select("product_areas").limit(1).single().then(({ data }) => {
      if (data?.product_areas) {
        setProductAreas(data.product_areas.split(",").map((s: string) => s.trim()).filter(Boolean));
      }
    });
  }, []);

  // Reload data when date filters change
  useEffect(() => {
    loadData().then((rows) => loadLookups(rows));
  }, [dateFrom, dateTo]);

  // Debounce search query
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) {
      setDebouncedSearch("");
      setSearchResults(null);
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Server-side search
  useEffect(() => {
    if (!debouncedSearch) { setSearchResults(null); return; }
    const q = debouncedSearch;
    const ilike = `%${q}%`;
    setSearchLoading(true);

    const doSearch = async () => {
      const isUuid = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(q);

      const [slackRes, gmailRes, manualRes] = await Promise.all([
        (sourceFilter === "all" || sourceFilter === "slack" || sourceFilter === "slack_import")
          ? supabase
              .from("conversation_mappings")
              .select("*")
              .or(
                isUuid
                  ? `id.eq.${q},original_message_text.ilike.${ilike},status.ilike.${ilike},product_area.ilike.${ilike},slack_user_id.ilike.${ilike},slack_channel_id.ilike.${ilike},intercom_conversation_id.ilike.${ilike}`
                  : `original_message_text.ilike.${ilike},status.ilike.${ilike},product_area.ilike.${ilike},slack_user_id.ilike.${ilike},slack_channel_id.ilike.${ilike},intercom_conversation_id.ilike.${ilike}`
              )
              .order("created_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [] }),
        (sourceFilter === "all" || sourceFilter === "gmail")
          ? supabase
              .from("gmail_conversations")
              .select("*")
              .or(
                isUuid
                  ? `id.eq.${q},from_email.ilike.${ilike},from_name.ilike.${ilike},subject.ilike.${ilike},snippet.ilike.${ilike},status.ilike.${ilike},product_area.ilike.${ilike}`
                  : `from_email.ilike.${ilike},from_name.ilike.${ilike},subject.ilike.${ilike},snippet.ilike.${ilike},status.ilike.${ilike},product_area.ilike.${ilike}`
              )
              .order("received_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [] }),
        (sourceFilter === "all" || sourceFilter === "manual")
          ? supabase
              .from("manual_conversations")
              .select("*")
              .or(
                isUuid
                  ? `id.eq.${q},contact_name.ilike.${ilike},subject.ilike.${ilike},source.ilike.${ilike},status.ilike.${ilike},product_area.ilike.${ilike}`
                  : `contact_name.ilike.${ilike},subject.ilike.${ilike},source.ilike.${ilike},status.ilike.${ilike},product_area.ilike.${ilike}`
              )
              .order("created_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [] }),
      ]);

      setSearchResults({
        slack: (slackRes.data ?? []) as unknown as ConversationMapping[],
        gmail: (gmailRes.data ?? []) as unknown as GmailConversation[],
        manual: (manualRes.data ?? []) as unknown as ManualConversation[],
      });
      setSearchLoading(false);
    };
    doSearch();
  }, [debouncedSearch, sourceFilter]);

  const unified = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [];

    // Use server-side search results when a search is active
    const slackData = searchResults ? searchResults.slack : mappings;
    const gmailData = searchResults ? searchResults.gmail : gmailRows;
    const manualData = searchResults ? searchResults.manual : manualRows;

    if (sourceFilter === "all" || sourceFilter === "slack" || sourceFilter === "slack_import") {
      for (const m of slackData) {
        const isImported = !m.intercom_conversation_id;
        if (sourceFilter === "slack_import" && !isImported) continue;
        if (sourceFilter === "slack" && isImported) continue;
        rows.push({ source: "slack", data: m, sortDate: m.created_at });
      }
    }
    if (sourceFilter === "all" || sourceFilter === "gmail") {
      // Group Gmail rows by thread_id or normalized subject
      const gmailGroups: Record<string, GmailConversation[]> = {};
      for (const g of gmailData) {
        const key = g.gmail_thread_id || normalizeSubject(g.subject) || g.id;
        if (!gmailGroups[key]) gmailGroups[key] = [];
        gmailGroups[key].push(g);
      }
      for (const [key, group] of Object.entries(gmailGroups)) {
        // Sort group by date descending, use most recent as primary
        group.sort((a, b) => new Date(b.received_at || b.created_at).getTime() - new Date(a.received_at || a.created_at).getTime());
        const primary = group[0];
        rows.push({
          source: "gmail",
          data: primary,
          sortDate: primary.received_at || primary.created_at,
          groupedEmails: group.length > 1 ? group : undefined,
          groupCount: group.length > 1 ? group.length : undefined,
          groupKey: key,
        });
      }
    }
    if (sourceFilter === "all" || sourceFilter === "manual") {
      for (const mc of manualData) {
        rows.push({ source: "manual", data: mc, sortDate: mc.created_at });
      }
    }

    rows.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());

    // Apply heatmap filter from query params
    if (paramDay !== null && paramHour !== null) {
      return rows.filter((r) => {
        const { day, hour } = getCET(r.sortDate);
        return day === paramDay && hour === paramHour;
      });
    }

    // Apply owner filter
    const ownerFiltered = ownerFilter === "all"
      ? rows
      : rows.filter((r) => {
          const o = (r.data as any).owner as string | null;
          if (ownerFilter === "unassigned") return !o;
          return o === ownerFilter;
        });

    // Apply status filter (skip when searching — show all matches)
    if (!searchResults) {
      const filtered = hiddenStatuses.size > 0
        ? ownerFiltered.filter((r) => {
            if (hiddenStatuses.has("test") && r.data.is_test) return false;
            if (hiddenStatuses.has(r.data.status)) return false;
            return true;
          })
        : ownerFiltered;
      return filtered;
    }

    return ownerFiltered;
  }, [mappings, gmailRows, manualRows, searchResults, sourceFilter, paramDay, paramHour, hiddenStatuses, ownerFilter]);

  const canLoadMore =
    !isHeatmapMode && !searchResults && (
      ((sourceFilter === "all" || sourceFilter === "slack" || sourceFilter === "slack_import") && hasMore) ||
      ((sourceFilter === "all" || sourceFilter === "gmail") && hasMoreGmail)
    );

  // Column definitions
  const columnHeaders: Record<ColKey, string> = {
    id: "ID",
    source: "Source",
    sent_by: "Sent by",
    message: "Message / Subject",
    channel: "Channel",
    link: "Link",
    intercom: "Intercom",
    status: "Status",
    owner: "Owner",
    date: "Date",
    test: "Test",
    resolved: "Resolved",
    product_area: "Product area",
    bug: "Incident",
    classification: "Classification",
  };

  const renderSlackCell = (col: ColKey, m: ConversationMapping): ReactNode => {
    switch (col) {
      case "id": return <span className="text-xs text-muted-foreground font-mono cursor-pointer" onClick={(e) => { e.stopPropagation(); toggleIdExpand(m.id); }}>{expandedIds.has(m.id) ? m.id.slice(0, 8) : m.id.slice(0, 3)}</span>;
      case "source": return m.intercom_conversation_id
        ? <Badge variant="outline" className="text-xs">Slack bot</Badge>
        : <Badge variant="secondary" className="text-xs">Slack import</Badge>;
      case "sent_by": return (
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          {userNames[m.slack_user_id] || m.slack_user_id || "—"}
        </span>
      );
      case "message": return m.original_message_text ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleMessage(m.id); }}
          className="text-left text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {expandedMessages.has(m.id)
            ? m.original_message_text
            : m.original_message_text.length > 60
              ? m.original_message_text.slice(0, 60) + "…"
              : m.original_message_text}
        </button>
      ) : <span className="text-xs text-muted-foreground">—</span>;
      case "channel": return (
        <span className="inline-flex items-center gap-1 text-sm text-foreground">
          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          {channelNames[m.slack_channel_id] || channelNameOverrides[m.slack_channel_id] || (m.slack_channel_id.startsWith("D") ? "Direct message" : m.slack_channel_id)}
        </span>
      );
      case "link": return (
        <a
          href={buildSlackLink(m.slack_channel_id, m.slack_thread_ts)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          Thread <ExternalLink className="h-3 w-3" />
        </a>
      );
      case "intercom": return renderIntercomCell(m.id, m.intercom_conversation_id, "slack", true, (e) => createIntercomTicket(e, m.id, "slack"), creatingTicket.has(m.id));
      case "status": return (
        <Select value={m.status} onValueChange={(v) => updateStatus(m.id, v, "slack")}>
          <SelectTrigger className="h-8 w-[150px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue>{statusLabel(m.status)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      case "date": return <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</span>;
      case "test": return (
        <Switch
          checked={m.is_test}
          onCheckedChange={() => toggleTest(m.id, m.is_test, "slack")}
          aria-label="Toggle test"
          onClick={(e) => e.stopPropagation()}
        />
      );
      case "resolved": return (
        <Switch
          checked={m.status === "resolved"}
          onCheckedChange={() => toggleResolved(m.id, m.status, "slack")}
          aria-label="Toggle resolved"
          onClick={(e) => e.stopPropagation()}
        />
      );
      case "product_area": return (
        <Select value={m.product_area || ""} onValueChange={(v) => updateProductArea(m.id, v, "slack")}>
          <SelectTrigger className="h-8 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {productAreas.map((area) => (
              <SelectItem key={area} value={area}>{area}</SelectItem>
            ))}
            {m.product_area && (
              <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>
            )}
          </SelectContent>
        </Select>
      );
      case "owner": return (
        <Select value={m.owner || ""} onValueChange={(v) => updateOwner(m.id, v, "slack")}>
          <SelectTrigger className="h-8 w-[110px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {OWNER_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            {m.owner && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
          </SelectContent>
        </Select>
      );
      case "bug": return (
        <Switch
          checked={m.is_bug}
          onCheckedChange={() => toggleBug(m.id, m.is_bug, "slack")}
          aria-label="Toggle bug"
          onClick={(e) => e.stopPropagation()}
        />
      );
      case "classification": return (
        <Select value={m.classification || ""} onValueChange={(v) => updateClassification(m.id, v, "slack")}>
          <SelectTrigger className="h-8 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATION_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
            {m.classification && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
          </SelectContent>
        </Select>
      );
    }
  };

  const renderGmailCell = (col: ColKey, g: GmailConversation, groupCount?: number, groupedEmails?: GmailConversation[], groupKey?: string): ReactNode => {
    switch (col) {
      case "id": return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-mono">
          {groupCount && groupCount > 1 && groupKey && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpandedGmailGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(groupKey)) next.delete(groupKey);
                  else next.add(groupKey);
                  return next;
                });
              }}
              className="hover:text-foreground transition-colors"
            >
              {expandedGmailGroups.has(groupKey) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
          <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); toggleIdExpand(g.id); }}>{expandedIds.has(g.id) ? g.id.slice(0, 8) : g.id.slice(0, 3)}</span>
          {groupCount && groupCount > 1 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{groupCount}</Badge>
          )}
        </span>
      );
      case "source": return <Badge variant="secondary" className="text-xs"><Mail className="mr-1 h-3 w-3" />Gmail</Badge>;
      case "sent_by": {
        if (groupedEmails && groupedEmails.length > 1) {
          const uniqueSenders = [...new Set(groupedEmails.map((e) => e.from_name || e.from_email || "—").filter(Boolean))];
          const display = uniqueSenders[0] + (uniqueSenders.length > 1 ? ` + ${uniqueSenders.length - 1} other${uniqueSenders.length > 2 ? "s" : ""}` : "");
          return (
            <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              {display}
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            {g.from_name || g.from_email || "—"}
          </span>
        );
      }
      case "message": return g.subject ? (
        <button
          onClick={() => toggleMessage(g.id)}
          className="text-left text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {expandedMessages.has(g.id)
            ? `${g.subject}\n${g.snippet || ""}`
            : g.subject.length > 60
              ? g.subject.slice(0, 60) + "…"
              : g.subject}
        </button>
      ) : <span className="text-xs text-muted-foreground">—</span>;
      case "channel": return <span className="text-xs text-muted-foreground">Gmail inbox</span>;
      case "link": return g.gmail_thread_id ? (
        <a
          href={`https://mail.google.com/mail/u/0/#inbox/${g.gmail_thread_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
        >
          Email <ExternalLink className="h-3 w-3" />
        </a>
      ) : <span className="text-xs text-muted-foreground">—</span>;
      case "intercom": return renderIntercomCell(g.id, g.intercom_conversation_id, "gmail", true, (e) => createIntercomTicket(e, g.id, "gmail"), creatingTicket.has(g.id));
      case "status": return (
        <Select value={g.status || "open"} onValueChange={(v) => updateStatus(g.id, v, "gmail")}>
          <SelectTrigger className="h-8 w-[150px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue>{statusLabel(g.status || "open")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      case "date": return <span className="text-xs text-muted-foreground">{g.received_at ? new Date(g.received_at).toLocaleString() : new Date(g.created_at).toLocaleString()}</span>;
      case "test": return (
        <Switch
          checked={g.is_test}
          onCheckedChange={() => toggleTest(g.id, g.is_test, "gmail")}
          aria-label="Toggle test"
        />
      );
      case "resolved": return (
        <Switch
          checked={g.status === "resolved"}
          onCheckedChange={() => toggleResolved(g.id, g.status, "gmail")}
          aria-label="Toggle resolved"
        />
      );
      case "product_area": return (
        <Select value={g.product_area || ""} onValueChange={(v) => updateProductArea(g.id, v, "gmail")}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {productAreas.map((area) => (
              <SelectItem key={area} value={area}>{area}</SelectItem>
            ))}
            {g.product_area && (
              <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>
            )}
          </SelectContent>
        </Select>
      );
      case "owner": return (
        <Select value={g.owner || ""} onValueChange={(v) => updateOwner(g.id, v, "gmail")}>
          <SelectTrigger className="h-8 w-[110px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {OWNER_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            {g.owner && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
          </SelectContent>
        </Select>
      );
      case "bug": return (
        <Switch
          checked={g.is_bug}
          onCheckedChange={() => toggleBug(g.id, g.is_bug, "gmail")}
          aria-label="Toggle bug"
        />
      );
      case "classification": return (
        <Select value={g.classification || ""} onValueChange={(v) => updateClassification(g.id, v, "gmail")}>
          <SelectTrigger className="h-8 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATION_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            {g.classification && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
          </SelectContent>
        </Select>
      );
    }
  };

  const renderManualCell = (col: ColKey, mc: ManualConversation): ReactNode => {
    switch (col) {
      case "id": return <span className="text-xs text-muted-foreground font-mono cursor-pointer" onClick={(e) => { e.stopPropagation(); toggleIdExpand(mc.id); }}>{expandedIds.has(mc.id) ? mc.id.slice(0, 8) : mc.id.slice(0, 3)}</span>;
      case "source": return mc.source === "intercom"
        ? <Badge variant="default" className="text-xs">Intercom import</Badge>
        : <Badge variant="outline" className="text-xs capitalize">{mc.source}</Badge>;
      case "sent_by": return (
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          {mc.contact_name || "—"}
        </span>
      );
      case "message": return mc.subject ? (
        <span className="text-xs text-muted-foreground">{mc.subject.length > 60 ? mc.subject.slice(0, 60) + "…" : mc.subject}</span>
      ) : <span className="text-xs text-muted-foreground">—</span>;
      case "channel": return <span className="text-xs text-muted-foreground capitalize">{mc.source}</span>;
      case "link": return mc.link ? (
        <a
          href={mc.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          Link <ExternalLink className="h-3 w-3" />
        </a>
      ) : <span className="text-xs text-muted-foreground">—</span>;
      case "intercom": return renderIntercomCell(mc.id, mc.intercom_conversation_id, "manual", true, (e) => createIntercomTicket(e, mc.id, "manual"), creatingTicket.has(mc.id));
      case "status": return (
        <Select value={mc.status} onValueChange={(v) => updateStatus(mc.id, v, "manual")}>
          <SelectTrigger className="h-8 w-[150px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue>{statusLabel(mc.status)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      case "date": return <span className="text-xs text-muted-foreground">{new Date(mc.created_at).toLocaleString()}</span>;
      case "test": return (
        <Switch
          checked={mc.is_test}
          onCheckedChange={async () => {
            const newVal = !mc.is_test;
            setManualRows((prev) => prev.map((r) => r.id === mc.id ? { ...r, is_test: newVal } : r));
            const { error } = await supabase.from("manual_conversations").update({ is_test: newVal }).eq("id", mc.id);
            if (error) {
              setManualRows((prev) => prev.map((r) => r.id === mc.id ? { ...r, is_test: mc.is_test } : r));
              toast.error("Failed to update test flag");
            }
          }}
          aria-label="Toggle test"
          onClick={(e) => e.stopPropagation()}
        />
      );
      case "resolved": return (
        <Switch
          checked={mc.status === "resolved"}
          onCheckedChange={async () => {
            const newStatus = mc.status === "resolved" ? "active" : "resolved";
            setManualRows((prev) => prev.map((r) => r.id === mc.id ? { ...r, status: newStatus } : r));
            const { error } = await supabase.from("manual_conversations").update({ status: newStatus }).eq("id", mc.id);
            if (error) {
              setManualRows((prev) => prev.map((r) => r.id === mc.id ? { ...r, status: mc.status } : r));
              toast.error("Failed to update status");
            }
          }}
          aria-label="Toggle resolved"
          onClick={(e) => e.stopPropagation()}
        />
      );
      case "product_area": return (
        <Select
          value={mc.product_area || ""}
          onValueChange={async (v) => {
            const newVal = v === "clear" ? null : v;
            setManualRows((prev) => prev.map((r) => r.id === mc.id ? { ...r, product_area: newVal } : r));
            const { error } = await supabase.from("manual_conversations").update({ product_area: newVal }).eq("id", mc.id);
            if (error) toast.error("Failed to update product area");
          }}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {productAreas.map((area) => (
              <SelectItem key={area} value={area}>{area}</SelectItem>
            ))}
            {mc.product_area && (
              <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>
            )}
          </SelectContent>
        </Select>
      );
      case "bug": return (
        <Switch
          checked={mc.is_bug}
          onCheckedChange={async () => {
            const newVal = !mc.is_bug;
            setManualRows((prev) => prev.map((r) => r.id === mc.id ? { ...r, is_bug: newVal } : r));
            const { error } = await supabase.from("manual_conversations").update({ is_bug: newVal }).eq("id", mc.id);
            if (error) {
              setManualRows((prev) => prev.map((r) => r.id === mc.id ? { ...r, is_bug: mc.is_bug } : r));
              toast.error("Failed to update bug flag");
            }
          }}
          aria-label="Toggle bug"
          onClick={(e) => e.stopPropagation()}
        />
      );
      case "owner": return (
        <Select value={mc.owner || ""} onValueChange={(v) => updateOwner(mc.id, v, "manual")}>
          <SelectTrigger className="h-8 w-[110px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {OWNER_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            {mc.owner && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
          </SelectContent>
        </Select>
      );
      case "classification": return (
        <Select value={mc.classification || ""} onValueChange={(v) => updateClassification(mc.id, v, "manual")}>
          <SelectTrigger className="h-8 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATION_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            {mc.classification && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
          </SelectContent>
        </Select>
      );
    }
  };

  const isCustomOrder = JSON.stringify(columnOrder) !== JSON.stringify([...ALL_COLUMNS]);
  const anyFilterActive = sourceFilter !== "all" || ownerFilter !== "all" || hiddenDiffersFromDefault || !!dateFrom || !!dateTo || isCustomOrder;
  const resetAll = () => {
    setSourceFilter("all");
    setOwnerFilter("all");
    setHiddenStatuses(new Set(DEFAULT_HIDDEN));
    setDateFrom(undefined);
    setDateTo(undefined);
    setColumnOrder([...ALL_COLUMNS]);
  };

  return (
    <AppLayout>
      <div className="h-full min-h-0 flex flex-col bg-background p-6">
        <div className="mx-auto max-w-7xl w-full min-h-0 flex flex-col flex-1">
          <div className="flex flex-col flex-1 min-h-0">
          {paramDay !== null && paramHour !== null && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
              <span className="text-foreground">
                Showing activity for <strong>{paramDay} {String(paramHour).padStart(2, "0")}:00–{String(paramHour).padStart(2, "0")}:59 CET</strong>
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => navigate("/")}
                >
                  <ArrowLeft className="mr-1 h-3 w-3" /> Back to stats
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setSearchParams({})}
                >
                  <X className="mr-1 h-3 w-3" /> Clear filter
                </Button>
              </div>
            </div>
          )}
          <Card className="min-h-0 flex-1 flex flex-col">
            <CardHeader className="flex-shrink-0 pb-2">
              <CardTitle className="text-lg">{forceOwner ? `${forceOwner}'s conversations` : "\n"}</CardTitle>
            </CardHeader>
            {/* Filters section — collapsible, on top */}
            <Collapsible defaultOpen className="border-t border-border">
              <CollapsibleTrigger className="flex w-full items-center justify-between px-6 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors cursor-pointer">
                <span className="flex items-center gap-2">
                  Filters
                  {(() => {
                    let count = 0;
                    if (sourceFilter !== "all") count++;
                    if (ownerFilter !== "all") count++;
                    if (hiddenDiffersFromDefault) count++;
                    if (dateFrom || dateTo) count++;
                    return count > 0 ? (
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs">{count} active</Badge>
                    ) : null;
                  })()}
                </span>
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
                  <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
                    <SelectTrigger className="w-[130px] h-9">
                      <SelectValue placeholder="Source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Source</SelectItem>
                      <SelectItem value="slack">Slack bot</SelectItem>
                      <SelectItem value="slack_import">Slack import</SelectItem>
                      <SelectItem value="gmail">Gmail only</SelectItem>
                      <SelectItem value="manual">Manual only</SelectItem>
                    </SelectContent>
                  </Select>
                  {!forceOwner && (
                  <Select value={ownerFilter} onValueChange={(v) => setOwnerFilter(v as OwnerFilter)}>
                    <SelectTrigger className="w-[120px] h-9">
                      <SelectValue placeholder="Owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Owner</SelectItem>
                      <SelectItem value="Joel">Joel</SelectItem>
                      <SelectItem value="Kristina">Kristina</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                    </SelectContent>
                  </Select>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 gap-1">
                        <Filter className="h-3 w-3" />
                        Status
                        {hiddenDiffersFromDefault && (
                          <Badge variant="secondary" className="ml-1 h-5 px-1 text-xs">
                            {hiddenStatuses.size} hidden
                          </Badge>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-3" align="end">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">Hide statuses</p>
                      <div className="flex flex-col gap-2">
                        {ALL_STATUSES.map((s) => (
                          <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={hiddenStatuses.has(s)}
                              onCheckedChange={() => toggleHidden(s)}
                            />
                            <span className="capitalize">{statusLabel(s)}</span>
                          </label>
                        ))}
                      </div>
                      {hiddenDiffersFromDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 w-full text-xs"
                          onClick={() => setHiddenStatuses(new Set(DEFAULT_HIDDEN))}
                        >
                          Restore defaults
                        </Button>
                      )}
                    </PopoverContent>
                  </Popover>
                  <Popover open={datePopoverOpen} onOpenChange={(open) => {
                    setDatePopoverOpen(open);
                    if (!open) setDateStep("from");
                  }}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={`h-9 gap-1 ${(dateFrom || dateTo) ? "border-primary" : ""}`}>
                        <CalendarIcon className="h-3 w-3" />
                        {dateFrom && dateTo
                          ? `${format(dateFrom, "dd MMM")} – ${format(dateTo, "dd MMM")}`
                          : dateFrom
                            ? `${format(dateFrom, "dd MMM")} –`
                            : "Date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <div className="px-3 pt-3 pb-1 text-xs text-muted-foreground font-medium">
                        {dateStep === "from" ? "Select start date" : "Select end date"}
                      </div>
                      <Calendar
                        mode="single"
                        selected={dateStep === "from" ? dateFrom : dateTo}
                        onSelect={(day) => {
                          if (dateStep === "from") {
                            setDateFrom(day);
                            setDateTo(undefined);
                            setDateStep("to");
                          } else {
                            if (day && dateFrom && day < dateFrom) {
                              setDateTo(dateFrom);
                              setDateFrom(day);
                            } else {
                              setDateTo(day);
                            }
                            setDatePopoverOpen(false);
                            setDateStep("from");
                          }
                        }}
                        modifiers={dateFrom && dateTo ? { range: { after: dateFrom, before: dateTo } } : {}}
                        modifiersStyles={{ range: { backgroundColor: "hsl(var(--accent))", borderRadius: 0 } }}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                  {(dateFrom || dateTo) && (
                    <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                  {anyFilterActive && (
                    <Button variant="ghost" size="sm" className="h-9 gap-1 text-xs" onClick={resetAll}>
                      <RotateCcw className="h-3 w-3" /> Reset
                    </Button>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Search & Refresh bar — always visible */}
            <div className="border-t border-border px-6 py-3 flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-[50vw] max-w-[600px] pl-8 text-sm"
                />
              </div>
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => { loadData().then((rows) => loadLookups(rows)); }} disabled={loading}>
                <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
            <CardContent className="min-h-0 flex-1 flex flex-col overflow-hidden p-0 px-6 pb-6">
              {unified.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No conversations found."}
                </p>
              ) : (
              <div className="min-h-0 flex-1 overflow-auto pl-1">
                <Table>
                  <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-b">
                    <TableRow>
                      {columnOrder.map((col) => (
                        <TableHead
                          key={col}
                          draggable
                          onDragStart={() => handleDragStart(col)}
                          onDragOver={(e) => handleDragOver(e, col)}
                          onDrop={() => handleDrop(col)}
                          onDragEnd={handleDragEnd}
                          className={`cursor-grab select-none transition-colors ${
                            dragOverCol === col ? "border-l-2 border-l-primary bg-primary/5" : ""
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <GripVertical className="h-3 w-3 text-muted-foreground/50" />
                            {columnHeaders[col]}
                          </span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unified.map((row) => {
                      if (row.source === "slack") {
                        const m = row.data;
                        return (
                          <TableRow
                            key={`slack-${m.id}`}
                            className={`cursor-pointer hover:bg-muted/50 transition-colors ${m.is_test ? "opacity-50" : ""} ${!m.owner ? "border-l-[3px] border-primary/70 bg-primary/5" : ""}`}
                            onClick={() => navigate(`/conversations/${m.id}`)}
                          >
                            {columnOrder.map((col) => (
                              <TableCell key={col} className={`${col === "message" ? "max-w-[300px]" : ""} ${col === "id" ? "w-[40px]" : ""}`}>
                                {renderSlackCell(col, m)}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      } else if (row.source === "gmail") {
                        const g = row.data;
                        const isGrouped = row.groupCount && row.groupCount > 1;
                        const isExpanded = row.groupKey ? expandedGmailGroups.has(row.groupKey) : false;
                        const subRows = isGrouped && isExpanded && row.groupedEmails ? row.groupedEmails.slice(1) : [];
                        return (
                          <Fragment key={`gmail-group-${g.id}`}>
                            <TableRow
                              key={`gmail-${g.id}`}
                              className={`cursor-pointer hover:bg-muted/50 transition-colors ${g.is_test ? "opacity-50" : ""} ${!g.owner ? "border-l-[3px] border-primary/70 bg-primary/5" : ""}`}
                              onClick={isGrouped && row.groupKey ? () => {
                                setExpandedGmailGroups((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.groupKey!)) next.delete(row.groupKey!);
                                  else next.add(row.groupKey!);
                                  return next;
                                });
                              } : () => navigate(`/conversations/${g.id}?source=gmail`)}
                            >
                              {columnOrder.map((col) => (
                                <TableCell key={col} className={col === "message" ? "max-w-[300px]" : ""}>
                                  {renderGmailCell(col, g, row.groupCount, row.groupedEmails, row.groupKey)}
                                </TableCell>
                              ))}
                            </TableRow>
                            {subRows.map((sub) => (
                              <TableRow
                                key={`gmail-sub-${sub.id}`}
                                className={`cursor-pointer hover:bg-muted/50 transition-colors bg-muted/20 ${sub.is_test ? "opacity-50" : ""}`}
                                onClick={() => navigate(`/conversations/${sub.id}?source=gmail`)}
                              >
                                {columnOrder.map((col) => (
                                  <TableCell key={col} className={`${col === "message" ? "max-w-[300px]" : ""} ${col === "id" ? "pl-8" : ""}`}>
                                    {renderGmailCell(col, sub)}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      } else {
                        const mc = row.data;
                        return (
                          <TableRow
                            key={`manual-${mc.id}`}
                            className={`cursor-pointer hover:bg-muted/50 transition-colors ${mc.is_test ? "opacity-50" : ""} ${!mc.owner ? "border-l-[3px] border-primary/70 bg-primary/5" : ""}`}
                            onClick={() => navigate(`/conversations/${mc.id}?source=manual`)}
                          >
                            {columnOrder.map((col) => (
                              <TableCell key={col} className={col === "message" ? "max-w-[300px]" : ""}>
                                {renderManualCell(col, mc as ManualConversation)}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      }
                    })}
                  </TableBody>
                </Table>
              </div>
              )}
              {canLoadMore && unified.length > 0 && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" size="sm" onClick={() => loadData(true)} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Conversations;
