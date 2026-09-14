"use client";

import { useEffect, useRef, useState } from "react";

export type TelegramChatOption = {
  chatId: number;
  title: string;
  type: string;
};

/**
 * Fetch the set of Telegram chats an agent's bot has seen recently,
 * via our server-side proxy (`/api/telegram/chats`). Used by the
 * automation detail page's delivery picker when the user selects
 * "post to Telegram channel" and we need a list to populate the
 * dropdown.
 *
 * Same lazy-fetch-once semantics as `useSlackChannels`: nothing
 * happens until `enabled` flips to `true`, and the result is cached
 * for the hook's lifetime. Errors are swallowed since this is a
 * non-critical enrichment over a free-text chat-ID input.
 */
export function useTelegramChats(opts: {
  agentId: string;
  enabled: boolean;
}): { chats: TelegramChatOption[]; loading: boolean } {
  const { agentId, enabled } = opts;
  const [chats, setChats] = useState<TelegramChatOption[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!enabled || fetchedRef.current) return;
    fetchedRef.current = true;

    const loadChats = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/telegram/chats?agentId=${agentId}`);
        const data = res.ok
          ? ((await res.json()) as { chats?: TelegramChatOption[] })
          : null;
        setChats(data?.chats ?? []);
      } catch {
        // Silent failure — free-text fallback handles this
      } finally {
        setLoading(false);
      }
    };

    void loadChats();
  }, [enabled, agentId]);

  return { chats, loading };
}
