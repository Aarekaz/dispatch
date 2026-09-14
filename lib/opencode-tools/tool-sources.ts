/**
 * Source for OpenCode Custom Tools that live inside every agent
 * sandbox at `.opencode/tools/*.ts`. OpenCode auto-discovers files
 * in that directory at startup (1.14.x+) and exposes each default
 * export as a callable tool to the LLM.
 *
 * Why template-literal strings rather than separate `.ts` files
 * read from disk: no Vercel bundling / `outputFileTracingIncludes`
 * gymnastics, no `fs.readFileSync` on the server hot path, clear
 * diff-friendly edits, and TypeScript still compiles the rest of
 * this file even if the strings contain invalid JS (the sandbox
 * is the compilation target, not our Next.js build).
 *
 * The matching UI registration lives in
 * `components/assistant-ui/tool-uis.tsx` — toolName must match
 * whatever OpenCode emits (filename-derived for custom tools).
 */

export type ToolSource = {
  /** Path relative to the sandbox working directory. */
  path: string;
  /** TypeScript source uploaded verbatim. */
  source: string;
};

export const ENABLE_OPENCODE_CUSTOM_TOOLS =
  process.env.DISPATCH_ENABLE_OPENCODE_CUSTOM_TOOLS === "1";

/**
 * `announce_artifact` — the agent's explicit "here's something
 * the user should see" announcement. Every structured artifact
 * the agent creates (running server, generated webpage, saved
 * deliverable file) should flow through this tool.
 *
 * The tool body is intentionally trivial: it just returns a
 * confirmation string for the agent's own context. The value is
 * in the TOOL CALL itself being emitted as a runtime event —
 * `lib/runtime/opencode.ts` captures it, `lib/chat/stream-bridge.ts`
 * promotes it into a Plan task card for Slack/Telegram, and the
 * web UI's `AnnounceArtifactToolUI` pushes the payload into the
 * `AgentContext` artifacts list.
 */
const ANNOUNCE_ARTIFACT_SOURCE = `import { tool } from "@opencode-ai/plugin"

/**
 * Announce something the user should see — a running server,
 * a generated webpage, a saved deliverable file, or a report.
 *
 * CALL THIS whenever you create a user-visible artifact. The
 * user's chat UI renders announced artifacts in an "Artifacts"
 * drawer so they can click through to the preview / file.
 *
 * Do NOT call this for routine internal steps (file edits,
 * package installs, test runs). Only for user-facing outputs.
 */
export default tool({
  description:
    "Announce a user-visible artifact: a running dev server, a generated webpage, a saved file, or a report. Call this whenever you create something the user should see or open. Do NOT announce internal work like package installs, file edits, or test runs.",
  args: {
    kind: tool.schema
      .enum(["webapp", "page", "file", "report"])
      .describe(
        "webapp = a running dev server the user can open (requires port). " +
          "page = a static HTML page the agent served (requires port). " +
          "file = a saved deliverable file the user should open (requires path). " +
          "report = a Markdown report or structured text result (path or inline).",
      ),
    title: tool.schema
      .string()
      .describe("Short human-readable label, e.g. 'Q3 sales dashboard'."),
    port: tool.schema
      .number()
      .optional()
      .describe(
        "Port the dev server is listening on (required for kind=webapp or page).",
      ),
    path: tool.schema
      .string()
      .optional()
      .describe(
        "Absolute path inside the sandbox (required for kind=file or report). Example: /home/daytona/agent/workspace/report.md.",
      ),
    description: tool.schema
      .string()
      .optional()
      .describe(
        "One-sentence summary of what the user will see when they open this artifact.",
      ),
  },
  async execute(args) {
    const ref =
      args.kind === "webapp" || args.kind === "page"
        ? args.port != null
          ? \`port \${args.port}\`
          : "(missing port)"
        : args.path ?? "(missing path)";
    return \`Announced \${args.kind}: \${args.title} — \${ref}\`;
  },
});
`;

/**
 * Every tool we want uploaded to agent sandboxes. Order is stable —
 * upload via `Promise.all` is safe since each path is unique.
 */
export const OPENCODE_TOOL_SOURCES: readonly ToolSource[] = [
  ...(ENABLE_OPENCODE_CUSTOM_TOOLS
    ? [
        {
          path: ".opencode/tools/announce_artifact.ts",
          source: ANNOUNCE_ARTIFACT_SOURCE,
        },
      ]
    : []),
] as const;

/**
 * Sandbox-relative directory where Custom Tools live. Must be
 * created before file upload (Daytona's `uploadFiles` doesn't
 * auto-create parent directories).
 */
export const OPENCODE_TOOLS_DIR = ".opencode/tools";
