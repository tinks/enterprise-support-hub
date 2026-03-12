import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowDown, MessageSquare, MousePointerClick, Ticket, Bot, ThumbsUp, ThumbsDown, ChevronDown, User, Mail, Eye, Clock, CheckCircle2, GitBranch } from "lucide-react";
import { useState } from "react";

const SlackMessage = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
    {children}
  </div>
);

const Emoji = ({ children }: { children: string }) => (
  <span className="inline-block text-base leading-none">{children}</span>
);

const StepCard = ({
  icon: Icon,
  title,
  desc,
  colorClass = "text-primary",
  message,
  details,
  edgeFunction,
  reactions,
  status,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  colorClass?: string;
  message?: React.ReactNode;
  details?: string[];
  edgeFunction?: string;
  reactions?: string[];
  status?: string;
}) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${colorClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-foreground">{title}</h3>
            {edgeFunction && (
              <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-accent-foreground">
                {edgeFunction}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
          {details && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {details.map((d, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {d}
                </li>
              ))}
            </ul>
          )}
          {message && <SlackMessage>{message}</SlackMessage>}
          {(reactions || status) && (
            <div className="mt-2 flex items-center gap-3 text-xs">
              {reactions && (
                <span className="flex items-center gap-1">
                  {reactions.map((r, i) => (
                    <Emoji key={i}>{r}</Emoji>
                  ))}
                </span>
              )}
              {status && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                  status → {status}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </CardContent>
  </Card>
);

const Connector = ({ label }: { label?: string }) => (
  <div className="flex flex-col items-center py-1">
    <ArrowDown className="h-4 w-4 text-muted-foreground/40" />
    {label && <span className="text-[10px] text-muted-foreground/60">{label}</span>}
  </div>
);

const BranchContainer = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-3">{children}</div>
);

const BranchColumn = ({
  children,
  side,
}: {
  children: React.ReactNode;
  side: "left" | "right";
}) => (
  <div
    className={`relative space-y-2 rounded-lg border border-border/50 p-3 ${
      side === "left" ? "border-l-2 border-l-green-500/50" : "border-r-2 border-r-orange-500/50"
    }`}
  >
    {children}
  </div>
);

const MergeConnector = () => (
  <div className="flex justify-center py-1">
    <div className="flex items-center gap-1 text-muted-foreground/40">
      <GitBranch className="h-4 w-4 rotate-180" />
      <span className="text-[10px] text-muted-foreground/60">paths merge</span>
    </div>
  </div>
);

const FlowDiagram = () => {
  const [escalationOpen, setEscalationOpen] = useState(false);

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-1 p-6">
        <h1 className="text-2xl font-bold text-foreground mb-6">Program Flow</h1>

        {/* Step 1 */}
        <StepCard
          icon={MessageSquare}
          title="1. User @mentions bot in Slack"
          desc="A user mentions the bot in a monitored channel or thread."
          edgeFunction="slack-events"
          details={[
            "Verifies Slack signature & checks channel is monitored",
            "Deduplicates via conversation_mappings lookup",
            "If thread reply, fetches full thread transcript",
          ]}
          message={
            <span>
              <span className="text-foreground">@SupportBot</span> I'm having trouble deploying my project, getting a build error on the latest push
            </span>
          }
        />

        <Connector />

        {/* Step 2 */}
        <StepCard
          icon={Bot}
          title="2. Bot posts context prompt"
          desc='The bot replies with two buttons letting the user add context or proceed immediately.'
          edgeFunction="slack-events"
          message={
            <div className="space-y-2">
              <p>Optionally add your Lovable account email and/or project link so the AI can look up your account details for a better answer.</p>
              <div className="flex gap-2 pt-1">
                <span className="rounded bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary">Add Details</span>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Proceed</span>
              </div>
            </div>
          }
          status="awaiting_context"
        />

        <Connector label="user clicks a button" />

        {/* Step 3 - Branch */}
        <BranchContainer>
          <BranchColumn side="left">
            <StepCard
              icon={Mail}
              title='3a. "Add Details"'
              desc="Opens a Slack modal for email and project link."
              edgeFunction="slack-interactions"
              details={[
                "Prompt message deleted from thread",
                "Modal with Email + Project Link fields",
                "On submit → creates Intercom ticket with context",
              ]}
              message={
                <div className="space-y-1">
                  <p className="text-muted-foreground/70">Modal fields:</p>
                  <p>📧 Email: user@example.com</p>
                  <p>🔗 Project: https://lovable.dev/projects/...</p>
                </div>
              }
            />
          </BranchColumn>
          <BranchColumn side="right">
            <StepCard
              icon={MousePointerClick}
              title='3b. "Proceed"'
              desc="Skips modal, creates ticket immediately with no extra context."
              edgeFunction="slack-interactions"
              details={[
                "Prompt message deleted from thread",
                "Creates Intercom ticket with original message only",
              ]}
            />
          </BranchColumn>
        </BranchContainer>

        <MergeConnector />

        {/* Step 4 */}
        <StepCard
          icon={Ticket}
          title="4. Intercom ticket created"
          desc="Bot creates an Intercom conversation and assigns it to the AI agent."
          edgeFunction="slack-interactions"
          details={[
            "Searches for existing Intercom contact by email or creates new one (external_id = Slack user ID)",
            "Creates conversation with original message + any added context",
            'Assigns to AI agent in configured inbox, tags with "Slack"',
            "Stores mapping in conversation_mappings table",
          ]}
          message={
            <span>Thanks! Generating a response... Should take about 3-4 minutes. ⏳</span>
          }
          reactions={["👀"]}
          status="active"
        />

        <Connector />

        {/* Step 5 */}
        <StepCard
          icon={Bot}
          title="5. AI responds → posted to Slack"
          desc="The Intercom AI agent replies. The webhook catches it and posts to the Slack thread."
          edgeFunction="intercom-webhook"
          details={[
            "Removes old feedback buttons from all previous messages in thread",
            "Posts reply chunks to Slack (long replies split at 2900 chars)",
            "Uses admin name + avatar for the bot message",
            "Appends feedback buttons to last chunk only",
          ]}
          message={
            <div className="space-y-2">
              <p>Based on the error you're seeing, this is likely a dependency conflict. Try running...</p>
              <div className="flex gap-2 pt-1">
                <span className="rounded bg-green-500/20 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">✅ This resolved my issue</span>
                <span className="rounded bg-orange-500/20 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-400">⚠️ Escalate to human</span>
              </div>
            </div>
          }
        />

        <Connector label="user clicks feedback" />

        {/* Step 6 - Branch */}
        <BranchContainer>
          {/* 6a - Resolved */}
          <BranchColumn side="left">
            <StepCard
              icon={ThumbsUp}
              title="6a. Positive feedback"
              desc="User confirms the AI answer resolved their issue."
              colorClass="text-green-600"
              edgeFunction="slack-interactions"
              details={[
                "Removes feedback buttons from message",
                "Removes 👀 and ⏳ reactions, adds ✅",
                "Reassigns conversation to enterprise team inbox",
                "Closes Intercom conversation",
              ]}
              message={
                <span>Glad that helped! Marking as resolved. ✅</span>
              }
              reactions={["✅"]}
              status="resolved"
            />
          </BranchColumn>

          {/* 6b - Escalated */}
          <BranchColumn side="right">
            <StepCard
              icon={ThumbsDown}
              title="6b. Negative feedback"
              desc="User requests human support. Conversation is escalated."
              colorClass="text-orange-600"
              edgeFunction="slack-interactions"
              details={[
                "Removes feedback buttons from message",
                "Removes 👀 reaction, adds ⏳",
                "Reassigns conversation to enterprise team inbox",
                "Tags configured human agent in Slack thread",
              ]}
              message={
                <span>Escalating to human support. A team member will follow up here shortly. 🙋</span>
              }
              reactions={["⏳"]}
              status="escalated"
            />
          </BranchColumn>
        </BranchContainer>

        {/* Escalation sub-flow */}
        <div className="ml-[50%] w-[50%] pl-1.5">
          <Connector />
          <Collapsible open={escalationOpen} onOpenChange={setEscalationOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-accent/50 transition-colors">
              <ChevronDown className={`h-4 w-4 transition-transform ${escalationOpen ? "rotate-180" : ""}`} />
              Escalation sub-flow (bidirectional messaging)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1 pt-1">
                <Connector />
                <BranchContainer>
                  <BranchColumn side="left">
                    <StepCard
                      icon={User}
                      title="6b-i. Human replies in Slack"
                      desc="A support agent or user replies in the Slack thread."
                      edgeFunction="slack-events"
                      details={[
                        "Forwards message text to Intercom as the contact",
                        "Removes any remaining feedback buttons from thread",
                        "First reply only: reassigns to team inbox + posts escalation notice",
                      ]}
                    />
                  </BranchColumn>
                  <BranchColumn side="right">
                    <StepCard
                      icon={Bot}
                      title="6b-ii. Human replies from Intercom"
                      desc="A support agent replies in Intercom. Posted back to Slack."
                      edgeFunction="intercom-webhook"
                      details={[
                        "Removes old feedback buttons from thread",
                        "Posts reply to Slack with admin name + avatar",
                        'Shows only "This resolved my issue" button (no escalate — already escalated)',
                      ]}
                      message={
                        <div className="space-y-2">
                          <p className="text-muted-foreground/70">[Agent name]: I've looked into your project and...</p>
                          <div className="flex gap-2 pt-1">
                            <span className="rounded bg-green-500/20 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">✅ This resolved my issue</span>
                          </div>
                        </div>
                      }
                    />
                  </BranchColumn>
                </BranchContainer>

                <MergeConnector />

                {/* Step 7 */}
                <StepCard
                  icon={CheckCircle2}
                  title="7. Conversation closed in Intercom"
                  desc="When the conversation is closed in Intercom, the thread is finalized."
                  colorClass="text-green-600"
                  edgeFunction="intercom-webhook"
                  details={[
                    "Removes all remaining feedback buttons from thread",
                    "Removes 👀 and ⏳ reactions, adds ✅",
                    "Posts resolution notice to Slack thread",
                  ]}
                  message={
                    <span>This issue has been marked as resolved. If you need more help, feel free to start a new thread! ✅</span>
                  }
                  reactions={["✅"]}
                  status="resolved"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Reaction lifecycle */}
        <Card className="mt-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Reaction Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1.5">
            <p><Emoji>👀</Emoji> Added when ticket is created → indicates active processing</p>
            <p><Emoji>⏳</Emoji> Replaces 👀 on escalation → indicates waiting for human</p>
            <p><Emoji>✅</Emoji> Replaces 👀/⏳ on resolution → indicates done</p>
          </CardContent>
        </Card>

        {/* Edge Functions Reference */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Edge Functions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm text-muted-foreground">
            <p><span className="font-mono font-medium text-foreground">slack-events</span> — Receives Slack event subscriptions (mentions, thread replies)</p>
            <p><span className="font-mono font-medium text-foreground">slack-interactions</span> — Handles button clicks, modal submissions, feedback</p>
            <p><span className="font-mono font-medium text-foreground">intercom-webhook</span> — Catches Intercom replies/closures → posts to Slack</p>
            <p><span className="font-mono font-medium text-foreground">list-slack-channels</span> — Fetches Slack channels for settings UI</p>
            <p><span className="font-mono font-medium text-foreground">list-slack-users</span> — Fetches Slack users for tagging config</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default FlowDiagram;
