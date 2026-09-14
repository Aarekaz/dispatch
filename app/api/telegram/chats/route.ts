/**
 * GET /api/telegram/chats?agentId=abc123
 *
 * Returns Telegram chats the bot has interacted with.
 * Chat info is captured from incoming webhook messages and stored
 * in chatState under keys like `telegram:chat:{agentId}:{chatId}`.
 *
 * Auth-gated: verifies the user owns the agent.
 */
import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const CHAT_SECRET = process.env.CHAT_STATE_INTERNAL_SECRET ?? "";

type TelegramChat = {
  chatId: number;
  title: string;
  type: string;
};

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  if (!agentId) {
    return Response.json({ error: "agentId required" }, { status: 400 });
  }

  // Verify agent ownership
  const agent = await fetchAuthQuery(
    api.agents.get,
    { id: agentId as Id<"agents"> },
  );
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 403 });
  }

  // Verify the agent has Telegram connected
  const integrations = await fetchAuthQuery(
    api.integrations.list,
    { agentId: agentId as Id<"agents"> },
  );
  if (!integrations.some((i) => i.platform === "telegram")) {
    return Response.json({ error: "No Telegram bot connected" }, { status: 404 });
  }

  // Read stored chats from chatState. Keys follow the pattern
  // `telegram:chat:{agentId}:{chatId}`. We fetch them individually
  // isn't ideal, but chatState doesn't have a prefix-scan.
  // Instead, we use the chatState list feature if available,
  // or fall back to checking recent sessions for Telegram threads.
  //
  // For now: query sessions that came from Telegram for this agent.
  // Each session has a threadId like "telegram:{chatId}:..." from
  // the Chat SDK. We extract unique chat IDs from these.
  const sessions = await fetchAuthQuery(
    api.sessions.list,
    { agentId: agentId as Id<"agents"> },
  );

  // Extract unique Telegram chat IDs from session threadIds
  const chatMap = new Map<string, TelegramChat>();

  for (const session of sessions) {
    if (!session.threadId?.startsWith("telegram:")) continue;
    // Chat SDK threadId format: "telegram:{chatId}:{messageTs}"
    const parts = session.threadId.split(":");
    if (parts.length < 2) continue;
    const chatId = parts[1];
    if (!chatId || chatMap.has(chatId)) continue;

    // Try to get stored chat info from chatState
    try {
      const stored = await fetchQuery(api.chatState.get, {
        key: `telegram:chat:${agentId}:${chatId}`,
        secret: CHAT_SECRET,
      });
      if (stored?.value) {
        const info = stored.value as TelegramChat;
        chatMap.set(chatId, info);
        continue;
      }
    } catch {
      // Fall through to basic entry
    }

    // Fallback: use the chat ID with a generic title
    chatMap.set(chatId, {
      chatId: Number(chatId),
      title: session.title ?? `Chat ${chatId}`,
      type: "unknown",
    });
  }

  const chats = [...chatMap.values()].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  return Response.json({ chats });
}
