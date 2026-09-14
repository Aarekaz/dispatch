/**
 * Reshape OpenCode tool inputs/outputs into the Claude-Agent-SDK
 * conventions that the agent-elements registry expects.
 *
 * agent-elements (and the Claude Agent SDK it was built for) reads:
 *   Bash      → input.command          | output { stdout, stderr, exitCode } or string
 *   Read      → input.file_path
 *   Write     → input.file_path, input.content
 *   Edit      → input.file_path, input.old_string, input.new_string
 *               | output.structuredPatch[ { lines: ['+...', '-...', ' ...'] } ]
 *   Grep      → input.pattern, input.path | output.numFiles
 *   Glob      → input.pattern, input.path | output.numFiles
 *   WebSearch → input.query OR input.pattern
 *   TodoWrite → input.todos[ { id, content, status, priority } ]
 *   Thinking  → input.thought
 *
 * OpenCode emits camelCase variants (`filePath`, `oldString`, `newString`),
 * a raw newline-joined string for search outputs, and stashes a real diff
 * in `state.metadata.diff` for edit. This adapter renames + reshapes
 * without mutating the inputs (originals stay on the part for the
 * "Show request / response" debug panel).
 */

import { parsePatch, structuredPatch } from "diff";

type Json = Record<string, unknown>;

/** Add Claude-SDK-shaped aliases to OpenCode's camelCase tool input. */
export function adaptOpenCodeToolInput(
  rawName: string,
  input: unknown,
): Json {
  if (!input || typeof input !== "object") return {};
  const src = input as Json;
  const out: Json = { ...src };

  if (typeof src.filePath === "string" && out.file_path === undefined) {
    out.file_path = src.filePath;
  }
  if (typeof src.oldString === "string" && out.old_string === undefined) {
    out.old_string = src.oldString;
  }
  if (typeof src.newString === "string" && out.new_string === undefined) {
    out.new_string = src.newString;
  }

  // webfetch ships `url`; SearchTool only extracts `query`/`pattern`.
  // Aliasing here lets the same SearchTool branch render the URL.
  if (
    /^(web_?fetch|fetch|browser)$/i.test(rawName) &&
    typeof src.url === "string" &&
    out.query === undefined
  ) {
    out.query = src.url;
  }

  return out;
}

/**
 * Reshape OpenCode tool output to what each agent-elements renderer
 * reads. Returns the original output unchanged when no remapping
 * applies, so MCP/Task/Thinking/etc. pass through untouched.
 *
 * `metadata` carries OpenCode's per-tool result detail (edit's diff,
 * bash's exit code, etc.) — see `lib/runtime/opencode.ts`.
 */
export function adaptOpenCodeToolOutput(
  rawName: string,
  input: Json,
  output: unknown,
  metadata?: Record<string, unknown>,
): unknown {
  const lower = rawName.toLowerCase();

  // Edit / Write — produce a `structuredPatch` so EditTool renders a
  // real diff body instead of just a filename + line count.
  if (lower === "edit" || lower === "multiedit" || lower === "patch" || lower === "apply_patch") {
    const patch = buildStructuredPatch({
      diffString:
        typeof metadata?.diff === "string" ? metadata.diff : undefined,
      filePath: stringOf(input.file_path ?? input.filePath),
      oldString: stringOf(input.old_string ?? input.oldString),
      newString: stringOf(input.new_string ?? input.newString),
    });
    if (patch) {
      return {
        ...(typeof output === "object" && output != null ? (output as Json) : {}),
        ...(typeof output === "string" && output ? { content: output } : {}),
        structuredPatch: patch,
      };
    }
    return output;
  }

  // Grep / Glob — string of newline-separated paths into { numFiles, results }
  // so the registry's title functions ("Grepped N files" / "Found N files")
  // render correctly.
  if (lower === "grep" || lower === "glob" || lower === "list" || lower === "find_files") {
    if (typeof output === "string") {
      const lines = output
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 &&
            !l.startsWith("(") /* skip "(Results are truncated...)" */,
        );
      return {
        numFiles: lines.length,
        results: lines,
        // Keep the raw text for the "Show request / response" panel.
        content: output,
      };
    }
    return output;
  }

  // Bash — pass-through string. The mapper in tool-adapters.ts handles a
  // bare string by stuffing it into `bashOutput`. If OpenCode ever
  // surfaces an exit code on metadata we wrap so EditTool's success
  // styling kicks in.
  if (lower === "bash" || lower === "shell" || lower === "command") {
    if (typeof output === "string") {
      const exitCode = numberOf(metadata?.exitCode ?? metadata?.exit_code);
      if (exitCode !== undefined) {
        return { stdout: output, stderr: "", exitCode };
      }
    }
    return output;
  }

  // WebSearch / WebFetch — if output is a string body, expose a single
  // synthetic result so SearchTool can show the URL + a snippet.
  if (lower === "websearch" || lower === "web_search" || lower === "webfetch" || lower === "web_fetch" || lower === "fetch") {
    if (typeof output === "string" && stringOf(input.url ?? input.query)) {
      const url = stringOf(input.url ?? input.query) ?? "";
      const snippet =
        output.length > 240 ? output.slice(0, 240) + "…" : output;
      return {
        results: [{ title: url, url, snippet }],
        content: output,
      };
    }
    return output;
  }

  return output;
}

function stringOf(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function numberOf(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Best-effort `structuredPatch` synthesis. Prefer OpenCode's
 * `state.metadata.diff` (a real unified diff) parsed via `diff`'s
 * `parsePatch`. Fall back to running `structuredPatch` over the
 * input old/new strings (cheap and gives the EditTool everything it
 * needs to render +/- counts and a diff body).
 */
function buildStructuredPatch({
  diffString,
  filePath,
  oldString,
  newString,
}: {
  diffString?: string;
  filePath?: string;
  oldString?: string;
  newString?: string;
}): Array<{ lines?: string[] }> | undefined {
  if (diffString) {
    try {
      const parsed = parsePatch(diffString);
      const hunks = parsed.flatMap((p) => p.hunks ?? []);
      if (hunks.length > 0) return hunks.map((h) => ({ lines: h.lines }));
    } catch {
      // fall through to synthesis
    }
  }
  if (oldString === undefined || newString === undefined) return undefined;
  const fname = filePath ?? "edit";
  try {
    const synthesized = structuredPatch(fname, fname, oldString, newString, "old", "new", {
      context: 3,
    });
    if (!synthesized?.hunks?.length) return undefined;
    return synthesized.hunks.map((h) => ({ lines: h.lines }));
  } catch {
    return undefined;
  }
}
