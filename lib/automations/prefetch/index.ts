/**
 * Server-side prefetch engine for automations.
 *
 * Before the agent runs, this module fetches data from external
 * services using Composio's direct `tools.execute()` API. Results
 * are formatted as human-readable markdown and injected as
 * `contextMessage` into the agent's prompt.
 *
 * The agent never touches external APIs — it just reasons about
 * the pre-fetched data. This is Architecture B.
 *
 * Pattern reference: lib/automations/triggers/channel-scanner.ts
 * already does this for Slack (via native API). This module
 * generalizes the pattern to Composio-backed services.
 */
import { getComposio } from "@/lib/composio/client";
import { composioIdentityFor } from "@/lib/composio/session";
import {
  formatGmailResult,
  formatGithubPRsResult,
  formatGithubIssuesResult,
  formatLinearResult,
} from "./formatters";

export type PrefetchResult =
  | { ok: true; contextMessage: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/**
 * Execute a prefetch for a single trigger. Returns formatted context
 * or a soft-fail error. Never throws.
 */
export async function executePrefetch(params: {
  trigger: { type: string; config: Record<string, unknown> };
  userId: string;
  agentId: string;
}): Promise<PrefetchResult> {
  const start = Date.now();
  const identity = composioIdentityFor(params.userId, params.agentId);

  try {
    const composio = getComposio();
    const { type, config } = params.trigger;

    switch (type) {
      case "composio.gmail.inbox":
        return await prefetchGmail(composio, identity, config, start);
      case "composio.github.activity":
        return await prefetchGithub(composio, identity, config, start);
      case "composio.linear.issues":
        return await prefetchLinear(composio, identity, config, start);
      default:
        return { ok: false, error: `Unknown trigger type: ${type}`, durationMs: Date.now() - start };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[prefetch] ${params.trigger.type} failed:`, msg);
    return { ok: false, error: msg, durationMs: Date.now() - start };
  }
}

// ── Gmail ────────────────────────────────────────────────

async function prefetchGmail(
  composio: ReturnType<typeof getComposio>,
  identity: string,
  config: Record<string, unknown>,
  start: number,
): Promise<PrefetchResult> {
  const hoursBack = Number(config.hoursBack ?? 24);
  const maxResults = Number(config.maxResults ?? 20);

  const result = await composio.tools.execute("GMAIL_FETCH_EMAILS", {
    userId: identity,
    arguments: {
      query: `newer_than:${hoursBack}h`,
      max_results: maxResults,
    },
    dangerouslySkipVersionCheck: true,
  });

  const formatted = formatGmailResult(result);
  return {
    ok: true,
    contextMessage: withPreamble("Gmail", hoursBack, formatted),
    durationMs: Date.now() - start,
  };
}

// ── GitHub ───────────────────────────────────────────────

async function prefetchGithub(
  composio: ReturnType<typeof getComposio>,
  identity: string,
  config: Record<string, unknown>,
  start: number,
): Promise<PrefetchResult> {
  const owner = String(config.owner ?? "");
  const repo = String(config.repo ?? "");
  const includePRs = config.includePRs !== false;
  const includeIssues = config.includeIssues !== false;

  if (!owner || !repo) {
    return { ok: false, error: "GitHub trigger requires owner and repo", durationMs: Date.now() - start };
  }

  const fetches: Array<Promise<{ type: string; data: unknown }>> = [];

  if (includePRs) {
    fetches.push(
      composio.tools.execute("GITHUB_LIST_PULL_REQUESTS", {
        userId: identity,
        arguments: { owner, repo, state: "open", per_page: 20 },
        dangerouslySkipVersionCheck: true,
      }).then((data) => ({ type: "prs", data })),
    );
  }

  if (includeIssues) {
    fetches.push(
      composio.tools.execute("GITHUB_LIST_REPOSITORY_ISSUES", {
        userId: identity,
        arguments: { owner, repo, state: "open", per_page: 20 },
        dangerouslySkipVersionCheck: true,
      }).then((data) => ({ type: "issues", data })),
    );
  }

  const results = await Promise.allSettled(fetches);
  const sections: string[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { type, data } = result.value;
    if (type === "prs") sections.push(formatGithubPRsResult(data));
    if (type === "issues") sections.push(formatGithubIssuesResult(data));
  }

  if (sections.length === 0) {
    return { ok: false, error: "No GitHub data fetched", durationMs: Date.now() - start };
  }

  return {
    ok: true,
    contextMessage: withPreamble("GitHub", null, sections.join("\n\n")),
    durationMs: Date.now() - start,
  };
}

// ── Linear ───────────────────────────────────────────────

async function prefetchLinear(
  composio: ReturnType<typeof getComposio>,
  identity: string,
  config: Record<string, unknown>,
  start: number,
): Promise<PrefetchResult> {
  const maxResults = Number(config.maxResults ?? 25);

  const result = await composio.tools.execute("LINEAR_SEARCH_ISSUES", {
    userId: identity,
    arguments: {
      limit: maxResults,
    },
    dangerouslySkipVersionCheck: true,
  });

  const formatted = formatLinearResult(result);
  return {
    ok: true,
    contextMessage: withPreamble("Linear", null, formatted),
    durationMs: Date.now() - start,
  };
}

// ── Helpers ──────────────────────────────────────────────

function withPreamble(source: string, hoursBack: number | null, content: string): string {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const timeRange = hoursBack ? ` (last ${hoursBack}h)` : "";
  return [
    `Data fetched from ${source}${timeRange} at ${timestamp}.`,
    "Review this data and follow the instructions below.\n",
    content,
  ].join("\n");
}
