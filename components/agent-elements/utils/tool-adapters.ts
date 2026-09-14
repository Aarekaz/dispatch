import type { TimelineStep, StepState } from "../types/timeline";

type BashLikeResult = {
  stdout?: string;
  output?: string;
  stderr?: string;
  exitCode?: number;
  exit_code?: number;
};

type WriteLikeResult = {
  content?: string;
};

type EditLikeResult = {
  structuredPatch?: Array<{ lines?: string[] }>;
};

function calculateDiffStatsFromPatch(
  patches: Array<{ lines?: string[] }>,
): string | undefined {
  let addedLines = 0;
  let removedLines = 0;

  for (const patch of patches) {
    if (!patch.lines) continue;
    for (const line of patch.lines) {
      if (line.startsWith("+")) addedLines++;
      else if (line.startsWith("-")) removedLines++;
    }
  }

  if (addedLines === 0 && removedLines === 0) return undefined;

  const parts: string[] = [];
  if (addedLines > 0) parts.push(`+${addedLines}`);
  if (removedLines > 0) parts.push(`-${removedLines}`);
  return parts.join(" ");
}

function getDiffLinesFromPatch(
  patches: Array<{ lines?: string[] }>,
): { type: "add" | "remove" | "context"; content: string }[] {
  const result: { type: "add" | "remove" | "context"; content: string }[] = [];

  for (const patch of patches) {
    if (!patch.lines) continue;
    for (const line of patch.lines) {
      if (line.startsWith("+")) {
        result.push({ type: "add", content: line.slice(1) });
      } else if (line.startsWith("-")) {
        result.push({ type: "remove", content: line.slice(1) });
      } else if (line.startsWith(" ")) {
        result.push({ type: "context", content: line.slice(1) });
      }
    }
  }

  return result;
}

export function mapToolStateToStepState(
  aiState: "partial-call" | "call" | "result",
): StepState {
  return aiState === "result" ? "complete" : "animating";
}

export function mapToolNameToVariant(
  toolName: string,
): "thinking" | "action" | "search" | undefined {
  const lower = toolName.toLowerCase();
  if (lower === "thinking" || lower === "reasoning") return "thinking";
  if (
    lower === "websearch" ||
    lower === "web_search" ||
    lower === "grep" ||
    lower === "glob" ||
    lower === "webfetch" ||
    lower === "web_fetch"
  )
    return "search";
  return undefined;
}

function extractToolDetail(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "Bash":
      return args?.command ? String(args.command).slice(0, 80) : "";
    case "Edit":
    case "Write":
    case "Read":
      return args?.file_path
        ? (String(args.file_path).split("/").pop() ?? "")
        : "";
    case "Grep":
      return args?.pattern ? String(args.pattern) : "";
    case "Glob":
      return args?.pattern ? String(args.pattern) : "";
    case "WebSearch":
    case "web_search":
      return args?.query ? String(args.query) : "";
    case "WebFetch":
    case "web_fetch":
      return args?.url ? String(args.url).slice(0, 60) : "";
    default:
      return "";
  }
}

export function mapToolInvocationToStep(
  toolCallId: string,
  toolInvocation: {
    toolName: string;
    args?: Record<string, unknown>;
    state: "partial-call" | "call" | "result";
    result?: unknown;
  },
): Extract<TimelineStep, { type: "tool-call" }> {
  const { toolName, args = {}, result } = toolInvocation;
  const displayToolName =
    toolName === "PlanWrite"
      ? "Plan"
      : toolName === "TodoWrite"
        ? "Todo"
        : toolName;
  const detail = extractToolDetail(toolName, args);
  const objectResult =
    typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : undefined;

  const step: Extract<TimelineStep, { type: "tool-call" }> = {
    id: toolCallId,
    type: "tool-call",
    toolName: displayToolName,
    toolDetail: detail,
    duration: Number.MAX_SAFE_INTEGER,
    toolVariant: mapToolNameToVariant(toolName),
  };

  if (toolName === "Bash") {
    step.bashCommand = args?.command ? String(args.command) : undefined;
    if (toolInvocation.state === "result" && result) {
      if (typeof result === "string") {
        step.bashOutput = result;
        step.bashSuccess = true;
      } else if (objectResult) {
        const bashResult = objectResult as BashLikeResult;
        const stdout =
          typeof bashResult.stdout === "string"
            ? bashResult.stdout
            : typeof bashResult.output === "string"
              ? bashResult.output
              : "";
        const stderr =
          typeof bashResult.stderr === "string" ? bashResult.stderr : "";
        step.bashOutput = [stdout, stderr]
          .filter(Boolean)
          .join(stdout && stderr ? "\n" : "");
        const exitCode = bashResult.exitCode ?? bashResult.exit_code;
        step.bashSuccess = exitCode === undefined ? true : exitCode === 0;
      } else {
        step.bashOutput = JSON.stringify(result);
        step.bashSuccess = true;
      }
    }
  }

  if (toolName === "Edit" || toolName === "Write" || toolName === "Read") {
    step.filePath = args?.file_path ? String(args.file_path) : undefined;
  }

  if (toolName === "Write") {
    const content =
      typeof (objectResult as WriteLikeResult | undefined)?.content === "string"
        ? (objectResult as WriteLikeResult).content
        : typeof args?.content === "string"
          ? args.content
          : "";

    if (content) {
      const lines = content.split("\n");
      step.diffStats = `+${lines.length}`;
      step.diffLines = lines.map((line: string) => ({
        type: "add",
        content: line,
      }));
    }
  }

  const editResult = objectResult as EditLikeResult | undefined;
  if (toolName === "Edit" && Array.isArray(editResult?.structuredPatch)) {
    step.diffStats = calculateDiffStatsFromPatch(editResult.structuredPatch);
    step.diffLines = getDiffLinesFromPatch(editResult.structuredPatch);
  }

  if (
    toolName === "WebSearch" ||
    toolName === "web_search" ||
    toolName === "Grep" ||
    toolName === "Glob"
  ) {
    step.searchQuery =
      (args?.query ?? args?.pattern)
        ? String(args?.query ?? args?.pattern)
        : undefined;
    step.searchSource =
      toolName === "WebSearch" || toolName === "web_search" ? "web" : "code";
  }

  if (
    toolName.toLowerCase() === "thinking" ||
    toolName.toLowerCase() === "reasoning"
  ) {
    step.thoughtContent =
      typeof args?.thought === "string"
        ? args.thought
        : typeof result === "string"
          ? result
          : undefined;
  }

  return step;
}
