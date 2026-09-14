import { getToken } from "@/lib/auth-server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ensureAgentRunning } from "@/lib/agents/ensure-running";
import { runAgent } from "@/lib/agents/run-agent";
import { perfLog, perfTimer } from "@/lib/perf";
import { mintCid, withRequestContext } from "@/lib/request-context";
import { toUIMessageStream } from "@/lib/runtime/ai-sdk-bridge";
import { createRuntimeAdapter } from "@/lib/runtime/factory";

// Vercel Hobby caps Serverless Functions at 300s. Keep the default deployable
// for open-source/self-host installs; Pro users can raise this if they want
// longer single-turn agent runs.
export const maxDuration = 300;

// Safety timeout — prevents infinite hangs if session.idle never arrives.
// Set 10s below maxDuration so we always close the stream gracefully with
// a user-visible notice before Vercel kills the function.
const STREAM_TIMEOUT_MS = 290_000;

// Per-session wall-clock gap tracker. Correlating cache-hit % with time
// between turns is the cheapest way to tell whether cache misses are a
// TTL-expiry issue (OpenAI-style providers have short windows ~30–60s).
// Lives only in warm Vercel instances; cold starts lose history, which is
// fine — we're looking at patterns in logs, not per-session accuracy.
const LAST_TURN_AT = new Map<string, number>();

/**
 * Build an error Response that carries the correlation id in both the
 * body (for client-side logging / user-visible reference) and the
 * `X-Correlation-Id` header (for browser devtools + server-side proxies).
 */
function jsonError(
  body: Record<string, unknown>,
  status: number,
  cid: string,
): Response {
  return Response.json(
    { ...body, cid },
    { status, headers: { "X-Correlation-Id": cid } },
  );
}

/**
 * POST /api/agents/[id]/chat
 *
 * AI SDK streaming chat endpoint for the in-app web sandbox.
 *
 * Flow:
 *   1. Auth + agent fetch
 *   2. Ensure Daytona sandbox is running
 *   3. Get or create an OpenCode session
 *   4. Stream events through the runtime adapter via `runAgent` and
 *      pipe them into the AI SDK protocol via `toUIMessageStream`
 *   5. On completion, log the run + persist messages to Convex
 *
 * The agent execution path (steps 4) is shared with Chat SDK platform
 * handlers via `lib/agents/run-agent.ts` — this route is just the
 * web-sandbox-specific wrapper around the same primitive.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;
  // Mint one correlation ID for the entire request. Every perfLog /
  // perfTimer call inside the wrap auto-includes it (see lib/perf.ts).
  // The same cid is echoed back in `X-Correlation-Id` and in any 4xx/5xx
  // body, so the client can quote it when reporting issues and devs can
  // grep one cid across interleaved logs to see the full timeline.
  const cid = mintCid();

  return withRequestContext({ cid, agentId }, async (): Promise<Response> => {
    const routeTimer = perfTimer("chat.route", { agentId: agentId.slice(0, 8) });

    // 1. Auth
    const token = await getToken();
    if (!token) {
      return jsonError({ error: "Unauthorized" }, 401, cid);
    }

    const [agent, user] = await Promise.all([
      fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token }),
      fetchQuery(api.users.me, {}, { token }),
    ]);
    if (!agent) {
      return jsonError({ error: "Agent not found" }, 404, cid);
    }
    if (!agent.sandboxId || !agent.serverPassword) {
      return jsonError(
        { error: "Agent not provisioned — no sandbox" },
        400,
        cid,
      );
    }
    const serverPassword = agent.serverPassword;

    // Parse body — AI SDK sends { messages: UIMessage[], sessionId? }
    const body = await request.json();
    const aiMessages: Array<{
      role: string;
      parts?: Array<{ type: string; text?: string }>;
    }> = body.messages ?? [];
    const lastUserMsg = aiMessages.filter((m) => m.role === "user").pop();
    const message =
      lastUserMsg?.parts?.find((p) => p.type === "text")?.text ?? body.message;
    const sessionId: string | undefined = body.sessionId;

    if (!message) {
      return jsonError({ error: "Message is required" }, 400, cid);
    }

    // 2. Ensure sandbox is running
    //
    // `userId` and `agentId` together pin the per-agent Composio identity
    // `${userId}:${agentId}`. `userId` comes from the agent row (owner),
    // NOT the authenticated caller — for web chat they're usually the
    // same, but sourcing from the agent row keeps the rule consistent
    // with the Slack/Telegram handler and means only the owner's
    // Composio connections are ever consulted.
    let previewUrl: string;
    try {
      const result = await ensureAgentRunning(agent.sandboxId, {
        name: agent.name,
        model: agent.model,
        persona: agent.persona,
        toolPermissions: agent.toolPermissions,
        userId: agent.userId,
        agentId: agentId,
        composioToolkits: agent.composioToolkits,
        serverPassword,
      });
      previewUrl = result.previewUrl;
    } catch (error) {
      // Cold-start failures are the highest-value place to surface the
      // cid — `grep cid":"<id>"` on the server pulls every ensure-running
      // perf line that led up to the throw.
      return jsonError(
        { error: `Failed to start agent sandbox: ${error}` },
        503,
        cid,
      );
    }

  // 3. Get or create session (treat "pending_*" temp IDs as null)
  const runtime = createRuntimeAdapter(previewUrl, serverPassword);
  let sid = sessionId?.startsWith("pending_") ? undefined : sessionId;
  if (!sid) {
    const sessionTimer = perfTimer("chat.session.create");
    const sessionTitle =
      message.length > 50 ? `${message.slice(0, 50)}...` : message;
    const session = await runtime.createSession(agentId, sessionTitle);
    sid = session.sessionExternalId;
    sessionTimer.end();
  }

  // 3b. Inject latest memory into every message.
  // The bootstrap prompt only has memory from boot time — if the agent
  // saved new memories since then, sessions won't see them. Reading
  // MEMORY.md here ensures the agent always has current context.
  // Build context prefix: timestamp + memory
  const contextParts: string[] = [];

  // Current time in user's timezone — no more running `date` in bash
  const now = new Date();
  const tz = user?.timezone || "UTC";
  try {
    const formatted = now.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    contextParts.push(`[Current time: ${formatted}]`);
  } catch {
    contextParts.push(`[Current time: ${now.toUTCString()}]`);
  }

  // Memory injection
  try {
    const { readMemoryFile } = await import("@/lib/agents/memory");
    const memoryContent = await readMemoryFile(
      agent.sandboxId,
      "/home/daytona/agent/memories/MEMORY.md",
    );
    if (memoryContent && memoryContent.length > 100 && !memoryContent.includes("No memories yet")) {
      const capped = truncateMemory(memoryContent);
      contextParts.push(`[Your current memory — reference this when relevant]\n${capped}`);
    }
  } catch {
    // Non-critical — agent runs without memory injection
  }

  const enrichedMessage = contextParts.length > 0
    ? `${contextParts.join("\n\n")}\n\n---\n\n${message}`
    : message;

  // Per-turn token instrumentation. Captures WHAT WE HAND to runAgent
  // so you can compare against the provider-reported `chat.usage.
  // inputTokens` emitted after the stream completes. The delta
  // between our client-side estimate and the provider's final number
  // tells us how much comes from OpenCode's own scaffolding +
  // built-in tool schemas + Composio MCP schemas + session replay —
  // the black-box overhead we can't measure directly.
  //
  // bytes ÷ 4 is a rough token estimate for English/Markdown. Kimi/
  // Moonshot tokenizers count ~20% higher than that; Claude/OpenAI
  // track closer. Use the field as a ground-truth lower bound, not
  // an exact count.
  const userMessageBytes = Buffer.byteLength(message, "utf-8");
  const contextPrefixBytes = Buffer.byteLength(
    contextParts.join("\n\n"),
    "utf-8",
  );
  const enrichedMessageBytes = Buffer.byteLength(enrichedMessage, "utf-8");
  const turnAtMs = Date.now();
  const prevTurnAt = sid ? LAST_TURN_AT.get(sid) : undefined;
  const msSinceLastTurn = prevTurnAt ? turnAtMs - prevTurnAt : null;
  if (sid) LAST_TURN_AT.set(sid, turnAtMs);
  perfLog("chat.prompt", {
    sid: sid?.slice(-8),
    model: agent.model,
    userMessageBytes,
    contextPrefixBytes,
    enrichedMessageBytes,
    approxClientTokens: Math.round(enrichedMessageBytes / 4),
    toolkitCount: agent.composioToolkits?.length ?? 0,
    uiMessageCount: aiMessages.length,
    msSinceLastTurn,
  });

  routeTimer.mark("pre-stream", { hasSessionId: !!sid });

  // 4. Stream events through the runtime adapter via runAgent +
  // toUIMessageStream. The route owns:
  //   - the safety timeout (combined with client aborts via one AbortController)
  //   - perf marks (first text / first tool latency from prompt-sent)
  //   - usage logging via perfLog
  //   - run + session + message persistence to Convex (needs the user auth token)
  const stream = createUIMessageStream({
    // Re-enter the request context inside the executor: the AI SDK pulls
    // this body lazily once the client starts reading the stream, by
    // which point the outer ALS scope has unwound. Without this re-entry,
    // every perfLog in the streaming path (chat.stream:first-text,
    // chat.usage, chat.persist.total, …) would lose its `cid` and the
    // trace would split into two unjoined halves at cold-start vs
    // model-stream.
    execute: ({ writer }) => withRequestContext({ cid, agentId }, async () => {
      const streamTimer = perfTimer("chat.stream", { sid: sid?.slice(-8) });
      const promptSentAt = performance.now();

      // Combined abort controller: aborts on client disconnect OR safety timeout.
      const ac = new AbortController();
      const timeoutId = setTimeout(() => {
        ac.abort("timeout");
      }, STREAM_TIMEOUT_MS);
      const onClientAbort = () => ac.abort("client");
      request.signal.addEventListener("abort", onClientAbort);

      try {
        const events = runAgent({
          agentId,
          sessionExternalId: sid!,
          message: enrichedMessage,
          previewUrl,
          serverPassword,
          signal: ac.signal,
        });

        const { fullAssistantText, toolCount, usage, error: classifiedError } = await toUIMessageStream(
          events,
          writer,
          {
            agentName: agent.name,
            onFirstText: () => {
              perfLog("chat.stream:first-text", {
                sid: sid?.slice(-8),
                sincePromptMs: Math.round(performance.now() - promptSentAt),
              });
            },
            onFirstTool: (toolName) => {
              perfLog("chat.stream:first-tool", {
                tool: toolName,
                sincePromptMs: Math.round(performance.now() - promptSentAt),
              });
              perfLog("chat.tool.start", { tool: toolName });
            },
          },
        );

        clearTimeout(timeoutId);
        request.signal.removeEventListener("abort", onClientAbort);

        const timedOut =
          ac.signal.aborted && ac.signal.reason === "timeout";
        const clientAborted =
          ac.signal.aborted && ac.signal.reason !== "timeout";

        streamTimer.end({
          textLen: fullAssistantText.length,
          toolCalls: toolCount,
          aborted: clientAborted,
          timedOut,
          ...(classifiedError && { error: classifiedError.category }),
        });

        // Emit usage breakdown so we can measure prompt caching.
        // `cache.read > 0` means the provider served cached input
        // tokens on this request. `cache.write` interpretation varies
        // by provider:
        //   - Anthropic: populated when new content is cached; if both
        //     read and write stay 0 across many turns, caching is broken.
        //   - OpenAI-style (Moonshot/Kimi, OpenAI, Google): permanently
        //     0 — not reported upstream. Use `cache.read` alone as the
        //     signal; `cacheHitPct > 0` proves caching works.
        if (usage) {
          const totalInput = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
          const hitRatePct =
            totalInput > 0
              ? Math.round(((usage.cacheReadTokens ?? 0) / totalInput) * 100)
              : 0;
          perfLog("chat.usage", {
            sid: sid?.slice(-8),
            model: usage.model,
            provider: usage.provider,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            cacheHitPct: hitRatePct,
            costUsd: usage.costUsd,
          });
        }

        // If we hit the safety timeout (not a client abort or normal idle),
        // write a visible notice so the user knows the task is still
        // running in the background rather than silently showing
        // truncated content. OpenCode keeps executing server-side;
        // reloading the page fetches the latest persisted state from
        // its session store.
        if (timedOut) {
          const noticeId = `stream-timeout-${Date.now()}`;
          writer.write({ type: "text-start", id: noticeId });
          writer.write({
            type: "text-delta",
            id: noticeId,
            delta: `\n\n---\n\n⚠️ **Stream paused** — this task is taking longer than ${Math.round(
              STREAM_TIMEOUT_MS / 1000,
            )}s. The agent is still working in the background. **Reload this page** to see the latest state.\n`,
          });
          writer.write({ type: "text-end", id: noticeId });
        }

        const persistTimer = perfTimer("chat.persist.total");

        // 5. Log run with usage metrics — use "failed" when the bridge
        //    captured a run.error so the Activity feed shows the correct state.
        const runFailed = !!classifiedError;
        try {
          await fetchMutation(
            api.runs.log,
            {
              agentId: agentId as Id<"agents">,
              sessionId: sid,
              trigger: "chat",
              channel: "web",
              status: runFailed ? "failed" : "completed",
              model: usage?.model ?? undefined,
              tokensIn: usage?.inputTokens ?? undefined,
              tokensOut: usage?.outputTokens ?? undefined,
              credits: usage?.costUsd
                ? Math.ceil(usage.costUsd * 1000)
                : undefined,
              duration: `${(
                (performance.now() - promptSentAt) /
                1000
              ).toFixed(1)}s`,
              ...(classifiedError && {
                errorCategory: classifiedError.category,
                errorDetail: classifiedError.adminDetail,
                correlationId: classifiedError.correlationId,
              }),
            },
            { token },
          );
        } catch (err) {
          console.error("[chat] Failed to log run:", err);
        }

        // 5b. Deduct credits
        if (usage?.costUsd && usage.costUsd > 0) {
          try {
            await fetchMutation(
              api.credits.deductForRun,
              {
                agentId: agentId as Id<"agents">,
                costUsd: usage.costUsd,
                model: usage.model ?? undefined,
                tokensIn: usage.inputTokens ?? undefined,
                tokensOut: usage.outputTokens ?? undefined,
                secret:
                  process.env.CHAT_STATE_INTERNAL_SECRET ?? "",
              },
              { token },
            );
          } catch (err) {
            console.error("[chat] Failed to deduct credits:", err);
          }
        }

        // 6. Sync session to Convex (creates or updates)
        try {
          const sessionTitle =
            message.length > 50 ? message.slice(0, 50) + "..." : message;
          await fetchMutation(
            api.sessions.upsert,
            {
              agentId: agentId as Id<"agents">,
              sessionExternalId: sid!,
              title: sessionTitle,
            },
            { token },
          );
        } catch (err) {
          console.error("[chat] Failed to sync session:", err);
        }

        // 7. Persist messages to Convex (fire-and-forget — user already saw it)
        if (fullAssistantText) {
          try {
            await fetchMutation(
              api.chat.persistMessages,
              {
                agentId: agentId as Id<"agents">,
                sessionExternalId: sid!,
                userMessage: message,
                assistantMessage: fullAssistantText,
              },
              { token },
            );
          } catch (err) {
            console.error("[chat] Failed to persist messages:", err);
          }
        }

        // 8. Background memory extraction — scan for facts worth saving
        if (fullAssistantText && !runFailed) {
          import("@/lib/agents/memory-extract").then(({ tryExtractMemories }) =>
            tryExtractMemories({
              agentId,
              sandboxId: agent.sandboxId!,
              sessionId: sid!,
              userMessage: message,
              assistantResponse: fullAssistantText,
              agentName: agent.name,
            }),
          ).catch(() => {});
        }

        persistTimer.end();
        routeTimer.end({ status: runFailed ? "failed" : "ok" });
      } finally {
        clearTimeout(timeoutId);
        request.signal.removeEventListener("abort", onClientAbort);
      }
    }),
    onError: (error) => {
      console.error("[chat] Stream error:", error);
      routeTimer.end({ status: "error" });
      return error instanceof Error ? error.message : "Stream failed";
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { "X-Session-Id": sid!, "X-Correlation-Id": cid },
    consumeSseStream: consumeStream,
  });
  });
}

// ── Memory truncation (matches Claude Code's limits) ────

const MAX_MEMORY_LINES = 200;
const MAX_MEMORY_BYTES = 25_000;

function truncateMemory(content: string): string {
  let result = content;

  // Line cap first (natural boundary)
  const lines = result.split("\n");
  if (lines.length > MAX_MEMORY_LINES) {
    result = lines.slice(0, MAX_MEMORY_LINES).join("\n");
    result += "\n\n... (memory truncated — older entries omitted)";
  }

  // Byte cap at last newline before limit
  if (Buffer.byteLength(result, "utf-8") > MAX_MEMORY_BYTES) {
    const buf = Buffer.from(result, "utf-8").subarray(0, MAX_MEMORY_BYTES);
    const str = buf.toString("utf-8");
    const lastNewline = str.lastIndexOf("\n");
    result = lastNewline > 0 ? str.slice(0, lastNewline) : str;
    result += "\n\n... (memory truncated — older entries omitted)";
  }

  return result;
}
