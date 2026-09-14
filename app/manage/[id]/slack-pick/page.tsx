import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";

import { SlackPickForm } from "./pick-form";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ensureBotInitialized, getSlackAdapter } from "@/lib/chat/bot";

/**
 * /manage/[id]/slack-pick?teamId=T0123&teamName=Acme
 *
 * Post-OAuth landing page where the customer chooses where their
 * agent should respond in their freshly-installed Slack workspace.
 *
 * **Flow:**
 *   1. Server component verifies the user is authenticated and owns
 *      the agent. Bails to /not-found otherwise.
 *   2. Looks up the workspace's bot token via the Slack adapter's
 *      `getInstallation(teamId)` (which reads from our Convex
 *      `chatKv` via the state adapter).
 *   3. Calls Slack's `conversations.list` API with that token to
 *      fetch the workspace's public channels.
 *   4. Renders a client form (`pick-form.tsx`) with the agent name,
 *      workspace name, and channel list.
 *
 * **Best practices applied:**
 *   - All data fetching is server-side. No `useEffect`-based
 *     fetching in the client component (per CLAUDE.md `no-use-effect`).
 *   - Auth checks happen on the server, not the client.
 *   - The Slack API call uses the bot token *server-side only* —
 *     it never leaves the request.
 *   - Errors render visible UI states, not silent failures.
 */
export default async function SlackPickPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ teamId?: string; teamName?: string }>;
}) {
  const { id } = await params;
  const { teamId, teamName } = await searchParams;

  if (!teamId) {
    // Direct hit on this page without OAuth — bounce to the agent's
    // workspace settings (formerly bounced to /manage/[id], which is
    // now a redirect to the same place).
    redirect(`/${id}/settings` as Route);
  }

  // 1. Auth + agent ownership check.
  if (!(await isAuthenticated())) {
    redirect(`/sign-in?next=/manage/${id}/slack-pick`);
  }

  const agent = await fetchAuthQuery(
    api.agents.get,
    { id: id as Id<"agents"> },
  );
  if (!agent) {
    notFound();
  }
  const ownsWorkspace = await fetchAuthQuery(
    api.integrations.ownsSlackWorkspace,
    { teamId },
  );
  if (!ownsWorkspace) notFound();

  // 2 + 3. Fetch the workspace's channels via Slack's API.
  // This call is bracketed in a try/catch so a Slack outage shows
  // a visible error state instead of crashing the page.
  let channels: SlackChannel[];
  let fetchError: string | null = null;
  try {
    channels = await fetchSlackChannels(teamId);
  } catch (err) {
    channels = [];
    fetchError =
      err instanceof Error ? err.message : "Couldn't fetch Slack channels";
    console.error(`[slack-pick] fetchSlackChannels failed:`, err);
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/${id}/settings` as Route} />}
        >
          ← Back to {agent.name}
        </Button>

        <header className="mt-10">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Connect {agent.name} to Slack
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            {agent.name} is installed in{" "}
            <span className="text-foreground">
              {teamName ?? "your Slack workspace"}
            </span>
            . Choose where {agent.name} should respond.
          </p>
        </header>

        {fetchError ? (
          <div className="mt-12 rounded-md border border-border bg-muted/30 p-6">
            <p className="text-sm font-medium text-foreground">
              Couldn&apos;t reach Slack
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{fetchError}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              The install completed, but we couldn&apos;t list your channels.
              Try refreshing in a moment, or remove the install and start
              over.
            </p>
          </div>
        ) : (
          <SlackPickForm
            agentId={id}
            agentName={agent.name}
            teamId={teamId}
            channels={channels}
          />
        )}
      </div>
    </div>
  );
}

// ── Slack API ────────────────────────────────────────────────

export type SlackChannel = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
};

/**
 * Fetch the workspace's public channels via Slack's `conversations.list`.
 * Uses the bot token persisted in our Convex state adapter under the
 * `slack:installation:{teamId}` key (set by `handleOAuthCallback`).
 *
 * Limited to 200 channels per call — sufficient for any normal
 * workspace; pagination is a Phase 2 add-on if needed.
 */
async function fetchSlackChannels(teamId: string): Promise<SlackChannel[]> {
  // Chat SDK lazy-inits on the first webhook; this server component
  // bypasses that path, so trigger init explicitly before touching
  // the adapter.
  await ensureBotInitialized();
  const slack = getSlackAdapter();
  const installation = await slack.getInstallation(teamId);
  if (!installation?.botToken) {
    throw new Error(
      "Slack workspace install missing — try connecting Slack again.",
    );
  }

  const url = new URL("https://slack.com/api/conversations.list");
  url.searchParams.set("types", "public_channel");
  url.searchParams.set("exclude_archived", "true");
  url.searchParams.set("limit", "200");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${installation.botToken}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Slack API returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    channels?: Array<{
      id: string;
      name: string;
      is_private?: boolean;
      is_member?: boolean;
    }>;
  };

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? "unknown"}`);
  }

  return (data.channels ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.is_private ?? false,
      isMember: c.is_member ?? false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
