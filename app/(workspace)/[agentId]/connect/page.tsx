"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAgent } from "@/hooks/use-agents";
import { useComposioToolkits } from "@/hooks/use-composio-toolkits";
import { channelLabel } from "@/lib/channels";
import { POPULAR_TOOLKIT_SLUGS } from "@/lib/composio/popular-toolkits";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelIcon } from "@/components/ui/channel-icon";
import { IntegrationRow } from "@/components/connect/integration-row";
import {
  ChannelAction,
  CHANNEL_SPECS,
} from "@/components/connect/channel-action";
import { ToolkitAction } from "@/components/connect/toolkit-action";

/**
 * Connect — every app the agent is plugged into.
 *
 * Two visual sections with different mental models:
 *
 *   1. **Communication** — channels owned by Chat SDK (Slack,
 *      Telegram, WhatsApp, Email, Discord). Where the agent
 *      LISTENS and REPLIES. Small set, always fully visible.
 *
 *   2. **Tools** — Composio toolkits (Gmail, Notion, GitHub, Linear,
 *      and ~1,200 others). What the agent can DO with external
 *      services. Connected + popular visible by default; long tail
 *      behind "Show all".
 *
 * Each row connects independently — no tabs, no bulk save.
 * Search hits both sections; empty sections hide while searching.
 */

type Integration = {
  kind: "channel" | "toolkit";
  id: string;
  name: string;
  description: string;
  logo: React.ReactNode;
  connected: boolean;
  channelBinding?: string;
};

/**
 * Per-channel descriptions — plain English, written for the ops-manager
 * audience. These replace the lack of descriptions in the channel data
 * (channels are hardcoded; unlike Composio toolkits they don't ship
 * metadata).
 */
const CHANNEL_DESCRIPTIONS: Record<string, string> = {
  slack: "Listen and reply in Slack channels and DMs.",
  telegram: "Reply to Telegram chats via your own bot.",
  whatsapp: "Handle WhatsApp messages.",
  email: "Send and receive emails.",
  discord: "Respond to Discord messages.",
};

export default function ConnectPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const {
    catalog,
    connectionFor,
    refreshStatuses,
    isLoadingStatuses,
  } = useComposioToolkits(agentId);

  const integrations = useQuery(api.integrations.list, {
    agentId: agentId as Id<"agents">,
  });

  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const channelBindings = useMemo(() => {
    const map = new Map<string, string | undefined>();
    (integrations ?? []).forEach((i) => {
      map.set(i.platform as string, i.channelBinding ?? undefined);
    });
    return map;
  }, [integrations]);

  // ── Channels (Communication section) ─────────────────────
  // Small, fixed set. Sorted: connected first, then alphabetical.
  const channelList = useMemo((): Integration[] => {
    if (!agent) return [];
    const connectedChannels = new Set(
      agent.channels.filter((c) => c !== "web"),
    );
    const rows: Integration[] = Object.keys(CHANNEL_SPECS).map((key) => ({
      kind: "channel" as const,
      id: `channel:${key}`,
      name: channelLabel(key),
      description: CHANNEL_DESCRIPTIONS[key] ?? "",
      logo: <ChannelIcon channel={key} />,
      connected: connectedChannels.has(key),
      channelBinding: channelBindings.get(key),
    }));
    return rows.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [agent, channelBindings]);

  // ── Toolkits (Tools section) ─────────────────────────────
  // Full Composio catalog. Sorted: connected → popular (curated
  // order) → alphabetical for the long tail.
  const popularRank = useMemo(() => {
    const map = new Map<string, number>();
    POPULAR_TOOLKIT_SLUGS.forEach((slug, i) => map.set(slug, i));
    return map;
  }, []);

  const toolkitList = useMemo((): Integration[] => {
    const rows: Integration[] = (catalog ?? []).map((t) => {
      const status = connectionFor(t.slug);
      return {
        kind: "toolkit" as const,
        id: `toolkit:${t.slug}`,
        name: t.name,
        description: t.description ?? "",
        logo: t.logo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={t.logo}
            alt=""
            className="size-6 object-contain"
          />
        ) : (
          <span className="text-sm text-muted-foreground">
            {t.name.charAt(0)}
          </span>
        ),
        connected: status?.status === "connected",
      };
    });
    return rows.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      const aSlug = a.id.replace("toolkit:", "");
      const bSlug = b.id.replace("toolkit:", "");
      const aPopular = popularRank.get(aSlug);
      const bPopular = popularRank.get(bSlug);
      const aIsPopular = aPopular != null;
      const bIsPopular = bPopular != null;
      if (aIsPopular !== bIsPopular) return aIsPopular ? -1 : 1;
      if (aIsPopular && bIsPopular) return aPopular! - bPopular!;
      return a.name.localeCompare(b.name);
    });
  }, [catalog, connectionFor, popularRank]);

  // Filter each section by search independently.
  const q = search.trim().toLowerCase();
  const searching = q.length > 0;
  const matchesSearch = (i: Integration) =>
    !q ||
    i.name.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q);

  const channelFiltered = useMemo(
    () => channelList.filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesSearch stable per render
    [channelList, q],
  );
  const toolkitFiltered = useMemo(
    () => toolkitList.filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesSearch stable per render
    [toolkitList, q],
  );

  // Tools-section curation: when no search, hide the long tail
  // behind "Show all". Channels have no long tail.
  const toolkitDisplayed = useMemo(() => {
    if (searching || showAll) return toolkitFiltered;
    return toolkitFiltered.filter((i) => {
      if (i.connected) return true;
      const slug = i.id.replace("toolkit:", "");
      return popularRank.has(slug);
    });
  }, [toolkitFiltered, searching, showAll, popularRank]);

  const hiddenCount = toolkitFiltered.length - toolkitDisplayed.length;
  const bothEmpty =
    channelFiltered.length === 0 && toolkitDisplayed.length === 0;

  const isLoading =
    agentLoading || catalog === null || isLoadingStatuses;

  if (isLoading || !agent) {
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-12">
          <Skeleton className="mb-8 h-8 w-32" />
          <Skeleton className="mb-6 h-9 w-full" />
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="mb-1 h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Header */}
        <header className="mb-8">
          <h1 className="font-serif text-2xl font-light leading-snug tracking-tight text-foreground">
            Connect
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every app {agent.name} is plugged into.
          </p>
        </header>

        {/* Search */}
        <div className="mb-6 relative">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search integrations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Sections */}
        {bothEmpty ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {search.trim()
              ? `Nothing matches "${search}".`
              : "No integrations available."}
          </p>
        ) : (
          <div className="space-y-10">
            {/* ── Communication ─────────────────────── */}
            {channelFiltered.length > 0 && (
              <section>
                <header className="mb-3">
                  <h2 className="text-sm font-medium tracking-tight text-foreground">
                    Communication
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Where {agent.name} listens and replies.
                  </p>
                </header>
                <div className="rounded-lg border border-border/60 bg-background">
                  {channelFiltered.map((integration, idx) => (
                    <div
                      key={integration.id}
                      className={
                        idx === 0 ? "px-4" : "border-t border-border/60 px-4"
                      }
                    >
                      <IntegrationRow
                        logo={integration.logo}
                        name={integration.name}
                        description={integration.description}
                        action={
                          <ChannelAction
                            agentId={agentId}
                            channelKey={integration.id.replace("channel:", "")}
                            label={integration.name}
                            connected={integration.connected}
                            channelBinding={integration.channelBinding}
                          />
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Tools ─────────────────────────────── */}
            {toolkitDisplayed.length > 0 && (
              <section>
                <header className="mb-3">
                  <h2 className="text-sm font-medium tracking-tight text-foreground">
                    Tools
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Apps {agent.name} can use to get things done.
                  </p>
                </header>
                <div className="rounded-lg border border-border/60 bg-background">
                  {toolkitDisplayed.map((integration, idx) => (
                    <div
                      key={integration.id}
                      className={
                        idx === 0 ? "px-4" : "border-t border-border/60 px-4"
                      }
                    >
                      <IntegrationRow
                        logo={integration.logo}
                        name={integration.name}
                        description={integration.description}
                        action={
                          <ToolkitAction
                            agentId={agentId}
                            slug={integration.id.replace("toolkit:", "")}
                            name={integration.name}
                            status={connectionFor(
                              integration.id.replace("toolkit:", ""),
                            )}
                            onChanged={refreshStatuses}
                          />
                        }
                      />
                    </div>
                  ))}
                </div>

                {/* Show all / fewer — scoped to the tools section only.
                    The communication section has no long tail. */}
                {!searching && hiddenCount > 0 && !showAll && (
                  <div className="mt-3 flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAll(true)}
                    >
                      Show all {hiddenCount.toLocaleString()} more tools
                    </Button>
                  </div>
                )}
                {!searching && showAll && (
                  <div className="mt-3 flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAll(false)}
                    >
                      Show fewer
                    </Button>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {/* Disclosure */}
        <p className="mt-8 text-center text-xs text-muted-foreground/70">
          External integrations are powered by Composio (SOC 2 compliant).
          Each agent has its own connected accounts.
        </p>
      </div>
    </div>
  );
}
