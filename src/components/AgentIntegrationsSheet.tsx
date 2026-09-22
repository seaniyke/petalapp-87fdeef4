/**
 * AgentIntegrationsSheet — let AI agents talk to the app being built.
 *
 * Same pattern as Payments: these are things Kimble builds *into* the user's
 * project from a prompt (an MCP server, an agent-callable API, webhooks an
 * assistant can trigger), so each card sends a precise build instruction.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Bot, Braces, Key, Webhook } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendPrompt: (prompt: string) => void;
};

const OPTIONS = [
  {
    icon: Braces,
    title: "MCP server",
    body: "Expose this app's data and actions as tools any MCP client can call.",
    prompt:
      "Add an MCP server to this project that exposes the app's core data and actions as tools. Include tool schemas, auth via a bearer token, and a short README section explaining how to connect an MCP client.",
  },
  {
    icon: Key,
    title: "Agent API keys",
    body: "Issue scoped keys so an agent can act on a user's behalf safely.",
    prompt:
      "Add scoped API keys to this app so external agents can call it on a user's behalf: a keys table with hashed keys and scopes, a settings screen to create and revoke keys, and middleware that authenticates requests with them.",
  },
  {
    icon: Webhook,
    title: "Agent webhooks",
    body: "Notify an agent when something happens in the app.",
    prompt:
      "Add outbound webhooks to this app so an agent can be notified of key events. Include a webhook endpoints table, signed payload delivery with retries, and a settings screen to manage endpoints.",
  },
  {
    icon: Bot,
    title: "In-app AI assistant",
    body: "A chat assistant that can read and act on the app's own data.",
    prompt:
      "Add an in-app AI assistant to this app that can answer questions about the user's own data and perform safe actions through tool calls. Include streaming responses and clear permission boundaries.",
  },
];

export function AgentIntegrationsSheet({
  open,
  onOpenChange,
  onSendPrompt,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" /> Agent integrations
          </SheetTitle>
          <SheetDescription>
            Make your app usable by AI agents — tools, keys, webhooks and an
            assistant built right in.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {OPTIONS.map((opt) => (
            <button
              key={opt.title}
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSendPrompt(opt.prompt);
              }}
              className="flex w-full items-start gap-3 rounded-2xl border border-border/60 bg-card p-4 text-left transition hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-primary">
                <opt.icon className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">{opt.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {opt.body}
                </span>
              </span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
