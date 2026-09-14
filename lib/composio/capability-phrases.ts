/**
 * Plain-English capability phrases for common Composio toolkits.
 *
 * Used by `buildCapabilitySummary()` to generate a human-readable
 * sentence like *"Alex can send email, post to Slack, and track
 * issues in Linear."* at the top of the integrations page.
 *
 * The whole point of this file is brand voice: the integrations
 * page would otherwise show a list of technical slugs (gmail,
 * linear, hackernews) that mean nothing to a non-technical ops
 * manager. Translating "gmail" → "send email" tells the user what
 * their agent can actually DO, not what technology it uses.
 *
 * ## Maintenance
 *
 * Only add phrases for toolkits users realistically enable. When
 * a toolkit isn't in this map, the capability summary simply
 * skips it — better to silently omit an obscure integration than
 * to generate weird fallback English like "use Hackernews". The
 * summary function handles the empty-phrase-list case by falling
 * back to a count-based message.
 *
 * ## Phrasing rules
 *
 * Every phrase must complete the sentence: "This agent can ___."
 * So: "send email" ✓, "posts to Slack" ✗, "Gmail integration" ✗.
 *
 * Keep phrases short and concrete. "send email" is better than
 * "read and send email messages using Gmail" — the sentence gets
 * long fast when there are 5+ toolkits.
 */

const PHRASES: Record<string, string> = {
  // ── Communication ────────────────────────────
  gmail: "send email",
  googlemail: "send email",
  outlook: "send email",
  slack: "post to Slack",
  discord: "post to Discord",
  telegram: "message over Telegram",
  twilio: "send SMS",
  whatsapp: "message over WhatsApp",
  microsoftteams: "post to Microsoft Teams",
  teams: "post to Microsoft Teams",

  // ── Productivity ─────────────────────────────
  googlecalendar: "schedule meetings",
  outlookcalendar: "schedule meetings",
  googledrive: "manage Google Drive files",
  googledocs: "read and edit Google Docs",
  googlesheets: "read and update spreadsheets",
  notion: "manage Notion pages",
  confluence: "edit Confluence pages",
  dropbox: "manage Dropbox files",

  // ── Project tracking ─────────────────────────
  linear: "track issues in Linear",
  jira: "manage Jira tickets",
  asana: "manage Asana tasks",
  trello: "manage Trello cards",
  clickup: "manage ClickUp tasks",
  height: "track issues in Height",
  shortcut: "manage Shortcut stories",

  // ── Development ──────────────────────────────
  github: "work with GitHub",
  gitlab: "work with GitLab",
  bitbucket: "work with Bitbucket",

  // ── CRM ──────────────────────────────────────
  hubspot: "update HubSpot",
  salesforce: "update Salesforce",
  pipedrive: "update Pipedrive",
  copper: "update Copper CRM",
  attio: "update Attio",

  // ── Support ──────────────────────────────────
  zendesk: "handle Zendesk tickets",
  intercom: "respond to Intercom conversations",
  freshdesk: "handle Freshdesk tickets",
  helpscout: "respond to Help Scout conversations",

  // ── Social & content ────────────────────────
  twitter: "post on X",
  x: "post on X",
  linkedin: "post on LinkedIn",
  buffer: "schedule social posts",
  hootsuite: "schedule social posts",

  // ── Analytics & search ──────────────────────
  composio_search: "search the web",
  perplexity: "search with Perplexity",
  tavily: "search the web",
  exa: "search with Exa",
  hackernews: "search Hacker News",

  // ── Commerce ─────────────────────────────────
  stripe: "process Stripe payments",
  shopify: "manage Shopify orders",
  square: "handle Square transactions",

  // ── Files & storage ─────────────────────────
  onedrive: "manage OneDrive files",
  box: "manage Box files",

  // ── Dev backends ─────────────────────────────
  convex: "query the Convex database",
  supabase: "query Supabase",
  postgres: "query Postgres",
  mongodb: "query MongoDB",

  // ── Data / BI ────────────────────────────────
  airtable: "update Airtable records",
  mixpanel: "query Mixpanel",
  amplitude: "query Amplitude",
  segment: "work with Segment data",
};

/**
 * Build a plain-English sentence describing what the agent can do.
 *
 * Returns:
 *   - `null` if no toolkits are enabled OR every enabled toolkit is
 *     obscure enough that we have no phrase for it AND the count-
 *     based fallback would be trivial
 *   - A sentence like "Alex can send email, post to Slack, and
 *     track issues in Linear." for the common case
 *   - A count-based fallback like "Alex has 3 integrations enabled."
 *     when we have enabled toolkits but no canned phrases for any
 *
 * ## Phrase ordering
 *
 * The phrases come out in the same order as the input `slugs`
 * array, so the caller controls ordering (e.g. alphabetical,
 * connected-first, catalog-order). We don't re-sort.
 */
export function buildCapabilitySummary(
  slugs: string[],
  agentName: string,
): string | null {
  if (slugs.length === 0) return null;

  const phrases: string[] = [];
  for (const slug of slugs) {
    const canned = PHRASES[slug.toLowerCase()];
    if (canned) phrases.push(canned);
  }

  if (phrases.length === 0) {
    // Every slug is an obscure one we don't have a phrase for —
    // fall back to the count-based message so the header is still
    // informative rather than blank.
    const n = slugs.length;
    return `${agentName} has ${n} integration${n === 1 ? "" : "s"} enabled.`;
  }

  return `${agentName} can ${formatList(phrases)}.`;
}

/**
 * Oxford-comma-joined list: `a`, `a and b`, `a, b, and c`, etc.
 * Kept local to this file to avoid pulling in a helper dependency.
 */
function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
