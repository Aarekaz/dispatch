import { createRuntimeAdapter } from "@/lib/runtime/factory";
import type { RuntimeEvent } from "@/lib/runtime";

/**
 * runAgent — the single execution seam shared by every agent surface.
 *
 * This function is intentionally pure: it takes serializable inputs,
 * returns an `AsyncIterable<RuntimeEvent>`, and holds zero references
 * to request objects, response writers, Convex contexts, or auth
 * tokens. Three places call it today:
 *
 *   1. The web chat API route (app/api/agents/[id]/chat/route.ts)
 *   2. Chat SDK platform handlers (lib/chat/handlers/message.ts)
 *   3. Cron / webhook triggers (Phase 2)
 *
 * Each caller layers its own responsibilities (auth, persistence,
 * AI SDK protocol emission, Chat SDK thread.post) on top of the same
 * event stream. When OpenCode behavior changes, all surfaces update
 * for free.
 *
 * **Workflow-shaped from day one.** The signature deliberately mirrors
 * what a Vercel Workflow step will look like in Phase 4: serializable
 * inputs, async iterable output, no closures. The eventual migration
 * is wrapping this function in a Workflow step, NOT rewriting it.
 *
 * Note: this function does NOT call `ensureAgentRunning`. Callers
 * must wake the sandbox themselves before calling this — the sandbox
 * lifecycle is a per-surface concern (the web route waits inline for
 * a fast UX, the Slack handler can post a "waking…" message and then
 * await, etc.).
 */
export async function* runAgent(input: {
  agentId: string;
  sessionExternalId: string;
  message: string;
  previewUrl: string;
  serverPassword: string;
  signal?: AbortSignal;
}): AsyncGenerator<RuntimeEvent> {
  const runtime = createRuntimeAdapter(input.previewUrl, input.serverPassword);
  yield* runtime.prompt({
    agentId: input.agentId,
    sessionExternalId: input.sessionExternalId,
    message: input.message,
    signal: input.signal,
  });
}
