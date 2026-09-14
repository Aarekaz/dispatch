import { perfLog } from "@/lib/perf";
import {
  DEFAULT_MODEL,
  getModel,
  getOpenCodeModelMap,
  getOpenCodeModelRef,
} from "@/lib/models";
import { ENABLE_OPENCODE_CUSTOM_TOOLS } from "@/lib/opencode-tools/tool-sources";

export type AgentContext = {
  name?: string;
  model?: string;
  persona?: string;
  toolPermissions?: string;
  userId?: string;
  agentId?: string;
  composioToolkits?: string[];
  serverPassword?: string;
};

export type SandboxContext = {
  memoryIndex: string | null;
  knowledgeFiles: Array<{ name: string; size: string }>;
};

type SandboxFileEntry = {
  isDir?: boolean;
  name?: string;
  path?: string;
  size?: number;
};

type SandboxFsLike = {
  fs: {
    downloadFile(path: string): Promise<string | Buffer>;
    listFiles(path: string): Promise<SandboxFileEntry[]>;
  };
};

export function agentContextFromRow(
  row: {
    name?: string;
    model?: string;
    persona?: string;
    toolPermissions?: string;
    userId?: unknown;
    composioToolkits?: string[];
    serverPassword?: string;
  },
  agentId: string,
): AgentContext {
  return {
    name: row.name,
    model: row.model,
    persona: row.persona,
    toolPermissions: row.toolPermissions,
    userId: row.userId as string | undefined,
    agentId,
    composioToolkits: row.composioToolkits,
    serverPassword: row.serverPassword,
  };
}

function resolveModelRef(modelId?: string): string {
  const normalizedModelId = getModel(modelId ?? "")?.id ?? DEFAULT_MODEL.id;
  return getOpenCodeModelRef(normalizedModelId);
}

export async function readSandboxContext(
  sandbox: SandboxFsLike,
): Promise<SandboxContext> {
  const result: SandboxContext = { memoryIndex: null, knowledgeFiles: [] };

  try {
    const buffer = await sandbox.fs.downloadFile(
      "/home/daytona/agent/memories/MEMORY.md",
    );
    const content = typeof buffer === "string" ? buffer : buffer.toString("utf-8");
    if (content && content.length > 100 && !content.includes("No memories yet")) {
      result.memoryIndex = truncateMemory(content);
    }
  } catch {
    // File doesn't exist or sandbox FS unavailable — graceful skip.
  }

  try {
    const entries = await sandbox.fs.listFiles("/home/daytona/agent/knowledge");
    if (Array.isArray(entries)) {
      result.knowledgeFiles = entries
        .filter((entry) => !entry.isDir)
        .map((entry) => ({
          name: entry.name ?? entry.path?.split("/").pop() ?? "unknown",
          size: formatFileSize(entry.size ?? 0),
        }));
    }
  } catch {
    // Directory doesn't exist or listing failed — graceful skip.
  }

  return result;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function truncateMemory(content: string): string {
  const MAX_LINES = 80;
  const MAX_BYTES = 4_000;
  let result = content;

  const lines = result.split("\n");
  if (lines.length > MAX_LINES) {
    result = lines.slice(0, MAX_LINES).join("\n") + "\n\n... (truncated)";
  }

  const byteLen = Buffer.byteLength(result, "utf-8");
  if (byteLen > MAX_BYTES) {
    const buf = Buffer.from(result, "utf-8").subarray(0, MAX_BYTES);
    const str = buf.toString("utf-8");
    const nl = str.lastIndexOf("\n");
    result = (nl > 0 ? str.slice(0, nl) : str) + "\n\n... (truncated)";
  }

  return result;
}

function buildBootstrapPrompt(
  previewUrlPattern: string,
  agent?: AgentContext,
  composioMcp?: { url: string; headers: Record<string, string> } | null,
  sandboxCtx?: SandboxContext | null,
  hasSlackToken = false,
): string {
  const sections: string[] = [];

  sections.push(
    agent?.name
      ? `You are ${agent.name}, an AI agent powered by Dispatch.`
      : "You are an AI agent powered by Dispatch.",
  );

  sections.push(
    "Your reply is delivered automatically to the user's channel — never call a tool to send a reply.",
    `Preview URLs: ${previewUrlPattern}. Start servers with 'nohup <command> &'.`,
    "Use targeted glob patterns when searching files. Never traverse node_modules or build directories.",
    "The current date/time is provided in each message context. Use it directly — do NOT run `date` in bash to check the time.",
    "Narrow every query and cap every result set. Fetch 10 items, not 100. Filter server-side (by sender, label, date, status) before returning. Pipe large shell output through `head`, `tail`, or `grep`. Dumping full lists into your own context wastes your budget and makes future turns slower.",
  );

  if (ENABLE_OPENCODE_CUSTOM_TOOLS) {
    sections.push(
      [
        "When you produce something the user should open or see, CALL the `announce_artifact` tool. The user's UI renders these as clickable cards in an Artifacts drawer.",
        "Call it for:",
        "• A dev server you just started (kind: 'webapp', port: the port you used, title: short name)",
        "• A generated webpage served from the sandbox (kind: 'page', port: ...)",
        "• A saved deliverable file (kind: 'file', path: absolute /home/daytona/agent/... path)",
        "• A Markdown report or structured result (kind: 'report', path: ...)",
        "Do NOT announce: package installs, dependency fetches, test runs, routine file edits, or internal scratch files. Only user-facing outputs.",
      ].join("\n"),
    );
  }

  if (sandboxCtx?.memoryIndex) {
    sections.push(
      `\n## Your Memory (from ~/agent/memories/MEMORY.md)\n${sandboxCtx.memoryIndex}`,
    );
  } else {
    sections.push(
      "Read ~/agent/memories/MEMORY.md for your persistent memory when starting significant tasks.",
    );
  }

  if (sandboxCtx?.knowledgeFiles && sandboxCtx.knowledgeFiles.length > 0) {
    const listing = sandboxCtx.knowledgeFiles
      .map((file) => `- ${file.name} (${file.size})`)
      .join("\n");
    sections.push(
      `\n## Available Reference Docs (~/agent/knowledge/)\n${listing}\nRead these with \`cat ~/agent/knowledge/<filename>\` when relevant to the user's question.`,
    );
  }

  if (composioMcp && agent?.composioToolkits && agent.composioToolkits.length > 0) {
    sections.push(
      `External tools via Composio: ${agent.composioToolkits.join(", ")}.\n` +
        "When you need data from these services, call composio_COMPOSIO_SEARCH_TOOLS first to discover available actions.\n" +
        "NEVER search the filesystem for emails, Slack messages, GitHub data, or API credentials — your tools are provided via the Composio MCP server.\n" +
        "If data was pre-fetched and provided in your prompt, analyze it directly — do not re-fetch it.\n" +
        "Only use toolkits in this list.",
    );
  }

  if (hasSlackToken) {
    sections.push(
      [
        `\n## Slack capability`,
        `Your Slack bot token is available as $SLACK_BOT_TOKEN in the bash environment.`,
        ``,
        `To search the workspace history (public channels):`,
        `  curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \\`,
        `    "https://slack.com/api/search.messages?query=<URL_ENCODED_QUERY>&count=20&sort=timestamp"`,
        ``,
        `To read recent messages from a channel the bot is in:`,
        `  curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \\`,
        `    "https://slack.com/api/conversations.history?channel=<CHANNEL_ID>&limit=30"`,
        ``,
        `Responses are JSON — pipe through \`jq\` for readable output.`,
        `If a call returns \`{"ok":false,"error":"missing_scope"}\`, tell the user their Slack install needs the \`search:read.public\` scope and link them to reinstall in Connect.`,
        ``,
        `DO NOT use curl to SEND Slack messages — your reply is delivered automatically.`,
      ].join("\n"),
    );
  }

  sections.push(
    "Read ~/agent/AGENTS.md for your full configuration, persona, tool permissions, and detailed instructions.",
  );

  return sections.join("\n\n");
}

export function buildOpenCodeConfig(
  previewUrlPattern: string,
  agent?: AgentContext,
  composioMcp?: { url: string; headers: Record<string, string> } | null,
  sandboxCtx?: SandboxContext | null,
  hasSlackToken = false,
): Record<string, unknown> {
  const modelRef = resolveModelRef(agent?.model);
  const mcpBlock: Record<string, unknown> = composioMcp
    ? {
        mcp: {
          composio: {
            type: "remote",
            url: composioMcp.url,
            headers: composioMcp.headers,
            enabled: true,
          },
        },
      }
    : {};

  const bootstrapPrompt = buildBootstrapPrompt(
    previewUrlPattern,
    agent,
    composioMcp,
    sandboxCtx,
    hasSlackToken,
  );

  const systemPromptBytes = Buffer.byteLength(bootstrapPrompt, "utf-8");
  const memoryInjectedBytes = sandboxCtx?.memoryIndex
    ? Buffer.byteLength(sandboxCtx.memoryIndex, "utf-8")
    : 0;
  const knowledgeManifestBytes = sandboxCtx?.knowledgeFiles
    ? sandboxCtx.knowledgeFiles.reduce(
        (sum, file) => sum + file.name.length + file.size.length + 5,
        0,
      )
    : 0;
  perfLog("ensure-running:context-footprint", {
    sandboxId: agent?.agentId?.slice(0, 8),
    systemPromptBytes,
    memoryInjectedBytes,
    knowledgeManifestBytes,
    toolkitCount: agent?.composioToolkits?.length ?? 0,
    hasSlackToken,
    approxSystemTokens: Math.round(
      (systemPromptBytes + memoryInjectedBytes + knowledgeManifestBytes) / 4,
    ),
  });

  return {
    $schema: "https://opencode.ai/config.json",
    model: modelRef,
    small_model: modelRef,
    provider: {
      openrouter: {
        npm: "@openrouter/ai-sdk-provider",
        name: "OpenRouter",
        options: {
          apiKey: process.env.OPENROUTER_API_KEY ?? "",
        },
        models: getOpenCodeModelMap(),
      },
    },
    default_agent: "daytona",
    agent: {
      daytona: {
        model: modelRef,
        description: agent?.name
          ? `${agent.name} — Dispatch AI agent`
          : "Dispatch AI agent",
        mode: "primary",
        prompt: bootstrapPrompt,
      },
    },
    ...mcpBlock,
  };
}
