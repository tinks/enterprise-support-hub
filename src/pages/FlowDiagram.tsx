import AppLayout from "@/components/AppLayout";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
  Handle,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo } from "react";
import {
  MessageSquare,
  Bot,
  Mail,
  MousePointerClick,
  Ticket,
  ThumbsUp,
  ThumbsDown,
  User,
  CheckCircle2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Custom Node                                                        */
/* ------------------------------------------------------------------ */

type FlowNodeData = {
  label: string;
  desc: string;
  icon: React.ElementType;
  details?: string[];
  message?: string;
  edgeFunction?: string;
  reactions?: string[];
  status?: string;
  accent?: "blue" | "green" | "orange" | "default";
  wide?: boolean;
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

function FlowNode({ data }: { data: FlowNodeData }) {
  const Icon = data.icon;
  const accent = data.accent || "default";

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
            <div className="mt-2 rounded border border-border bg-muted/50 px-2 py-1.5 font-mono text-[9px] text-muted-foreground leading-snug">
              {data.message}
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

const nodeTypes = { flowNode: FlowNode };

/* ------------------------------------------------------------------ */
/*  Layout constants                                                   */
/* ------------------------------------------------------------------ */

const COL_W = 360;
const ROW_H = 260;

/* ------------------------------------------------------------------ */
/*  Nodes                                                              */
/* ------------------------------------------------------------------ */

const initialNodes: Node<FlowNodeData>[] = [
  {
    id: "1",
    type: "flowNode",
    position: { x: COL_W, y: 0 },
    data: {
      label: "1. User @mentions bot",
      desc: "A user mentions the bot in a monitored Slack channel or thread.",
      icon: MessageSquare,
      edgeFunction: "slack-events",
      details: [
        "Verifies Slack signature",
        "Checks channel is monitored",
        "Deduplicates via conversation_mappings",
        "If thread reply → fetches full transcript",
      ],
      message: "@SupportBot I'm having trouble deploying my project...",
      accent: "blue",
    },
  },
  {
    id: "2",
    type: "flowNode",
    position: { x: COL_W, y: ROW_H },
    data: {
      label: "2. Bot posts context prompt",
      desc: "Bot replies with two buttons to add context or proceed immediately.",
      icon: Bot,
      edgeFunction: "slack-events",
      message: '👋 Optionally add your Lovable account email and/or project link to improve support. If you don\'t want to share this, just click Proceed.\n\n[ Add Details ]  [ Proceed ]',
      status: "awaiting_context",
      accent: "blue",
    },
  },
  {
    id: "3a",
    type: "flowNode",
    position: { x: COL_W - COL_W * 0.55, y: ROW_H * 2 },
    data: {
      label: '3a. "Add Details" clicked',
      desc: "Opens a Slack modal for email + project link.",
      icon: Mail,
      edgeFunction: "slack-interactions",
      details: [
        "Prompt message deleted",
        "Modal: Email + Project Link fields",
        "On submit → creates Intercom ticket",
      ],
      message: "📧 user@example.com\n🔗 https://lovable.dev/projects/...",
      accent: "blue",
    },
  },
  {
    id: "3b",
    type: "flowNode",
    position: { x: COL_W + COL_W * 0.55, y: ROW_H * 2 },
    data: {
      label: '3b. "Proceed" clicked',
      desc: "Skips modal, creates ticket with original message only.",
      icon: MousePointerClick,
      edgeFunction: "slack-interactions",
      details: [
        "Prompt message deleted",
        "Creates Intercom ticket immediately",
      ],
      accent: "blue",
    },
  },
  {
    id: "4",
    type: "flowNode",
    position: { x: COL_W, y: ROW_H * 3 },
    data: {
      label: "4. Intercom ticket created",
      desc: "Bot creates an Intercom conversation and assigns it to the AI agent.",
      icon: Ticket,
      edgeFunction: "slack-interactions",
      details: [
        "Adds 👀 reaction to original message",
        "Searches/creates Intercom contact",
        "Creates conversation, assigns to AI agent",
        'Tags with "Slack"',
      ],
      message: "✅ Thanks! Generating a response... Should take about 3-4 minutes.",
      reactions: ["👀"],
      status: "active",
      accent: "blue",
      wide: true,
    },
  },
  {
    id: "5",
    type: "flowNode",
    position: { x: COL_W, y: ROW_H * 4 },
    data: {
      label: "5. AI responds → posted to Slack",
      desc: "Intercom AI replies. Webhook posts it to the Slack thread with feedback buttons.",
      icon: Bot,
      edgeFunction: "intercom-webhook",
      details: [
        "Removes old feedback buttons from thread",
        "Posts reply (split at 2900 chars)",
        "Appends feedback buttons to last chunk",
      ],
      message: "[AI reply text...]\n\n[ 👍 This resolved my issue ]  [ 👎 Escalate to human ]",
      accent: "blue",
      wide: true,
    },
  },
  // ---- Feedback branch ----
  {
    id: "6a",
    type: "flowNode",
    position: { x: COL_W - COL_W * 0.55, y: ROW_H * 5.2 },
    data: {
      label: "6a. 👍 Positive feedback",
      desc: "User confirms AI resolved their issue.",
      icon: ThumbsUp,
      edgeFunction: "slack-interactions",
      details: [
        "Removes feedback buttons",
        "Removes 👀 and ⏳, adds ✅",
        "Closes Intercom conversation (keeps current admin)",
      ],
      message: "✅ Glad that helped! Marking as resolved.",
      reactions: ["✅"],
      status: "resolved",
      accent: "green",
    },
  },
  {
    id: "6b",
    type: "flowNode",
    position: { x: COL_W + COL_W * 0.55, y: ROW_H * 5.2 },
    data: {
      label: "6b. 👎 Escalate to human",
      desc: "User requests human support. Creates Intercom ticket.",
      icon: ThumbsDown,
      edgeFunction: "slack-interactions",
      details: [
        "Removes feedback buttons",
        "Removes 👀, adds ⏳",
        "Reassigns to enterprise team inbox",
        "Converts conversation to ticket",
      ],
      message: "🔄 Escalating to human support. A ticket has been created and a member of our Enterprise support team will follow up shortly.",
      reactions: ["⏳"],
      status: "escalated",
      accent: "orange",
    },
  },
  // ---- Escalation sub-flow ----
  {
    id: "6bi",
    type: "flowNode",
    position: { x: COL_W + COL_W * 0.1, y: ROW_H * 6.5 },
    data: {
      label: "6b-i. Human replies in Slack",
      desc: "Agent or user replies in the Slack thread → forwarded to Intercom.",
      icon: User,
      edgeFunction: "slack-events",
      details: [
        "Forwards message to Intercom as the contact",
        "Removes remaining feedback buttons",
        "First reply: reassigns + posts escalation notice",
      ],
      message: "🔄 Your reply has been sent. A member of our Enterprise support team will follow up shortly.",
      accent: "orange",
    },
  },
  {
    id: "6bii",
    type: "flowNode",
    position: { x: COL_W + COL_W, y: ROW_H * 6.5 },
    data: {
      label: "6b-ii. Human replies from Intercom",
      desc: "Agent replies in Intercom → posted to Slack with resolve button.",
      icon: Bot,
      edgeFunction: "intercom-webhook",
      details: [
        "Removes old feedback buttons",
        "Posts reply with admin identity",
        'Shows only "Resolved" button (no escalate)',
      ],
      message: "[Agent reply text...]\n\n[ 👍 This resolved my issue ]",
      accent: "orange",
    },
  },
  {
    id: "7",
    type: "flowNode",
    position: { x: COL_W + COL_W * 0.55, y: ROW_H * 7.8 },
    data: {
      label: "7. Conversation closed",
      desc: "Conversation closed in Intercom → thread finalized in Slack.",
      icon: CheckCircle2,
      edgeFunction: "intercom-webhook",
      details: [
        "Removes all feedback buttons",
        "Removes 👀 and ⏳, adds ✅",
        "Posts resolution notice",
      ],
      message: "This issue has been marked as resolved. ✅",
      reactions: ["✅"],
      status: "resolved",
      accent: "green",
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Edges                                                              */
/* ------------------------------------------------------------------ */

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e2-3a", source: "2", target: "3a", label: "Add Details", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e2-3b", source: "2", target: "3b", label: "Proceed", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e3a-4", source: "3a", target: "4", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e3b-4", source: "3b", target: "4", style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e4-5", source: "4", target: "5", animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
  { id: "e5-6a", source: "5", target: "6a", label: "👍 Resolved", style: { stroke: "rgb(34,197,94)", strokeWidth: 2 } },
  { id: "e5-6b", source: "5", target: "6b", label: "👎 Escalate", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6b-6bi", source: "6b", target: "6bi", label: "Slack reply", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6b-6bii", source: "6b", target: "6bii", label: "Intercom reply", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6bi-7", source: "6bi", target: "7", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
  { id: "e6bii-7", source: "6bii", target: "7", style: { stroke: "rgb(249,115,22)", strokeWidth: 2 } },
];

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

const FlowDiagram = () => {
  const defaultEdgeOptions = useMemo(
    () => ({
      type: "smoothstep" as const,
    }),
    []
  );

  return (
    <AppLayout>
      <div className="h-[calc(100vh-4rem)] w-full">
        <ReactFlow
          nodes={initialNodes}
          edges={initialEdges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={() => "hsl(var(--primary))"}
            maskColor="hsl(var(--background) / 0.7)"
            className="!bg-card !border-border"
          />
        </ReactFlow>
      </div>
    </AppLayout>
  );
};

export default FlowDiagram;
