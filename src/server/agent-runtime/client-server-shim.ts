/**
 * Railway bundle ONLY: replaces `@/integrations/supabase/client.server`.
 * There is no admin key on Railway; every call is routed to the current
 * turn's gateway-backed stand-in, which the app scopes to that turn.
 * Anything the stand-in doesn't support fails loudly — never silently.
 */
import { currentTurnContext } from "@/server/turn-context.server";

function current(): Record<string, unknown> {
  const db = currentTurnContext().agentDb;
  if (!db) throw new Error("agent-runtime: database used outside a turn");
  return db as Record<string, unknown>;
}

function unsupported(what: string): never {
  throw new Error(`agent-runtime: ${what} is not available on the build server`);
}

export const supabaseAdmin: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "from") return (table: string) => (current().from as (t: string) => unknown)(table);
      if (prop === "rpc") return (fn: string, args?: Record<string, unknown>) => (current().rpc as (f: string, a?: unknown) => unknown)(fn, args);
      if (prop === "then") return undefined;
      if (prop === "storage") return new Proxy({}, { get: () => () => unsupported("file storage") });
      if (prop === "auth") return new Proxy({}, { get: () => () => unsupported("account admin") });
      return unsupported(`database.${String(prop)}`);
    },
  },
);
