"use client";

import { useEffect, useRef, useState } from "react";

export type SlackChannelOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
};

/**
 * Fetch the Slack workspace's public channels through our server-side
 * proxy (`/api/slack/channels`). Used by the automation detail page's
 * delivery picker when the user selects "post to Slack channel" and
 * we need a list to populate the dropdown.
 *
 * Semantics: the hook does nothing until `enabled` flips to `true`.
 * At that point it fires a single fetch and caches the result for
 * the hook's lifetime — the user selecting / deselecting the Slack
 * option in the UI doesn't re-hit the Slack API. Errors are
 * swallowed; the caller's UI falls back to a free-text channel-ID
 * input when the list is empty.
 */
export function useSlackChannels(opts: {
  agentId: string;
  teamId: string | null;
  enabled: boolean;
}): { channels: SlackChannelOption[]; loading: boolean } {
  const { agentId, teamId, enabled } = opts;
  const [channels, setChannels] = useState<SlackChannelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!enabled || fetchedRef.current) return;
    fetchedRef.current = true;

    const loadChannels = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ agentId });
        if (teamId) params.set("teamId", teamId);
        const res = await fetch(`/api/slack/channels?${params}`);
        const data = res.ok
          ? ((await res.json()) as { channels?: SlackChannelOption[] })
          : null;
        setChannels(data?.channels ?? []);
      } catch {
        // Silent failure — free-text fallback handles this
      } finally {
        setLoading(false);
      }
    };

    void loadChannels();
  }, [enabled, agentId, teamId]);

  return { channels, loading };
}
