/**
 * Prefetch result formatters.
 *
 * Pure functions that convert raw Composio tool execution results
 * into human-readable markdown. The agent receives this formatted
 * text as context — it never sees the raw JSON.
 *
 * Each formatter must handle malformed or missing data gracefully.
 * Return "No data available" rather than throwing.
 */

// ── Gmail ────────────────────────────────────────────────

export function formatGmailResult(raw: unknown): string {
  const data = raw as Record<string, unknown> | undefined;
  if (!data) return "No emails found.";

  // Composio's GMAIL_FETCH_EMAILS returns different shapes depending
  // on version. Try common paths defensively.
  const messages = extractArray(data, "messages") ?? extractArray(data, "data") ?? [];
  if (messages.length === 0) return "No emails found in the requested timeframe.";

  const lines: string[] = ["## Recent Emails\n"];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Record<string, unknown>;
    const subject = str(msg, "subject") || str(msg, "Subject") || "(no subject)";
    const from = str(msg, "from") || str(msg, "sender") || str(msg, "From") || "Unknown";
    const date = str(msg, "date") || str(msg, "receivedAt") || str(msg, "Date") || "";
    const snippet = str(msg, "snippet") || str(msg, "body") || str(msg, "preview") || "";
    const preview = snippet.length > 200 ? snippet.slice(0, 200) + "…" : snippet;

    lines.push(`### ${i + 1}. ${subject}`);
    lines.push(`From: ${from}${date ? ` | ${date}` : ""}`);
    if (preview) lines.push(`> ${preview}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── GitHub PRs ───────────────────────────────────────────

export function formatGithubPRsResult(raw: unknown): string {
  const data = raw as Record<string, unknown> | undefined;
  if (!data) return "No pull requests found.";

  const prs = extractArray(data, "items") ?? extractArray(data, "data") ?? extractArray(data, "pull_requests") ?? [];
  if (prs.length === 0) return "No open pull requests.";

  const lines: string[] = ["## Open Pull Requests\n"];

  for (const pr of prs) {
    const p = pr as Record<string, unknown>;
    const title = str(p, "title") || "(untitled)";
    const number = p.number ?? p.id ?? "";
    const author = str(p, "user") || str(p, "author") || "";
    const state = str(p, "state") || "open";
    const created = str(p, "created_at") || str(p, "createdAt") || "";
    const draft = p.draft === true ? " (draft)" : "";

    lines.push(`- **#${number}** ${title}${draft}`);
    if (author || state !== "open") {
      lines.push(`  by ${author}${state !== "open" ? ` · ${state}` : ""}${created ? ` · ${created}` : ""}`);
    }
  }

  return lines.join("\n");
}

// ── GitHub Issues ────────────────────────────────────────

export function formatGithubIssuesResult(raw: unknown): string {
  const data = raw as Record<string, unknown> | undefined;
  if (!data) return "No issues found.";

  const issues = extractArray(data, "items") ?? extractArray(data, "data") ?? extractArray(data, "issues") ?? [];
  if (issues.length === 0) return "No recent issues.";

  const lines: string[] = ["## Recent Issues\n"];

  for (const issue of issues) {
    const iss = issue as Record<string, unknown>;
    const title = str(iss, "title") || "(untitled)";
    const number = iss.number ?? iss.id ?? "";
    const author = str(iss, "user") || str(iss, "author") || "";
    const state = str(iss, "state") || "open";
    const labels = extractArray(iss, "labels")
      ?.map((l) => str(l as Record<string, unknown>, "name") || String(l))
      .filter(Boolean)
      .join(", ");

    lines.push(`- **#${number}** ${title}`);
    const meta = [author, state !== "open" ? state : "", labels].filter(Boolean).join(" · ");
    if (meta) lines.push(`  ${meta}`);
  }

  return lines.join("\n");
}

// ── Linear Issues ────────────────────────────────────────

export function formatLinearResult(raw: unknown): string {
  const data = raw as Record<string, unknown> | undefined;
  if (!data) return "No issues found.";

  const issues = extractArray(data, "issues") ?? extractArray(data, "data") ?? extractArray(data, "nodes") ?? [];
  if (issues.length === 0) return "No recent Linear issues.";

  const lines: string[] = ["## Linear Issues\n"];

  for (const issue of issues) {
    const iss = issue as Record<string, unknown>;
    const title = str(iss, "title") || "(untitled)";
    const identifier = str(iss, "identifier") || str(iss, "id") || "";
    const state = str(iss, "state") || str(iss, "status") || "";
    const priority = iss.priority != null ? `P${iss.priority}` : "";
    const assignee = str(iss, "assignee") || str(iss, "assigneeName") || "";

    const prefix = identifier ? `**${identifier}**` : "-";
    lines.push(`- ${prefix} ${title}`);
    const meta = [state, priority, assignee ? `→ ${assignee}` : ""].filter(Boolean).join(" · ");
    if (meta) lines.push(`  ${meta}`);
  }

  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────

function extractArray(obj: Record<string, unknown>, key: string): unknown[] | undefined {
  const val = obj[key];
  return Array.isArray(val) ? val : undefined;
}

function str(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "name" in val) {
    return String((val as { name?: unknown }).name ?? "");
  }
  return "";
}
