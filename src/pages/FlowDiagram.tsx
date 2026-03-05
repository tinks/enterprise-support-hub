import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, MessageSquare, MousePointerClick, Ticket, Bot, ThumbsUp, ThumbsDown, AlertTriangle } from "lucide-react";

const steps = [
  {
    icon: MessageSquare,
    title: "1. User @mentions bot in Slack",
    desc: "A user mentions the bot in a monitored channel. The slack-events edge function receives the event.",
    color: "text-primary",
  },
  {
    icon: MousePointerClick,
    title: "2. Bot posts action buttons",
    desc: 'The bot replies with two buttons: "Add Details" (to attach more context) or "Proceed" (to create a ticket immediately).',
    color: "text-primary",
  },
  {
    icon: MousePointerClick,
    title: "3. Button click → slack-interactions",
    desc: "Clicking a button sends a payload to the slack-interactions edge function. If 'Add Details' is chosen, the bot waits for follow-up messages before proceeding.",
    color: "text-primary",
  },
  {
    icon: Ticket,
    title: "4. Intercom ticket created",
    desc: "The bot creates a new Intercom conversation with the original message (+ any added context) and assigns it to the AI agent in the configured inbox.",
    color: "text-primary",
  },
  {
    icon: Bot,
    title: "5. AI responds → Intercom webhook → Slack",
    desc: "The Intercom AI agent replies. The intercom-webhook edge function catches the reply and posts it back into the original Slack thread with feedback buttons.",
    color: "text-primary",
  },
  {
    icon: ThumbsUp,
    title: "6a. 👍 Positive feedback",
    desc: "Conversation is reassigned to the enterprise team inbox, then closed. Status set to 'resolved'. Buttons are removed.",
    color: "text-green-600",
  },
  {
    icon: ThumbsDown,
    title: "6b. 👎 Negative feedback",
    desc: "Conversation is reassigned to the enterprise team inbox. Status set to 'escalated'. A human agent is tagged in the Slack thread for manual follow-up.",
    color: "text-destructive",
  },
];

const FlowDiagram = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl space-y-2 p-6">
        <h1 className="text-2xl font-bold text-foreground mb-6">Program Flow</h1>

        {steps.map((step, i) => (
          <div key={i}>
            <Card className="relative">
              <CardContent className="flex items-start gap-4 p-5">
                <div className={`mt-0.5 shrink-0 ${step.color}`}>
                  <step.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
                </div>
              </CardContent>
            </Card>
            {i < steps.length - 1 && (
              <div className="flex justify-center py-1">
                <ArrowDown className="h-5 w-5 text-muted-foreground/50" />
              </div>
            )}
          </div>
        ))}

        {/* Edge Functions Reference */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Edge Functions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><span className="font-mono font-medium text-foreground">slack-events</span> — Receives Slack event subscriptions (mentions, messages)</p>
            <p><span className="font-mono font-medium text-foreground">slack-interactions</span> — Handles button clicks (Add Details, Proceed, Feedback)</p>
            <p><span className="font-mono font-medium text-foreground">intercom-webhook</span> — Catches Intercom AI replies and posts them back to Slack</p>
            <p><span className="font-mono font-medium text-foreground">list-slack-channels</span> — Fetches Slack channels for the settings UI</p>
            <p><span className="font-mono font-medium text-foreground">list-slack-users</span> — Fetches Slack users for tagging</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default FlowDiagram;
