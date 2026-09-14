/**
 * Shared tool normalization for OpenCode → AI SDK UIMessage translation.
 * Used by BOTH the streaming chat route and the historical message loader,
 * so tool display stays consistent whether messages arrive via SSE or via
 * loading a persisted session.
 */

/** Friendly display names for OpenCode tool IDs. */
export const TOOL_LABELS: Record<string, string> = {
  bash: "Terminal",
  write: "Write File",
  edit: "Edit File",
  read: "Read File",
  glob: "Search Files",
  grep: "Search Content",
  fetch: "Web Search",
  webfetch: "Web Search",
  web_fetch: "Web Search",
  web_search: "Web Search",
  browser: "Browser",
  todowrite: "Task Progress",
  call: "Tool Call",
  // Custom tools uploaded via lib/opencode-tools/tool-sources.ts.
  // The stream-bridge overrides this with args-aware titles (e.g.
  // "Published: Sales Dashboard") — this label is the fallback when
  // args haven't arrived yet.
  announce_artifact: "Artifact",
};

/**
 * Build a descriptive task card title for `announce_artifact` calls
 * using the tool's structured args. Falls back to the generic label
 * when args are missing or malformed.
 *
 *   { kind: "webapp", title: "Sales Dashboard" } → "Published: Sales Dashboard"
 *   { kind: "file",   title: "Q3 report.md"   } → "Saved: Q3 report.md"
 *
 * Used by both the Chat SDK stream-bridge (Slack/Telegram task cards)
 * and — via the web tool-UI registration in `components/assistant-ui/
 * tool-uis.tsx` — the browser card.
 */
export function announceArtifactTitle(input: unknown): string {
  if (!input || typeof input !== "object") return "Artifact";
  const args = input as {
    kind?: string;
    title?: string;
  };
  const verb =
    args.kind === "webapp" || args.kind === "page"
      ? "Published"
      : args.kind === "file" || args.kind === "report"
        ? "Saved"
        : "Artifact";
  const title = args.title?.trim();
  return title ? `${verb}: ${title}` : verb;
}

/** Tools we filter out entirely from the chat UI. */
export const HIDDEN_TOOLS = new Set(["todoread", "todoclear"]);

/**
 * Composio Tool Router meta-tools — the 4 tools every Composio
 * session exposes for runtime tool discovery and execution. Get
 * friendly labels so users see "Searching tools…" instead of
 * `composio_COMPOSIO_SEARCH_TOOLS` in Slack cards.
 */
const COMPOSIO_META_TOOL_LABELS: Record<string, string> = {
  COMPOSIO_SEARCH_TOOLS: "Searching tools",
  COMPOSIO_GET_TOOL_SCHEMAS: "Reading tool schema",
  COMPOSIO_MULTI_EXECUTE_TOOL: "Running tool",
  COMPOSIO_MANAGE_CONNECTIONS: "Connecting account",
};

/**
 * Resolve a tool's display name. Our friendly label always wins over
 * OpenCode's title (which is frequently the generic "call").
 *
 * Special-cases Composio MCP tools (which come in prefixed with
 * `composio_` or `composio.`) so users see `"Hackernews: Get Top
 * Stories"` instead of the raw `composio_HACKERNEWS_GET_TOP_STORIES`
 * slug. Without this every Composio tool call in Slack would show
 * the SHOUTING_SNAKE_CASE slug which is ugly and technical.
 */
export function resolveToolName(rawName: string, title?: string): string {
  // Native OpenCode tool — use the friendly label.
  const nativeLabel = TOOL_LABELS[rawName];
  if (nativeLabel) return nativeLabel;

  // Composio MCP tool — prefixed `composio_` or `composio.` by OpenCode's
  // MCP namespacing. Strip the prefix, then pretty-print.
  const composioMatch = rawName.match(/^composio[._](.+)$/);
  if (composioMatch) {
    const bareName = composioMatch[1];

    // Meta-tools get hand-crafted labels.
    const metaLabel = COMPOSIO_META_TOOL_LABELS[bareName];
    if (metaLabel) return metaLabel;

    // Regular toolkit tools follow `TOOLKIT_VERB_NOUN` shape, e.g.
    // `HACKERNEWS_GET_TOP_STORIES` or `GMAIL_SEND_EMAIL`. We split on
    // the first underscore, treat the left half as the toolkit name
    // and the right half as the action.
    const firstUnderscore = bareName.indexOf("_");
    if (firstUnderscore > 0) {
      const toolkit = toTitleCase(bareName.slice(0, firstUnderscore));
      const action = toTitleCase(
        bareName.slice(firstUnderscore + 1).replace(/_/g, " "),
      );
      return `${toolkit}: ${action}`;
    }

    return toTitleCase(bareName);
  }

  return title ?? rawName;
}

/**
 * Map an OpenCode/MCP tool ID to the identifier the agent-elements
 * registry expects in the part `type` field. The renderer dispatches
 * on `tool-${ResolvedType}`:
 *
 *   tool-Bash         → BashTool
 *   tool-Edit         → EditTool
 *   tool-Write        → EditTool
 *   tool-Read         → registry GenericTool (Eye icon)
 *   tool-Grep / Glob  → SearchTool
 *   tool-WebSearch    → SearchTool
 *   tool-TodoWrite    → TodoTool
 *   tool-PlanWrite    → PlanTool
 *   tool-Task / Agent → ToolGroup (subagent collapse)
 *   tool-Thinking     → ThinkingTool
 *   tool-mcp__X__Y    → McpTool (parsed via parseMcpToolType)
 *
 * The bucketing is **substring-fuzzy** (after t3code's
 * toToolLifecycleItemType pattern) so tool variants like
 * `bash_command`, `multi_edit`, `web_fetch`, `web_search`,
 * `subagent_run`, `todowrite_v2`, etc. all land on the right
 * specialized renderer without us having to enumerate every variant.
 *
 * Composio MCP tools get re-namespaced as `mcp__composio__<bare>` so
 * `parseMcpToolType` in the registry routes them through `McpTool`
 * with a friendly display label derived from the bare action name.
 */
export function resolveToolType(rawName: string): string {
  const lower = rawName.toLowerCase();

  // Composio Tool Router → MCP namespace. The bare action keeps its
  // SHOUTING_SNAKE_CASE so McpTool's `displayName` derivation
  // (replace _ with space, title-case) renders nicely.
  const composio = rawName.match(/^composio[._](.+)$/);
  if (composio) return `mcp__composio__${composio[1]}`;

  // Other MCP namespaces (e.g. mcp_filesystem_read_file) — preserve
  // the server/tool split using `__` as the agent-elements separator.
  const mcp = rawName.match(/^mcp[._]([^._]+)[._](.+)$/);
  if (mcp) return `mcp__${mcp[1]}__${mcp[2]}`;

  // Subagent / collaboration tools.
  if (lower === "task" || lower === "agent") return "Task";
  if (lower.includes("subagent") || lower.includes("subtask")) return "Task";

  // Bash / shell variants.
  if (lower === "bash" || lower.includes("shell") || lower.includes("command")) return "Bash";

  // Filesystem write/edit. Order matters: multiedit must lose to edit
  // because the registry has only one renderer (EditTool) for both,
  // and we want write→tool-Write so the registry can later
  // differentiate by part type if it grows. multiedit→Edit.
  if (lower.includes("multiedit") || lower.includes("multi_edit") || lower.includes("patch") || lower.includes("apply_diff")) return "Edit";
  if (lower === "edit" || lower.includes("str_replace")) return "Edit";
  if (lower === "write" || lower.includes("create_file")) return "Write";

  // Filesystem read.
  if (lower === "read" || lower.includes("view_file") || lower === "cat") return "Read";

  // Search.
  if (lower === "glob" || lower.includes("find_files")) return "Glob";
  if (lower === "grep" || lower.includes("search_content") || lower.includes("ripgrep")) return "Grep";

  // Web.
  if (lower === "fetch" || lower.includes("webfetch") || lower.includes("web_fetch") || lower.includes("web_search") || lower === "websearch" || lower.includes("browse")) return "WebSearch";

  // Todo / plan.
  if (lower.includes("todowrite") || lower.includes("todo_write")) return "TodoWrite";
  if (lower.includes("planwrite") || lower.includes("plan_write")) return "PlanWrite";

  // Reasoning / thinking.
  if (lower.includes("thinking") || lower === "think") return "Thinking";

  // Question / clarification (matches the agent-elements QuestionTool).
  if (lower === "question" || lower.includes("ask_question") || lower.includes("clarify")) return "Question";

  // Fallback: PascalCase the raw id so it's a valid part type and the
  // registry's named-fallback can title-case it.
  return toPascal(rawName);
}

function toPascal(s: string): string {
  return s
    .split(/[\s_\-./]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * Enrich tool input with a file path extracted from the title or output.
 *
 * OpenCode often omits file_path from state.input but includes it
 * in state.title (e.g., "Write /home/daytona/agent/file.md") or
 * state.output. We try multiple patterns:
 *   1. Absolute path: /home/daytona/agent/memories/MEMORY.md
 *   2. Home-relative: ~/agent/memories/MEMORY.md
 *   3. Bare filename with extension: MEMORY.md, profile.md
 */
export function enrichArgsWithPath(
  input: Record<string, unknown>,
  title?: string,
  output?: string,
): Record<string, unknown> {
  if (input.file_path || input.path || input.filePath || input.file) {
    return input;
  }

  const extracted = extractFilePath(title) ?? extractFilePath(output);
  if (extracted) return { ...input, file_path: extracted };
  return input;
}

function extractFilePath(text?: string): string | null {
  if (!text) return null;
  // Absolute path: /home/daytona/agent/file.md
  const abs = text.match(/(\/[\w./-]+\.\w{1,6})/);
  if (abs) return abs[1];
  // Home-relative: ~/agent/memories/file.md
  const home = text.match(/(~\/[\w./-]+\.\w{1,6})/);
  if (home) return home[1];
  // Bare filename: MEMORY.md, profile.md (only if it looks like a file)
  const bare = text.match(/\b([\w.-]+\.\w{1,6})\b/);
  if (bare) return bare[1];
  return null;
}
