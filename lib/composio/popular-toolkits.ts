/**
 * Hand-curated "Popular" tab ordering for the integrations page.
 *
 * Why hand-curated instead of reading a `popular` flag from the
 * Composio catalog:
 *
 *   1. Composio's catalog doesn't expose a curated "popular" signal
 *      per toolkit, so any definition has to come from us.
 *   2. The first impression of the integrations page matters more
 *      than any runtime data. We want the grid to lead with familiar
 *      logos (Gmail, Slack, GitHub, Notion) so a brand-new user
 *      immediately thinks "yes, this has what I need."
 *   3. Data-driven "popular" (usage counts, install counts, etc.)
 *      doesn't exist yet and wouldn't be meaningful with 0 users.
 *
 * Constraint: entries are SLUGS — they must match the `slug` field
 * returned by Composio's toolkit catalog, not display names. The
 * grid renders toolkits whose slug is in this list, in this order.
 * If a slug in this list doesn't exist in the catalog (e.g. Composio
 * renamed it), we simply skip it — the "Popular" tab shows whatever
 * subset DOES exist. Safer than hard-failing on a stale entry.
 *
 * Ordering matters: this is the visual order in the Popular tab.
 * Keep the most familiar / highest-perceived-value names first.
 *
 * To update: add a slug, save, reload /[agentId]/connect. If the
 * toolkit logo shows up in the Tools section, the slug was right.
 * No rebuild of anything else needed.
 */
export const POPULAR_TOOLKIT_SLUGS: readonly string[] = [
  "gmail",
  "googlecalendar",
  "notion",
  "github",
  "linear",
  "hubspot",
  "googledrive",
  "asana",
  "jira",
  "salesforce",
  "zendesk",
] as const;

/**
 * Look up the sort-order index for a toolkit in the popular list.
 * Returns -1 if the slug isn't in the popular set (so consumers can
 * filter unpopular toolkits out of the Popular tab).
 */
export function popularRank(slug: string): number {
  return POPULAR_TOOLKIT_SLUGS.indexOf(slug);
}
