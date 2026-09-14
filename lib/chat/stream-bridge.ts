import type { Plan, PlanTask, StreamChunk } from "chat";

import type { ClassifiedError } from "@/lib/chat/errors";
import { classifyRuntimeError } from "@/lib/chat/errors";
import type { RuntimeEvent } from "@/lib/runtime";
import {
  HIDDEN_TOOLS,
  announceArtifactTitle,
  resolveToolName,
} from "@/lib/tools/normalize";

/**
 * Options passed into `toChatStream`. `agentName` is used to produce
 * user-facing error messages that include the agent's real name
 * (e.g. "Alex is temporarily unavailable…"). `onClassified` fires
 * exactly once if the stream contained a `run.error` — the handler
 * captures this so it can route the turn through `reportFailure`
 * with the same `ClassifiedError` (same correlation ID) that the
 * user saw in Slack.
 *
 * `plan` is an optional Chat SDK Plan instance. When provided:
 * - tool lifecycle events drive `plan.addTask` / `plan.updateTask`
 *   instead of yielding `task_update` chunks (Slack would render
 *   both, producing duplicate task cards)
 * - tool progress shows up in Slack as native `plan` + `task_card`
 *   Block Kit blocks (the Feb 2026 AI thinking-block format)
 * - the caller is responsible for posting the plan up-front and
 *   calling `plan.complete()` after the stream ends
 *
 * The handler decides whether to provide a plan by calling
 * `plan.isSupported(thread.adapter)` — adapters without `postObject`
 * support (Telegram, Discord, etc.) skip the Plan and fall back to
 * the chunk-based flow automatically.
 */
export type ToChatStreamOptions = {
  agentName: string;
  onClassified?: (classified: ClassifiedError) => void;
  plan?: Plan | null;
};

/**
 * Bridge: RuntimeEvent → Chat SDK stream chunks.
 *
 * The Chat SDK twin of `lib/runtime/ai-sdk-bridge.ts`. The two bridges
 * are deliberately *the same shape* — they both consume the same
 * `RuntimeEvent` iterable from `runAgent()` and translate it into
 * the protocol expected by their respective consumers (AI SDK's
 * UIMessageStream for the web sandbox, Chat SDK's `thread.post()` for
 * deployed channels). The fact that this file exists at all is the
 * payoff of the Phase 0 cleanup — the same agent execution path
 * powers every surface, with platform-specific rendering at the edges.
 *
 * **Output shape: `AsyncIterable<StreamChunk>`.** Chat SDK accepts
 * either `AsyncIterable<string>` (plain text) or `AsyncIterable<StreamChunk>`
 * (structured chunks). We yield structured chunks so Slack renders
 * task progress as native task cards via its chatStream API. For
 * adapters without structured-chunk support (Telegram, Discord, etc.),
 * Chat SDK auto-extracts the `markdown_text` and renders just the
 * text via the post+edit fallback. **Same code, both UX modes.**
 *
 * Display normalization (`HIDDEN_TOOLS`, friendly tool names,
 * file-path enrichment) lives here — NOT in the runtime adapter —
 * because these are presentation concerns. The adapter stays
 * UI-agnostic so it can feed any future surface.
 *
 * Reasoning deltas are intentionally dropped: in Slack/Telegram/etc.
 * the customer is a non-technical end user who shouldn't see the
 * agent's chain-of-thought.
 */
export async function* toChatStream(
  events: AsyncIterable<RuntimeEvent>,
  options: ToChatStreamOptions,
): AsyncGenerator<StreamChunk> {
  // HIDDEN_TOOLS get a per-call-id sticky filter, same as the AI SDK
  // bridge. Once we've decided to hide a tool we ignore all further
  // events for it.
  const hiddenToolCallIds = new Set<string>();
  // Track tools we've already emitted an "in_progress" task_update for,
  // so a tool that goes started → completed within milliseconds doesn't
  // race the in_progress chunk against the complete chunk in the same
  // batch.
  const inProgressToolCallIds = new Set<string>();

  // Plan task tracking. When a Plan is active, `plan.addTask()` on
  // `tool.started` yields a `PlanTask` whose id we need later to
  // target `plan.updateTask()` on completion. The current Plan API
  // only exposes `updateTask()` for the CURRENT task — but addTask
  // returns the task so we store it for logging / future use.
  //
  // Plan mutations are fire-and-forget from the perspective of this
  // generator: `enqueueEdit` inside Chat SDK queues operations on
  // an internal promise chain that serializes them and swallows
  // errors via logger.warn. We `await` them anyway for determinism
  // during tests and to surface any synchronous validation errors.
  const planTaskByCallId = new Map<string, PlanTask>();
  const plan = options.plan ?? null;

  // ── Empty-stream guard ──
  //
  // Chat SDK's Slack adapter uses `ChatStreamer` from @slack/web-api. That
  // class captures its bot token lazily on the first `append()` call and
  // reuses it for subsequent appends + the final `stop()`. If `append` is
  // never called — because the upstream runtime produced zero chunks that
  // survived our filter (e.g., only `reasoning.delta` / `status` / no
  // output at all) — the streamer's `this.token` is `undefined`, and when
  // Chat SDK calls `streamer.stop()` it internally calls Slack's
  // `chat.startStream` with `token: undefined`, which Slack rejects with
  // `not_authed`. That's a Chat SDK / @slack/web-api bug in multi-workspace
  // mode specifically — see `chat-stream.js:112-144`.
  //
  // We work around it by guaranteeing at least one chunk is yielded. If
  // the upstream produced nothing renderable, we yield a visible fallback
  // so the user knows the agent ran but didn't produce output, AND the
  // streamer's append() fires so token capture succeeds and stop() works.
  //
  // In Plan mode there's a second consideration: a tool-only turn (plan
  // tasks fired, but no `message.delta`) still needs a stream chunk to
  // succeed, but the "no response" fallback message would be misleading
  // because the plan DID tell the user what happened. We track plan
  // activity separately and yield a brief confirmation instead.
  let yieldedAny = false;
  let planHadActivity = false;

  for await (const event of events) {
    switch (event.type) {
      case "message.delta": {
        if (!event.value) break;
        yield { type: "markdown_text", text: event.value };
        yieldedAny = true;
        break;
      }

      case "reasoning.delta":
        // Intentional drop — non-technical end users in deployed
        // channels don't want to see the model's chain-of-thought.
        break;

      case "tool.started": {
        if (HIDDEN_TOOLS.has(event.toolName)) {
          hiddenToolCallIds.add(event.toolCallId);
          break;
        }
        if (inProgressToolCallIds.has(event.toolCallId)) break;
        inProgressToolCallIds.add(event.toolCallId);

        // `announce_artifact` gets an args-aware title so Slack users
        // see "Published: Sales Dashboard" instead of a generic
        // "Artifact" card. Falls back to the label via resolveToolName
        // when args haven't streamed in yet.
        const title =
          event.toolName === "announce_artifact"
            ? announceArtifactTitle(event.input)
            : resolveToolName(event.toolName, event.title);

        if (plan) {
          // Plan mode — drive native plan/task_card Block Kit in Slack.
          // We don't also yield a task_update chunk: Chat SDK + Slack
          // would render both side-by-side (inline card AND plan task).
          try {
            const task = await plan.addTask({ title });
            if (task) planTaskByCallId.set(event.toolCallId, task);
            planHadActivity = true;
          } catch (err) {
            console.warn("[stream-bridge] plan.addTask failed:", err);
          }
        } else {
          yield {
            type: "task_update",
            id: event.toolCallId,
            title,
            status: "in_progress",
          };
          yieldedAny = true;
        }
        break;
      }

      case "tool.completed": {
        // ── Tool monitoring (Composio field guide) ──
        // Structured log for every tool completion. Enables tracking
        // failure rates per tool via log aggregation (Vercel logs,
        // grep, or future monitoring dashboard).
        const isComposioTool = event.toolName?.startsWith("composio_") ?? false;
        if (isComposioTool) {
          const output = event.output ?? "";
          const isFailure = output.includes('"successful":false') || output.includes('"error"');
          console.log(
            `[tool-metric] tool=${event.toolName} status=${isFailure ? "fail" : "ok"} agent=${options.agentName ?? "unknown"}`,
          );
        }

        if (hiddenToolCallIds.has(event.toolCallId)) break;

        // Same args-aware title treatment as tool.started so the
        // card header stays consistent across the status lifecycle.
        const title =
          event.toolName === "announce_artifact"
            ? announceArtifactTitle(event.input)
            : resolveToolName(event.toolName, event.title);
        // Compose a short, customer-friendly output summary.
        //
        // For NATIVE OpenCode tools (bash/read/write/etc.) the output
        // is human-readable text and we just truncate it so the card
        // body stays scannable.
        //
        // For COMPOSIO MCP tools the output is a raw JSON payload of
        // shape `{"successful":true,"data":{...}}` — pure noise in a
        // customer-facing channel. We try to extract a one-line
        // summary (e.g. "✓ Found 5 results") and fall back to the
        // generic "✓ Done" marker if we can't. The final agent text
        // response is the real source of information for the user;
        // the task card is just a status indicator that something
        // happened.
        const output = event.output ?? "";
        const displayOutput = summarizeToolOutput(output);

        if (plan) {
          // Plan mode — patch the matching task to complete.
          // `updateTask()` without a taskId targets the current task,
          // which is the one we just added via addTask(). Concurrent
          // tool calls are rare in OpenCode's execution model, so this
          // is correct in practice; if it ever breaks we'll need
          // per-task id routing.
          try {
            await plan.updateTask({
              status: "complete",
              ...(displayOutput ? { output: displayOutput } : {}),
            });
          } catch (err) {
            console.warn("[stream-bridge] plan.updateTask (complete) failed:", err);
          }
          planTaskByCallId.delete(event.toolCallId);
        } else {
          yield {
            type: "task_update",
            id: event.toolCallId,
            title,
            status: "complete",
            output: displayOutput || undefined,
          };
          yieldedAny = true;
        }
        break;
      }

      case "tool.error": {
        // ── Tool monitoring: always log errors ──
        console.log(
          `[tool-metric] tool=${event.toolName} status=error agent=${options.agentName ?? "unknown"} error=${(event.error ?? "").slice(0, 200)}`,
        );

        if (hiddenToolCallIds.has(event.toolCallId)) break;

        const title =
          event.toolName === "announce_artifact"
            ? announceArtifactTitle(event.input)
            : resolveToolName(event.toolName, event.title);

        if (plan) {
          try {
            await plan.updateTask({
              status: "error",
              ...(event.error ? { output: event.error } : {}),
            });
          } catch (err) {
            console.warn("[stream-bridge] plan.updateTask (error) failed:", err);
          }
          planTaskByCallId.delete(event.toolCallId);
        } else {
          yield {
            type: "task_update",
            id: event.toolCallId,
            title,
            status: "error",
            output: event.error,
          };
          yieldedAny = true;
        }
        break;
      }

      case "run.completed":
        // No final chunk — the natural end of the iterable signals
        // completion to Chat SDK.
        break;

      case "run.error": {
        // Classify the raw error and yield the user-friendly message
        // as the ONLY visible output for this failure. The handler
        // catches the classified result via `options.onClassified`
        // so it can persist the same `ClassifiedError` (same
        // correlationId) via `reportFailure` — user-visible text,
        // admin-visible log row, and Vercel log line all agree.
        //
        // Yielding `markdown_text` here also serves a second purpose:
        // it triggers the Slack adapter's first `append()` call,
        // which is what captures the workspace bot token inside
        // `ChatStreamer`. Without a visible append, `stop()` fails
        // with `not_authed` (the bug the empty-stream guard was
        // originally written to work around).
        const classified = classifyRuntimeError(
          event.error,
          event.errorDetail ?? event.error,
          options.agentName,
        );
        options.onClassified?.(classified);
        yield {
          type: "markdown_text",
          text: `\n\n_${classified.userMessage}_`,
        };
        yieldedAny = true;
        break;
      }

      case "status":
        // No-op — internal status events have no platform mapping.
        break;
    }
  }

  // Fallback chunk for the empty-stream case (see rationale above).
  // Only fires when the upstream produced zero renderable events.
  //
  // Two fallbacks depending on whether the plan did any work:
  //
  //   1. Plan got at least one task → the plan already told the user
  //      what happened. Yield a brief "Done." confirmation so the
  //      stream has a chunk (token capture) without contradicting
  //      the plan's narrative.
  //
  //   2. No plan activity AND no text → the agent genuinely produced
  //      nothing. Fall back to the "no response" message so the user
  //      knows the agent ran but didn't say anything.
  //
  // The italicized fallbacks are visually distinct from real agent
  // output so users don't mistake them for a real response.
  if (!yieldedAny) {
    yield {
      type: "markdown_text",
      text: planHadActivity
        ? "_Done._"
        : "_(no response — the agent finished without producing any output)_",
    };
  }
}

/**
 * Produce a short, customer-friendly summary string for a tool
 * result, suitable for the `output` field of a Chat SDK
 * `task_update` card.
 *
 * Strategy:
 *
 *   1. **Composio JSON payloads**: detect the `{"successful": ...}`
 *      shape (Composio's standard tool result), extract a one-line
 *      summary from known fields (`data.results` array length,
 *      `data.message`, `data.answer`, error field on failure), and
 *      return a clean line like `"✓ Found 5 results"` or
 *      `"❌ Gmail: token expired"`. The raw JSON never reaches the
 *      user.
 *
 *   2. **Other JSON payloads**: if it parses as JSON but isn't a
 *      recognized Composio shape, suppress it entirely — return
 *      `"✓ Done"`. Non-Composio tools rarely produce JSON in the
 *      sandbox, so this is a safety net for unknown MCP servers.
 *
 *   3. **Plain text output**: native OpenCode tools (bash, read,
 *      write, edit) produce readable text. We just truncate to
 *      200 chars so the card stays scannable.
 *
 *   4. **Empty output**: return `undefined` so Chat SDK renders the
 *      card with just the title (cleanest possible result).
 *
 * Returns `undefined` for empty output, a short string otherwise.
 * Never returns raw JSON.
 */
function summarizeToolOutput(output: string): string | undefined {
  const trimmed = output.trim();
  if (trimmed.length === 0) return undefined;

  // Is it JSON? Cheap prefix check before paying for `JSON.parse`.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return summarizeJsonPayload(parsed);
    } catch {
      // Starts with `{`/`[` but doesn't parse. Weird. Fall through
      // to text truncation — probably a malformed fragment and
      // truncating to 200 chars is the least surprising thing.
    }
  }

  // Plain text path — truncate and return as-is.
  return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
}

/**
 * Extract a one-line summary from a parsed JSON tool result.
 * Recognizes Composio's standard `{successful, data}` shape and
 * falls back to generic "Done" for unrecognized JSON shapes.
 */
function summarizeJsonPayload(parsed: unknown): string {
  if (typeof parsed !== "object" || parsed === null) return "✓ Done";

  const obj = parsed as Record<string, unknown>;

  // Composio standard success/failure shape
  if ("successful" in obj) {
    if (obj.successful === false) {
      const err =
        (typeof obj.error === "string" && obj.error) ||
        (typeof obj.message === "string" && obj.message) ||
        "Tool failed";
      const short = String(err).slice(0, 120);
      return `❌ ${short}`;
    }

    // Success — try to extract a useful one-liner from `data`.
    const data = (obj.data ?? {}) as Record<string, unknown>;

    if (Array.isArray(data.results)) {
      const n = data.results.length;
      return `✓ ${n} result${n === 1 ? "" : "s"}`;
    }
    if (typeof data.message === "string" && data.message.length > 0) {
      return `✓ ${data.message.slice(0, 120)}`;
    }
    if (typeof data.answer === "string" && data.answer.length > 0) {
      return `✓ ${data.answer.slice(0, 120)}`;
    }
    if (typeof data.response === "string" && data.response.length > 0) {
      return `✓ ${data.response.slice(0, 120)}`;
    }
    return "✓ Done";
  }

  // Unrecognized JSON shape — don't dump it, just mark done.
  return "✓ Done";
}
