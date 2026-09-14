/**
 * Core automation invocation function.
 *
 * This is the single function that runs an automation end-to-end:
 * 1. Wake the agent's sandbox
 * 2. Create or reuse a session
 * 3. Run the agent with the automation's instructions
 * 4. Accumulate the output text
 * 5. Deliver the output (Slack, activity log, etc.)
 * 6. Log to both agentAutomationRuns and agentRuns
 *
 * Called from three places:
 * - The cron dispatcher (schedule-triggered)
 * - The channel scanner (trigger-determined delivery to Slack thread)
 * - The manual trigger API route (user clicks "Run")
 */
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ensureAgentRunning,
  agentContextFromRow,
} from "@/lib/agents/ensure-running";
import { createRuntimeAdapter } from "@/lib/runtime/factory";
import { deliverOutput } from "./delivery";

// Secret is read at call time (not module level) so tests and
// hot-reload pick up env changes without a restart.
function getInternalSecret(): string {
  return process.env.CRON_INTERNAL_SECRET ?? "";
}

export type InvokeParams = {
  automationId: string;
  agentId: string;

  /** What triggered this invocation */
  triggerKind: "manual" | "schedule" | "trigger";
  triggerDetail?: string;

  /**
   * Additional context injected before the automation's instructions.
   * Used by the channel scanner to prepend the candidate Slack message.
   */
  contextMessage?: string;

  /**
   * Override the default delivery. Used by trigger-determined delivery
   * (e.g. scanner replies to a specific Slack thread).
   */
  deliveryOverride?: {
    type: string;
    config?: unknown;
  };
};

export type InvokeResult = {
  status: "success" | "failed";
  output: string;
  durationMs: number;
  error?: string;
};

export async function invokeAutomation(
  params: InvokeParams,
): Promise<InvokeResult> {
  const startedAt = Date.now();
  const secret = getInternalSecret();

  // Cast once at the boundary — callers pass strings from URL params,
  // but Convex needs branded Id types for type-safe mutation calls.
  const automationId = params.automationId as Id<"agentAutomations">;
  const agentId = params.agentId as Id<"agents">;

  // ── 1. Fetch metadata ─────────────────────────────────────
  const [automation, agent] = await Promise.all([
    fetchQuery(api.agentAutomations.getInternal, {
      id: automationId,
      secret,
    }),
    fetchQuery(api.agents.getInternal, {
      id: agentId,
      secret,
    }),
  ]);

  if (!automation) {
    return { status: "failed", output: "", durationMs: 0, error: "Automation not found" };
  }
  if (!agent?.sandboxId) {
    return { status: "failed", output: "", durationMs: 0, error: "Agent not found or no sandbox" };
  }

  const credits = await fetchQuery(api.credits.checkInternal, {
    userId: agent.userId,
    secret,
  });
  if (credits.balance <= 0) {
    return { status: "failed", output: "", durationMs: 0, error: "No credits" };
  }

  // ── 1b. Pre-fetch external data for composio-backed triggers ──
  // Architecture B: server fetches data before the agent runs.
  // The agent receives pre-fetched data as context, never touches APIs.
  // Merges with any existing contextMessage (e.g., from channel scanner).
  const contextParts: string[] = [];
  if (params.contextMessage) contextParts.push(params.contextMessage);

  const triggers = (automation.triggers ?? []) as Array<{ type: string; config: Record<string, unknown> }>;
  const allowed = automation.allowedToolkits as string[] | undefined;
  const allowedSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  const composioTriggers = triggers.filter((t) => {
    if (!t.type.startsWith("composio.")) return false;
    // Respect toolkit narrowing — skip triggers for disabled toolkits
    if (allowedSet) {
      const toolkit = t.type.split(".")[1]; // e.g., "gmail" from "composio.gmail.inbox"
      if (!allowedSet.has(toolkit)) return false;
    }
    return true;
  });

  if (composioTriggers.length > 0) {
    const { executePrefetch } = await import("./prefetch");
    const results = await Promise.allSettled(
      composioTriggers.map((t) =>
        executePrefetch({
          trigger: { type: t.type, config: t.config ?? {} },
          userId: String(agent.userId),
          agentId: String(params.agentId),
        }),
      ),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("[invoke] prefetch threw:", result.reason);
        continue;
      }
      const val = result.value;
      if (val.ok) {
        contextParts.push(val.contextMessage);
        console.log(`[invoke] prefetch ${val.durationMs}ms`);
      } else {
        console.warn(`[invoke] prefetch soft-fail: ${val.error}`);
      }
    }
  }

  const prefetchedContext = contextParts.length > 0
    ? contextParts.join("\n\n---\n\n")
    : undefined;

  const triggerLabel = params.triggerKind === "manual"
    ? "manual"
    : params.triggerKind === "schedule"
      ? "schedule"
      : `trigger:${params.triggerDetail ?? "unknown"}`;

  // ── 2. Create session placeholder IMMEDIATELY ─────────────
  // This fires the Convex subscription so the UI shows "Running..."
  // within ~70ms, instead of waiting ~2s for the sandbox to wake.
  let convexSessionId: string | null = null;
  const persistedExternalId = automation.persistentSessionId as string | undefined;
  let isNewSession = !persistedExternalId;

  if (isNewSession) {
    // No persistent session yet — create a pending placeholder
    const pending = await fetchMutation(api.sessions.createPendingAutomationSession, {
      agentId: agentId,
      automationId: automationId,
      automationTrigger: triggerLabel,
      title: automation.name,
      secret,
    });
    convexSessionId = pending.sessionId;
  } else {
    // Persistent session exists — mark it as running so the UI updates
    await fetchMutation(api.sessions.setAutomationRunStatus, {
      agentId: agentId,
      sessionExternalId: persistedExternalId,
      status: "running",
      secret,
    }).catch((e) => console.warn("[invoke] failed to mark session running:", e));
  }

  // Helper to mark the session as failed from any error path
  async function failSession(error: string) {
    if (convexSessionId) {
      await fetchMutation(api.sessions.setAutomationRunStatus, {
        sessionId: convexSessionId as Id<"agentSessions">,
        status: "failed",
        error,
        secret,
      }).catch((e) => console.warn("[invoke] non-critical mutation failed:", e));
    } else if (persistedExternalId) {
      await fetchMutation(api.sessions.setAutomationRunStatus, {
        agentId: agentId,
        sessionExternalId: persistedExternalId,
        status: "failed",
        error,
        secret,
      }).catch((e) => console.warn("[invoke] non-critical mutation failed:", e));
    }
  }

  try {
    // ── 3. Wake sandbox (slow, but UI already shows the run) ──
    const agentContext = agentContextFromRow(agent, String(params.agentId));
    if (automation.allowedToolkits && automation.allowedToolkits.length > 0) {
      agentContext.composioToolkits = automation.allowedToolkits;
    }

    const { previewUrl } = await ensureAgentRunning(
      agent.sandboxId,
      agentContext,
    );
    if (!agent.serverPassword) throw new Error("Agent runtime password is missing");
    const runtime = createRuntimeAdapter(previewUrl, agent.serverPassword);

    // ── 4. Create or verify OpenCode session ────────────────
    let sessionId = persistedExternalId;

    if (sessionId) {
      // Verify the persistent session is alive (sandbox may have
      // been reprovisioned, killing the OpenCode session).
      try {
        await runtime.getSessionMessages({
          agentId: String(params.agentId),
          sessionExternalId: sessionId,
        });
      } catch {
        console.log(`[invoke] persistent session ${sessionId} is dead, creating new`);
        sessionId = undefined;
      }
    }

    if (!sessionId) {
      // Create a fresh OpenCode session
      const newSession = await runtime.createSession(
        String(params.agentId),
        automation.name,
      );
      sessionId = newSession.sessionExternalId;

      if (convexSessionId) {
        // Link the pending placeholder to the real session ID
        await fetchMutation(api.sessions.linkPendingSession, {
          sessionId: convexSessionId as Id<"agentSessions">,
          sessionExternalId: sessionId,
          secret,
        });
      } else {
        // Dead session recovery: persistent session was dead, need a
        // new Convex session for this fresh OpenCode session.
        const pending = await fetchMutation(api.sessions.createPendingAutomationSession, {
          agentId: agentId,
          automationId: automationId,
          automationTrigger: triggerLabel,
          title: automation.name,
          secret,
        });
        convexSessionId = pending.sessionId;
        await fetchMutation(api.sessions.linkPendingSession, {
          sessionId: convexSessionId as Id<"agentSessions">,
          sessionExternalId: sessionId,
          secret,
        });
        isNewSession = true;
      }

      // Save for reuse on subsequent runs
      await fetchMutation(api.agentAutomations.savePersistentSession, {
        id: automationId,
        persistentSessionId: sessionId,
        secret,
      });
    }

    // ── 5. Build prompt ─────────────────────────────────────
    const delivery =
      params.deliveryOverride ??
      automation.defaultDelivery ??
      { type: "activity_log" };

    const deliveryHint =
      delivery.type === "slack_channel"
        ? "\n\nNote: Your output will be automatically posted to Slack when you finish. Do NOT try to call Slack tools to post your response — just write your findings as plain text and the system will deliver them."
        : delivery.type === "slack_thread"
          ? "\n\nNote: Your reply will be automatically posted to the Slack thread. Just write your response as plain text."
          : "";

    const prefetchHint = prefetchedContext
      ? "\n\nIMPORTANT: The data above was pre-fetched by the system. Analyze it directly. Do NOT re-fetch this data using external tools."
      : "";
    const basePrompt = prefetchedContext
      ? `${prefetchedContext}\n\n---\n\n${automation.instructions}`
      : automation.instructions;
    const prompt = basePrompt + prefetchHint + deliveryHint;

    // ── 6. Persist user message ─────────────────────────────
    // The session row already exists (from createPendingAutomationSession
    // or from a previous run). Just add the prompt as a message.
    await fetchMutation(api.sessions.addAutomationResponse, {
      agentId: agentId,
      sessionExternalId: sessionId!,
      content: prompt,
      role: "user",
      secret,
    }).catch((e) => console.warn("[invoke] non-critical mutation failed:", e));

    // ── 7. Run agent to completion ──────────────────────────
    let text = "";
    let status: "success" | "failed" = "success";
    let errorMsg: string | undefined;

    for await (const event of runtime.prompt({
      agentId: String(params.agentId),
      sessionExternalId: sessionId,
      message: prompt,
    })) {
      if (event.type === "message.delta") text += event.value ?? "";
      if (event.type === "run.error") {
        status = "failed";
        errorMsg = event.error ?? "Agent run error";
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[invoke] agent completed status=${status} output=${text.length} chars duration=${durationMs}ms prompt="${prompt.slice(0, 100)}"`);

    // ── 8. Persist response + update status ─────────────────
    if (text.trim()) {
      // addAutomationResponse sets automationStatus → "completed"
      // for assistant messages automatically.
      await fetchMutation(api.sessions.addAutomationResponse, {
        agentId: agentId,
        sessionExternalId: sessionId,
        content: text,
        title: text.slice(0, 60),
        secret,
      }).catch((err) => {
        console.error("[invoke] failed to persist response:", err);
      });
    }

    // If the agent failed, mark the session explicitly
    if (status === "failed") {
      await failSession(errorMsg ?? "Agent run error");
    } else if (!text.trim()) {
      // Agent succeeded but produced no output — still mark completed
      await fetchMutation(api.sessions.setAutomationRunStatus, {
        ...(convexSessionId
          ? { sessionId: convexSessionId as Id<"agentSessions"> }
          : { agentId: agentId, sessionExternalId: sessionId }),
        status: "completed",
        secret,
      }).catch((e) => console.warn("[invoke] non-critical mutation failed:", e));
    }

    // ── 9. Deliver + log ────────────────────────────────────
    if (status === "success" && text.trim() && delivery.type !== "activity_log") {
      try {
        await deliverOutput({
          output: text,
          delivery,
          automation: { name: automation.name },
        });
      } catch (err) {
        console.error("[invoke] delivery failed:", err);
      }
    }

    await fetchMutation(api.agentAutomations.markScheduleRun, {
      id: automationId,
      nextScheduleAt: Date.now() + 999999999,
      status,
      secret,
    }).catch((e) => console.warn("[invoke] non-critical mutation failed:", e));

    await fetchMutation(api.runs.logInternal, {
      agentId: agentId,
      sessionId,
      trigger: "automation",
      status: status === "success" ? "completed" : "failed",
      summary: text.slice(0, 200) || undefined,
      duration: `${Math.round(durationMs / 1000)}s`,
      automationId: automationId,
      automationName: automation.name,
      secret,
    });

    // Background sync: agent may have written new memories during the run
    if (agent?.sandboxId) {
      import("@/lib/agents/memory-sync").then(({ trySyncAgentMemory }) =>
        trySyncAgentMemory(String(params.agentId), agent.sandboxId!),
      ).catch(() => {});
    }

    return { status, output: text, durationMs, error: errorMsg };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMsg = err instanceof Error ? err.message : String(err);

    await failSession(errorMsg);

    await fetchMutation(api.runs.logInternal, {
      agentId: agentId,
      trigger: "automation",
      status: "failed",
      summary: undefined,
      duration: `${Math.round(durationMs / 1000)}s`,
      automationId: automationId,
      automationName: automation?.name,
      errorCategory: "automation_error",
      errorDetail: errorMsg,
      secret,
    }).catch((e) => console.warn("[invoke] non-critical mutation failed:", e));

    return { status: "failed", output: "", durationMs, error: errorMsg };
  }
}
