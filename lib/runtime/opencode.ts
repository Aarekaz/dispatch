import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { OpencodeClient } from "@opencode-ai/sdk/client";
import type {
  AgentRuntimeAdapter,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeSessionSummary,
  RuntimeUsage,
} from "@/lib/runtime";
import { basicAuthorization } from "@/lib/security/runtime-auth";

/**
 * OpenCode Runtime Adapter — uses the official @opencode-ai/sdk.
 *
 * The streaming `prompt()` implementation subscribes to OpenCode's
 * event stream BEFORE sending the prompt (so we don't miss the first
 * tokens), then iterates events and emits semantic `RuntimeEvent`s.
 *
 * Two key correctness rules consumers depend on:
 *
 * 1. Per-part text/reasoning dedup. OpenCode may send a `delta` that
 *    is either the full accumulated text or just the new characters.
 *    We detect which mode by checking `delta.startsWith(prev)` and
 *    extract the unsent suffix accordingly. Without this, models that
 *    emit accumulated mode (or any future model that switches modes)
 *    cause duplicate text in the UI.
 *
 * 2. Tool lifecycle dedup via `seenToolStates`. OpenCode may emit
 *    multiple "running" updates for the same tool (state refreshes
 *    on partial input parsing). We only emit `tool.started` once
 *    per `toolCallId`, and handle the fast-completion case (a tool
 *    that goes from absent → completed without ever passing through
 *    "running") by synthesizing a `tool.started` immediately before
 *    the `tool.completed`.
 *
 * The adapter does NO display normalization — `HIDDEN_TOOLS`, friendly
 * tool names, file-path enrichment, and HTML markup are all the
 * concern of bridge layers (lib/runtime/ai-sdk-bridge.ts for the web
 * chat route, lib/chat/stream-bridge.ts for Chat SDK platforms).
 */
export class OpenCodeRuntimeAdapter implements AgentRuntimeAdapter {
  readonly kind = "opencode" as const;
  private client: OpencodeClient;

  constructor(baseUrl: string, serverPassword: string) {
    this.client = createOpencodeClient({
      baseUrl,
      headers: { Authorization: basicAuthorization(serverPassword) },
    });
  }

  async createSession(
    _agentId: string,
    title?: string,
  ): Promise<{ sessionExternalId: string }> {
    // 60s timeout wrapper. Observed failure mode: OpenCode accepts
    // the TCP connection, `/global/health` returns 200, but
    // `session.create` can hang indefinitely when the server is
    // deadlocked internally. The SDK has no timeout of its own, so
    // the caller (sessions/create route) awaits forever and the
    // client sees a silent spinning send button.
    //
    // 60s is chosen to cover legitimately slow paths:
    //   - Warm: ~40-80ms on healthy servers
    //   - Cold provider init: up to several seconds when OpenCode
    //     is loading a provider it hasn't touched since boot
    //   - First-time-after-model-swap: observed 199s in the wild
    //     when swapping from Kimi (OpenRouter) to Sonnet (Anthropic).
    //     OpenCode seems to do expensive provider registration +
    //     API-key validation on first touch. This is the outlier
    //     that pushed us from 15s to 60s.
    //
    // Pathological cases beyond 60s WILL trip the timeout. The
    // sessions/create route converts it to a 503 with a clear
    // error, which the client can surface + retry (usually
    // successfully — the retry hits the already-warm provider).
    const timeoutMs = 60_000;
    const normalizedTitle = title?.trim();
    const res = await Promise.race([
      this.client.session.create({
        body: normalizedTitle ? { title: normalizedTitle } : {},
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `OpenCode session.create timed out after ${timeoutMs}ms — sandbox may need a restart`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
    if (res.error || !res.data?.id) {
      throw new Error(`Failed to create session: ${res.error ?? "no id"}`);
    }
    return { sessionExternalId: res.data.id };
  }

  async *prompt(input: {
    agentId: string;
    sessionExternalId: string;
    message: string;
    signal?: AbortSignal;
  }): AsyncGenerator<RuntimeEvent> {
    const targetSessionId = input.sessionExternalId;

    // Subscribe BEFORE sending the prompt — otherwise we may miss
    // the first events for fast tool calls or short replies.
    const eventResult = await this.client.event.subscribe();

    // Kick off the prompt via the async endpoint. Unlike
    // `session.prompt`, this returns immediately after the server
    // accepts the work instead of holding the HTTP request open until
    // the model finishes. That matches our event-streaming flow:
    // subscribe first, then ask OpenCode to start producing events.
    // Keep this sequential; parallelizing can miss early events.
    const promptStart = await this.client.session.promptAsync({
      path: { id: input.sessionExternalId },
      body: { parts: [{ type: "text", text: input.message }] },
    });
    if (promptStart.error) {
      throw new Error(
        `Failed to start prompt: ${JSON.stringify(promptStart.error)}`,
      );
    }

    // ── State tracking ───────────────────────────────────────
    let assistantMessageId: string | null = null;
    // Latest snapshot of the assistant message — tokens/cost fields
    // populate only after the provider response completes, so we hold
    // the most recent state and emit usage on session.idle.
    let latestAssistantMessage: AssistantMessageSnapshot | null = null;

    // Per-tool-call status: "running" | "completed" | "error"
    const seenToolStates = new Map<string, string>();
    // Per-tool-call display name (kept so we can emit a sensible
    // toolName when flushing stuck "running" tools at the end).
    const toolNamesById = new Map<string, string>();

    // Per-text-part accumulated content for dedup. See class doc.
    const sentTextContents = new Map<string, string>();
    const sentReasoningContents = new Map<string, string>();
    let emittedAssistantText = false;

    try {
      for await (const event of eventResult.stream) {
        // Honor client aborts immediately. We don't cancel the upstream
        // OpenCode prompt here — the route layer can call `cancelRun`
        // if it wants the sandbox to actually stop.
        if (input.signal?.aborted) {
          return;
        }

        const eventSessionId = getEventSessionId(event as EventWithProperties);
        if (eventSessionId && eventSessionId !== targetSessionId) {
          continue;
        }

        // ── Top-level (non-part) events ────────────────────
        if (event.type !== "message.part.updated") {
          if (event.type === "message.updated") {
            const msg = (event as EventWithProperties).properties?.info as
              | AssistantMessageSnapshot
              | undefined;
            if (msg?.role === "assistant") {
              assistantMessageId = msg.id ?? assistantMessageId;
              // Hold the most recent snapshot — token/cost fields fill
              // in at the end of the run.
              latestAssistantMessage = msg;
            }
            continue;
          }

          if (event.type === "session.error") {
            // Build two views of the same error:
            //
            //   `errMsg`     — brief, single-line. Used by the error
            //                  classifier in `lib/chat/errors.ts` for
            //                  pattern matching and by log lines that
            //                  can't afford a multi-line payload.
            //
            //   `adminDetail` — full pretty-printed payload. Stored on
            //                   the failed `agentRuns` row and shown
            //                   in the Activity table on
            //                   `/[agentId]/activity` when the user
            //                   expands a failed row.
            //                   Preserved VERBATIM — no lossy extraction.
            //
            // The classifier is the single place that knows how to
            // categorize these errors; this adapter stays dumb and just
            // passes through what OpenCode sent.
            const props = (event as EventWithProperties).properties;
            let adminDetail: string;
            try {
              adminDetail = JSON.stringify(props, null, 2);
            } catch {
              adminDetail = String(props);
            }

            const errProps = props as
              | { error?: { message?: string; name?: string } | string }
              | undefined;
            const err = errProps?.error;
            let errMsg: string;
            if (typeof err === "string") {
              errMsg = err;
            } else if (err?.message) {
              errMsg = err.name ? `${err.name}: ${err.message}` : err.message;
            } else if (err && typeof err === "object") {
              try {
                errMsg = `OpenCode session error: ${JSON.stringify(err)}`;
              } catch {
                errMsg = "OpenCode session error (unserializable payload)";
              }
            } else {
              errMsg = "OpenCode session error (empty payload)";
            }
            yield { type: "run.error", error: errMsg, errorDetail: adminDetail };
            return;
          }

          if (event.type === "session.idle") {
            if (!emittedAssistantText) {
              const fallbackText = await this.loadAssistantTextFallback(
                input.sessionExternalId,
              );
              if (fallbackText) {
                emittedAssistantText = true;
                yield { type: "message.delta", value: fallbackText };
              }
            }
            // Flush any tools still in "running" state so consumers
            // don't have stuck spinners. This shouldn't normally
            // happen — OpenCode emits a final "completed" state — but
            // we defend against it.
            for (const [toolCallId, status] of seenToolStates) {
              if (status === "running") {
                yield {
                  type: "tool.completed",
                  toolCallId,
                  toolName: toolNamesById.get(toolCallId) ?? "unknown",
                  output: "",
                };
              }
            }
            yield {
              type: "run.completed",
              usage: extractUsage(latestAssistantMessage),
            };
            return;
          }

          // step-start, step-finish, etc. — skip
          continue;
        }

        // ── message.part.updated events ────────────────────
        const props = (event as EventWithProperties).properties as
          | { part?: PartUpdate; delta?: string }
          | undefined;
        const part = props?.part;
        const delta = props?.delta;
        if (
          !part ||
          !assistantMessageId ||
          part.messageID !== assistantMessageId
        ) {
          continue;
        }

        switch (part.type) {
          // ── Text streaming ──
          case "text": {
            if (!delta) break;
            const partKey = part.id ?? "default";
            const prev = sentTextContents.get(partKey) ?? "";
            const newText = extractNewContent(delta, prev);
            if (delta.startsWith(prev)) {
              sentTextContents.set(partKey, delta);
            } else {
              sentTextContents.set(partKey, prev + delta);
            }
            if (newText) {
              emittedAssistantText = true;
              yield { type: "message.delta", value: newText };
            }
            break;
          }

          // ── Reasoning / thinking ──
          case "reasoning": {
            if (!delta) break;
            const partKey = part.id ?? "default-reasoning";
            const prev = sentReasoningContents.get(partKey) ?? "";
            const newText = extractNewContent(delta, prev);
            if (delta.startsWith(prev)) {
              sentReasoningContents.set(partKey, delta);
            } else {
              sentReasoningContents.set(partKey, prev + delta);
            }
            if (newText) {
              yield { type: "reasoning.delta", value: newText };
            }
            break;
          }

          // ── Tool calls ──
          case "tool": {
            // Prefer OpenCode's per-part `id` over `callID`. The latter
            // is the model's tool-call id and can repeat across calls
            // in the same turn (e.g. two parallel `functions.bash:0`
            // invocations); `id` is unique per physical part. Sharing
            // a key across parts breaks React reconciliation in the
            // agent-elements MessageList ("two children with the same
            // key, functions.bash:0").
            const toolCallId = part.id ?? part.callID ?? "unknown";
            const toolName = part.tool ?? "unknown";
            const state = part.state;
            const prevStatus = seenToolStates.get(toolCallId);
            toolNamesById.set(toolCallId, toolName);

            // OpenCode tools attach result-shaped data to `state.metadata`
            // (edit ↦ `{ diff, filediff, diagnostics }`, bash ↦ `{ exitCode }`,
            // etc.). We thread it through so downstream bridges can reshape
            // the output to whatever their UI expects.
            const metadata =
              ((state as Record<string, unknown> | undefined)?.metadata as
                | Record<string, unknown>
                | undefined) ?? undefined;

            if (state?.status === "running" && prevStatus !== "running") {
              seenToolStates.set(toolCallId, "running");
              yield {
                type: "tool.started",
                toolCallId,
                toolName,
                input: state.input,
                title: state.title,
                metadata,
              };
              break;
            }

            if (state?.status === "completed" && prevStatus !== "completed") {
              // Fast-completion: never saw "running". Synthesize a
              // started event so consumers can render the lifecycle.
              if (!prevStatus) {
                yield {
                  type: "tool.started",
                  toolCallId,
                  toolName,
                  input: state.input,
                  title: state.title,
                  metadata,
                };
              }
              seenToolStates.set(toolCallId, "completed");
              yield {
                type: "tool.completed",
                toolCallId,
                toolName,
                input: state.input,
                title: state.title,
                output: state.output,
                metadata,
              };
              break;
            }

            if (state?.status === "error" && prevStatus !== "error") {
              seenToolStates.set(toolCallId, "error");
              yield {
                type: "tool.error",
                toolCallId,
                toolName,
                input: state.input,
                title: state.title,
                error: state.error ?? "Tool error",
                metadata,
              };
              break;
            }
            break;
          }

          default:
            // Unknown part type — skip silently. New OpenCode versions
            // may introduce part types we don't yet model.
            break;
        }
      }

      // Stream ended without session.idle. Two normal cases:
      // (a) client aborted — handled above by early return,
      // (b) the OpenCode event stream closed unexpectedly.
      if (input.signal?.aborted) return;

      if (!emittedAssistantText) {
        const fallbackText = await this.loadAssistantTextFallback(
          input.sessionExternalId,
        );
        if (fallbackText) {
          yield { type: "message.delta", value: fallbackText };
        }
      }

      // Best-effort completion — emit usage from whatever snapshot
      // we have so the route can still log metrics.
      yield {
        type: "run.completed",
        usage: extractUsage(latestAssistantMessage),
      };
    } catch (err) {
      yield {
        type: "run.error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listSessions(): Promise<RuntimeSessionSummary[]> {
    const res = await this.client.session.list();
    if (!res.data) return [];
    const sessions = Array.isArray(res.data)
      ? (res.data as OpenCodeSessionSummary[])
      : [];

    return sessions.map((s) => ({
      sessionExternalId: s.id,
      title: s.title ?? "Session",
      updatedAt: s.updatedAt ?? s.createdAt ?? "",
    }));
  }

  async getSessionMessages(input: {
    agentId: string;
    sessionExternalId: string;
  }): Promise<RuntimeMessage[]> {
    const res = await this.client.session.messages({
      path: { id: input.sessionExternalId },
    });
    if (!res.data) return [];
    const messages = Array.isArray(res.data)
      ? (res.data as OpenCodeStoredMessageEnvelope[])
      : [];

    // Response shape: Array<{ info: Message, parts: Part[] }>
    return messages.map((m) => {
      const info = m.info ?? m;
      const rawParts = m.parts ?? info.parts ?? [];

      // Build structured parts array
      const msgParts: import("@/lib/runtime").RuntimeMessagePart[] = [];
      for (const p of rawParts) {
        if (p.type === "text" && p.text) {
          msgParts.push({ type: "text", text: p.text });
        } else if (p.type === "reasoning" && p.text) {
          msgParts.push({ type: "reasoning", text: p.text });
        } else if (p.type === "tool" && p.tool) {
          const state = p.state ?? {};
          msgParts.push({
            type: "tool-call",
            toolName: p.tool,
            // Same id-vs-callID rationale as the live path above —
            // `id` is per-part and unique; `callID` can repeat.
            toolCallId: p.id ?? p.callID ?? "tool-call",
            input: state.input ?? {},
            output: state.output,
            metadata: state.metadata,
            status:
              state.status === "error"
                ? "error"
                : state.status === "completed"
                  ? "completed"
                  : "running",
            title: state.title,
          });
        }
      }

      return {
        id: info.id ?? m.id ?? crypto.randomUUID(),
        role: (info.role === "user" ? "user" : "assistant") as
          | "user"
          | "assistant",
        content:
          extractTextFromParts(rawParts) || extractTextContent(info),
        parts: msgParts.length > 0 ? msgParts : undefined,
        timestamp: info.time?.created
          ? new Date(info.time.created).toISOString()
          : info.createdAt,
        tokens: info.tokens
          ? { input: info.tokens.input ?? 0, output: info.tokens.output ?? 0 }
          : undefined,
        cost: info.cost,
      };
    });
  }

  async cancelRun(input: {
    agentId: string;
    sessionExternalId: string;
  }): Promise<void> {
    await this.client.session.abort({
      path: { id: input.sessionExternalId },
    });
  }

  private async loadAssistantTextFallback(
    sessionExternalId: string,
  ): Promise<string> {
    const res = await this.client.session.messages({
      path: { id: sessionExternalId },
    });
    if (!Array.isArray(res.data)) return "";

    const lastAssistant = [...res.data]
      .reverse()
      .find((msg) => {
        const message = msg as OpenCodeStoredMessageEnvelope;
        return (message.info ?? message).role === "assistant";
      }) as OpenCodeStoredMessageEnvelope | undefined;
    if (!lastAssistant) return "";

    const info = lastAssistant.info ?? lastAssistant;
    const parts = lastAssistant.parts ?? info.parts ?? [];
    return extractTextFromParts(parts) || extractTextContent(info);
  }
}

// ── Internal types and helpers ───────────────────────────────

/**
 * Loose subset of OpenCode's assistant-message shape that we read.
 * Token / cost fields are optional because they only populate after
 * the provider response completes.
 */
type AssistantMessageSnapshot = {
  id?: string;
  role?: "assistant" | "user";
  modelID?: string;
  providerID?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
};

type OpenCodeSessionSummary = {
  id: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
};

type OpenCodeStoredToolState = {
  input?: Record<string, unknown>;
  output?: string;
  metadata?: Record<string, unknown>;
  status?: "running" | "completed" | "error";
  title?: string;
};

type OpenCodeStoredPart =
  | { type: "text"; text?: string }
  | { type: "reasoning"; text?: string }
  | {
      type: "tool";
      tool?: string;
      id?: string;
      callID?: string;
      state?: OpenCodeStoredToolState;
    };

type OpenCodeStoredMessage = {
  id?: string;
  role?: "user" | "assistant";
  content?: string;
  parts?: OpenCodeStoredPart[];
  time?: { created?: string | number | Date };
  createdAt?: string;
  tokens?: { input?: number; output?: number };
  cost?: number;
};

type OpenCodeStoredMessageEnvelope = OpenCodeStoredMessage & {
  info?: OpenCodeStoredMessage;
  parts?: OpenCodeStoredPart[];
};

/** Loose shape of a `message.part.updated` part payload. */
type PartUpdate = {
  type?: string;
  id?: string;
  sessionID?: string;
  messageID?: string;
  callID?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: string;
    error?: string;
    title?: string;
  };
};

/** Generic event-with-properties wrapper for OpenCode SDK events. */
type EventWithProperties = { properties?: Record<string, unknown> };

function getEventSessionId(event: EventWithProperties & { type?: string }): string | null {
  const props = event.properties;
  if (!props) return null;

  if (typeof props.sessionID === "string") {
    return props.sessionID;
  }

  const info = props.info as { sessionID?: unknown } | undefined;
  if (typeof info?.sessionID === "string") {
    return info.sessionID;
  }

  const part = props.part as { sessionID?: unknown } | undefined;
  if (typeof part?.sessionID === "string") {
    return part.sessionID;
  }

  return null;
}

/**
 * Extract the unsent portion of a delta given the previously sent
 * content for the same part. OpenCode may send accumulated text
 * (delta is the full text so far) or incremental text (delta is just
 * the new characters). We detect which mode by `startsWith` and
 * extract accordingly so consumers always see only the new chars.
 */
function extractNewContent(delta: string, prev: string): string {
  if (delta.startsWith(prev)) {
    // Accumulated mode — delta is full text, return unsent suffix.
    return delta.slice(prev.length);
  }
  // Incremental mode — delta is just the new characters.
  return delta;
}

function extractUsage(
  msg: AssistantMessageSnapshot | null,
): RuntimeUsage | undefined {
  if (!msg?.tokens) return undefined;
  const t = msg.tokens;
  const cache = t.cache ?? {};
  return {
    inputTokens: t.input ?? 0,
    outputTokens: t.output ?? 0,
    reasoningTokens: t.reasoning ?? 0,
    cacheReadTokens: cache.read ?? 0,
    cacheWriteTokens: cache.write ?? 0,
    costUsd: msg.cost,
    model: msg.modelID,
    provider: msg.providerID,
  };
}

function extractTextFromParts(parts: OpenCodeStoredPart[]): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (part): part is Extract<OpenCodeStoredPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text ?? "")
    .join("");
}

function extractTextContent(msg: OpenCodeStoredMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.parts)) return "";
  return msg.parts
    .filter(
      (part): part is Extract<OpenCodeStoredPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text ?? "")
    .join("");
}
