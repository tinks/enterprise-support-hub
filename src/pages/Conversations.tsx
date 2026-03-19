import { useState, useEffect, useMemo } from "react";
import { subDays, isAfter, isBefore, startOfDay, endOfDay, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { RefreshCw, ExternalLink, Hash, User, CalendarIcon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelNameOverrides } from "@/lib/channelOverrides";

interface ConversationMapping {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  slack_user_id: string;
  intercom_conversation_id: string;
  status: string;
  created_at: string;
}

type NameMap = Record<string, string>;
type TimeRange = "7d" | "30d" | "90d" | "all" | "custom";

const statusColor = (status: string) => {
  switch (status) {
    case "active": return "default" as const;
    case "resolved": return "secondary" as const;
    case "escalated": return "destructive" as const;
    default: return "outline" as const;
  }
};

const buildSlackLink = (channelId: string, threadTs: string) =>
  `https://lovable-dev.slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;

const getCutoffDate = (range: TimeRange): Date | null => {
  switch (range) {
    case "7d": return subDays(new Date(), 7);
    case "30d": return subDays(new Date(), 30);
    case "90d": return subDays(new Date(), 90);
    default: return null;
  }
};

const rangeLabel: Record<TimeRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom range",
};

const Conversations = () => {
  const [mappings, setMappings] = useState<ConversationMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [userNames, setUserNames] = useState<NameMap>({});
  const [channelNames, setChannelNames] = useState<NameMap>({});

  // Filters
  const [dateRange, setDateRange] = useState<TimeRange>("all");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [channelPopoverOpen, setChannelPopoverOpen] = useState(false);

  const availableChannels = useMemo(() => {
    const ids = [...new Set(mappings.map((m) => m.slack_channel_id))];
    return ids
      .map((id) => ({ id, name: channelNames[id] || channelNameOverrides[id] || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mappings, channelNames]);

  const filteredMappings = useMemo(() => {
    return mappings.filter((m) => {
      // Date filter
      const created = new Date(m.created_at);
      if (dateRange === "custom") {
        if (customFrom && isBefore(created, startOfDay(customFrom))) return false;
        if (customTo && isAfter(created, endOfDay(customTo))) return false;
      } else {
        const cutoff = getCutoffDate(dateRange);
        if (cutoff && isBefore(created, cutoff)) return false;
      }

      // Channel filter
      if (selectedChannels.length > 0 && !selectedChannels.includes(m.slack_channel_id)) return false;

      return true;
    });
  }, [mappings, dateRange, customFrom, customTo, selectedChannels]);

  const toggleChannel = (id: string) =>
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );

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

  const loadData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("conversation_mappings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as unknown as ConversationMapping[];
    setMappings(rows);
    setLoading(false);
    return rows;
  };

  useEffect(() => {
    loadData().then((rows) => loadLookups(rows));
  }, []);

  const channelTriggerLabel = selectedChannels.length === 0
    ? "All channels"
    : selectedChannels.length === 1
      ? `#${channelNames[selectedChannels[0]] || channelNameOverrides[selectedChannels[0]] || selectedChannels[0]}`
      : `${selectedChannels.length} channels`;

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-5xl">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Recent conversations</CardTitle>
                <CardDescription>
                  Slack thread ↔ Intercom conversation mappings
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => { loadData().then((rows) => loadLookups(rows)); }} disabled={loading}>
                <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {/* Filter bar */}
              <div className="mb-4 flex flex-wrap items-end gap-3">
                {/* Date filter */}
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Date range</span>
                  <Select value={dateRange} onValueChange={(v) => setDateRange(v as TimeRange)}>
                    <SelectTrigger className="w-[160px] h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(rangeLabel) as TimeRange[]).map((key) => (
                        <SelectItem key={key} value={key}>{rangeLabel[key]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {dateRange === "custom" && (
                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">From</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className={cn("w-[140px] justify-start text-left font-normal", !customFrom && "text-muted-foreground")}>
                            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                            {customFrom ? format(customFrom, "MMM d, yyyy") : "Start date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">To</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className={cn("w-[140px] justify-start text-left font-normal", !customTo && "text-muted-foreground")}>
                            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                            {customTo ? format(customTo, "MMM d, yyyy") : "End date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </>
                )}

                {/* Channel filter */}
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Channel</span>
                  <Popover open={channelPopoverOpen} onOpenChange={setChannelPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 min-w-[160px] justify-between text-sm font-normal">
                        {channelTriggerLabel}
                        <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[220px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search channels…" />
                        <CommandList>
                          <CommandEmpty>No channels found.</CommandEmpty>
                          {availableChannels.map((ch) => (
                            <CommandItem
                              key={ch.id}
                              value={ch.name}
                              onSelect={() => toggleChannel(ch.id)}
                              className="flex items-center gap-2"
                            >
                              <Checkbox
                                checked={selectedChannels.includes(ch.id)}
                                className="pointer-events-none"
                              />
                              <span>#{ch.name}</span>
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                      {selectedChannels.length > 0 && (
                        <div className="border-t p-1.5">
                          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setSelectedChannels([])}>
                            Clear selection
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Table */}
              {filteredMappings.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Loading…" : "No conversations found."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent by</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Slack</TableHead>
                      <TableHead>Intercom</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMappings.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {userNames[m.slack_user_id] || m.slack_user_id || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-sm text-foreground">
                            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                            {channelNames[m.slack_channel_id] || channelNameOverrides[m.slack_channel_id] || m.slack_channel_id}
                          </span>
                        </TableCell>
                        <TableCell>
                          <a
                            href={buildSlackLink(m.slack_channel_id, m.slack_thread_ts)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-mono text-primary underline hover:text-primary/80 transition-colors"
                          >
                            Thread <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.intercom_conversation_id ? (
                            <a
                              href={`https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${m.intercom_conversation_id}?view=List`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline hover:text-primary/80 transition-colors"
                            >
                              {m.intercom_conversation_id}
                            </a>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusColor(m.status)}>{m.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(m.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default Conversations;
