export type RuntimeKind = "opencode" | "pi";

export type RuntimeSessionSummary = {
  sessionExternalId: string;
  title?: string;
  updatedAt: string;
};

export type RuntimeMessagePart = {
  type: "text";
  text: string;
} | {
  type: "reasoning";
  text: string;
} | {
  type: "tool-call";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  output?: string;
  status: "completed" | "running" | "error";
  title?: string;
  // Same as the live RuntimeEvent: OpenCode attaches per-tool result
  // detail (edit's `diff`/`filediff`, bash's `exitCode`, etc.) here so
  // the web bridge can reshape outputs to agent-elements conventions.
  metadata?: Record<string, unknown>;
};

export type RuntimeMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: RuntimeMessagePart[];
  timestamp?: string;
  tokens?: { input: number; output: number };
  cost?: number;
};

export type RuntimeUsage = {
  inputTokens: number;
  outputTokens: number;
  // Reasoning/thinking tokens (Kimi K2.6, Claude Sonnet 4.6, etc.)
  reasoningTokens?: number;
  // Prompt-cache metrics. Semantics differ by provider:
  //   - Anthropic (Claude): both `cacheRead` and `cacheWrite` are
  //     populated. If both are 0 across many turns, caching is broken.
  //   - OpenAI-compatible providers (Moonshot/Kimi, OpenAI, Google):
  //     only `cacheRead` is exposed upstream. `cacheWrite` is
  //     permanently 0 — caching still works, it's just not reported.
  //     Moonshot explicitly charges nothing for writes, so there is
  //     no metric to surface. Do NOT treat `cacheWrite: 0` as a bug
  //     for these providers; check `cacheRead` as the sole signal.
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  model?: string;
  provider?: string;
  estimatedCredits?: number;
};

export type RuntimeEvent =
  // Streamed assistant text. The adapter handles dedup so consumers
  // see only new characters per delta.
  | { type: "message.delta"; value: string }
  // Reasoning / thinking tokens, same dedup contract as message.delta.
  | { type: "reasoning.delta"; value: string }
  // Tool lifecycle. toolCallId disambiguates concurrent tool calls
  // within the same turn. `input` is the tool's parsed argument object
  // and `title` is OpenCode's display string (e.g. "Write /path/to/file"),
  // used by bridges to enrich the input with file paths and to choose
  // a friendly tool name. Both flow through every lifecycle event so
  // bridges can render a consistent final tool card without tracking
  // per-call state of their own.
  | {
      type: "tool.started";
      toolCallId: string;
      toolName: string;
      input?: unknown;
      title?: string;
      // OpenCode attaches per-tool result metadata to `state.metadata`
      // (e.g. edit's `diff`/`filediff`, bash's `exitCode`). The web
      // bridge translates that into agent-elements-shaped output via
      // `lib/tools/adapters/opencode-to-agent-elements.ts`.
      metadata?: Record<string, unknown>;
    }
  | {
      type: "tool.completed";
      toolCallId: string;
      toolName: string;
      input?: unknown;
      title?: string;
      output?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "tool.error";
      toolCallId: string;
      toolName: string;
      input?: unknown;
      title?: string;
      error: string;
      metadata?: Record<string, unknown>;
    }
  | { type: "run.completed"; usage?: RuntimeUsage }
  // `error` is the brief single-line summary used for logs and the
  // classifier's pattern matching. `errorDetail` is the full pretty-
  // printed payload from the runtime (e.g. OpenCode's session.error
  // properties blob, JSON-stringified with indentation) — preserved
  // verbatim for the admin panel. Keeping them separate means the
  // user-visible rendering path and the admin-visible persistence
  // path don't fight over shape. See `lib/chat/errors.ts`.
  | { type: "run.error"; error: string; errorDetail?: string }
  | { type: "status"; status: string };

export interface AgentRuntimeAdapter {
  kind: RuntimeKind;
  createSession(
    agentId: string,
    title?: string,
  ): Promise<{ sessionExternalId: string }>;
  prompt(input: {
    agentId: string;
    sessionExternalId: string;
    message: string;
    // Optional client-abort signal. The adapter must stop streaming
    // events when this is aborted; it does NOT need to cancel the
    // upstream prompt (callers can use cancelRun for that).
    signal?: AbortSignal;
  }): AsyncIterable<RuntimeEvent>;
  listSessions(agentId: string): Promise<RuntimeSessionSummary[]>;
  getSessionMessages(input: {
    agentId: string;
    sessionExternalId: string;
  }): Promise<RuntimeMessage[]>;
  cancelRun(input: {
    agentId: string;
    sessionExternalId: string;
  }): Promise<void>;
}
