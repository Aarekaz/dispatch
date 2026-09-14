# Telegram Bot Setup

Connect your Dispatch agents to Telegram so users can chat with them in DMs or group chats.

## How it works

Each Dispatch agent can be connected to its own Telegram bot. The setup is self-service:

1. Create a bot with @BotFather
2. Paste the token on the agent's manage page
3. Done — the webhook is registered automatically

```
User sends message on Telegram
  → Telegram sends update to /api/webhooks/telegram/<agentId>
  → Webhook route looks up bot token + agent info from Convex
  → Creates/caches a Chat SDK instance for this agent
  → Same handlers as Slack (lib/chat/handlers/message.ts)
  → Same agent resolution, sandbox wake, OpenCode stream
  → Response sent back via Telegram Bot API (post+edit for streaming)
```

## 1. Create a bot with BotFather

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a display name (e.g., your agent's name)
4. Choose a username ending in `bot` (e.g., `acme_support_bot`)
5. BotFather gives you a **bot token** — copy it

### Optional: configure the bot profile

While still in BotFather:

```
/setdescription   → "AI agent powered by Dispatch"
/setabouttext     → "Your AI team assistant"
/setuserpic       → Upload your logo
```

### Enable group chat (optional)

If you want the bot to work in group chats:

```
/mybots → select your bot → Bot Settings → Allow Groups → Turn on
/mybots → select your bot → Bot Settings → Group Privacy → Turn off
```

## 2. Connect on the manage page

1. Go to your agent's manage page at `/manage/<agentId>`
2. In the **Channels** section, click **+ Telegram**
3. Paste the bot token from BotFather
4. Click **Connect**

That's it. The webhook is registered automatically. Your agent is now reachable on Telegram.

## 3. Test

### DM the bot

1. Find your bot on Telegram by searching for its username
2. Send any message
3. The bot should respond using your agent's persona

### Group chat

1. Add the bot to a Telegram group
2. @-mention it: `@your_bot_username what's our Q3 revenue?`
3. It should respond in the group

## Multi-agent setup

Each agent gets its own Telegram bot. This means:

- Agent A → `@acme_support_bot`
- Agent B → `@acme_sales_bot`
- Agent C → `@acme_ops_bot`

Each bot has its own webhook URL (`/api/webhooks/telegram/<agentId>`), so Telegram knows exactly which agent to route each message to. No binding-key resolution needed.

## Disconnecting

Click **Disconnect Telegram** on the manage page. This:

1. Calls Telegram's `deleteWebhook` API to stop updates
2. Removes the integration from the database

The bot still exists on Telegram (BotFather created it), but it stops responding. You can reconnect anytime by pasting the token again, or connect a different bot token.

## Streaming behavior

Telegram doesn't support native streaming like Slack. Chat SDK uses **post-and-edit fallback**: it posts an initial message ("Thinking..."), then edits it in place as chunks arrive. The final message looks normal to the user.

## Platform comparison

| Feature | Telegram | Slack |
|---|---|---|
| Setup | Paste token (self-service) | OAuth flow |
| Multi-agent | One bot per agent | One app, channel-level binding |
| Streaming | Post-and-edit fallback | Native ChatStreamer |
| Cards/buttons | Inline keyboard (64-byte limit) | Block Kit |
| Threading | Flat (no nested threads) | Threaded |
| Reactions | Emoji only | Full reactions |

## Troubleshooting

### Bot doesn't respond

1. Check Vercel logs for `POST /api/webhooks/telegram/<agentId>`
2. Verify the integration exists: check the manage page Channels section
3. Make sure the agent's sandbox is provisioned (has a running environment)

### Bot responds in DMs but not groups

1. Make sure "Group Privacy" is OFF in BotFather settings
2. Or @-mention the bot explicitly

### "Thinking..." shows but no response

The agent is streaming but taking too long. Check:
- Is the sandbox running? (Vercel logs → `ensure-running`)
- Is the API key valid? (Vercel logs → `session.error`)

### Token changed or expired

Disconnect and reconnect with the new token from BotFather.
