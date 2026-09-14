# Production Slack App Setup

Step-by-step guide to creating and configuring the production Slack app for Dispatch.

## 1. Create the app

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From an app manifest**
3. Pick any workspace you own as the development workspace
4. Paste the manifest below (update the domain)

## 2. App Manifest

Replace `app.dispatch.com` with your actual production domain.

```yaml
display_information:
  name: Dispatch
  description: AI agents that live in your team chat
  background_color: "#000000"
features:
  bot_user:
    display_name: Dispatch
    always_online: true
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  assistant_view:
    assistant_description: "Ask Dispatch anything."
oauth_config:
  redirect_urls:
    - https://app.dispatch.com/api/slack/callback
  scopes:
    bot:
      - app_mentions:read
      - assistant:write
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - mpim:history
      - mpim:read
      - reactions:read
      - reactions:write
      - users:read
settings:
  event_subscriptions:
    request_url: https://app.dispatch.com/api/webhooks/slack
    bot_events:
      - app_mention
      - app_home_opened
      - assistant_thread_started
      - assistant_thread_context_changed
      - member_joined_channel
      - message.im
      - message.mpim
      - reaction_added
      - reaction_removed
  interactivity:
    is_enabled: true
    request_url: https://app.dispatch.com/api/webhooks/slack
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

### DO NOT add these bot events

- `message.channels`
- `message.groups`

These race with `app_mention` and silently drop channel @-mentions.
See the detailed explanation in `lib/chat/bot.ts:190-217`.

## 3. Environment Variables

Set these on Vercel → Project → Settings → Environment Variables (scope: Production).

| Variable | Value | Where to find |
|---|---|---|
| `SLACK_CLIENT_ID` | From Slack app | api.slack.com → Basic Information → App Credentials |
| `SLACK_CLIENT_SECRET` | From Slack app | Same page |
| `SLACK_SIGNING_SECRET` | From Slack app | Same page |
| `SLACK_REDIRECT_URI` | `https://app.dispatch.com/api/slack/callback` | Must match manifest exactly |
| `NEXT_PUBLIC_BOT_NAME` | `Dispatch` | Matches manifest bot_user.display_name |
| `CHAT_STATE_INTERNAL_SECRET` | Generate with `openssl rand -hex 32` | Fresh, separate from dev |

## 4. Deploy first, then verify webhook

Slack verifies the webhook URL when you save the manifest. The deployment must be live first.

1. Deploy to production with all env vars set
2. Save the manifest in the Slack app dashboard
3. Slack sends a verification challenge to `/api/webhooks/slack`
4. Chat SDK handles this automatically via `bot.webhooks.slack`

If verification fails:
- Check the deployment is live at the domain
- Check Vercel function logs for the POST to `/api/webhooks/slack`
- Confirm `SLACK_SIGNING_SECRET` matches what Slack shows

## 5. Enable public distribution

1. api.slack.com → your app → **Manage Distribution**
2. Click **Activate Public Distribution**
3. Requirements (all met by default):
   - No hardcoded workspace info (OAuth-only, no static tokens)
   - OAuth redirect URL set
   - Install button removed for dev workspace

This gives you a shareable install link. Users don't use it directly — they go through your `/api/slack/install?agentId=...` flow.

## 6. Test the full loop

1. From a **clean Slack workspace** (not the one you developed on):
   - Visit `https://app.dispatch.com/api/slack/install?agentId=<real-agent-id>`
   - Authorize the app
   - Should redirect to `/api/slack/callback` → binding UI at `/manage/[id]/slack-pick/`
2. Invite `@Dispatch` to a channel
   - Should see the auto-welcome message
3. `@Dispatch hello` in the channel
   - Should stream a response with ✅ reaction on completion
4. DM the bot directly
   - Should respond to every message (not just @-mentions)
5. Open the bot's profile → Home tab
   - Should show the branded welcome view

## 7. Optional: App Directory submission

Everything above gives you a production app installable via the install link.
The Slack App Directory is a **separate, weeks-long review** only needed for
discoverability on Slack's marketplace. Requirements:

- 256×256 icon, long/short descriptions, screenshots
- Privacy policy URL and support URL
- Pass Slack's security review
- Submit via Manage Distribution → Submit to App Directory

## Architecture Reference

```
User @-mentions bot in Slack
  → Slack sends event to /api/webhooks/slack
  → Chat SDK dispatches to bot.onNewMention()
  → lib/chat/handlers/message.ts runs the turn:
      1. resolveAgentForThread() → finds the bound agent
      2. ensureAgentRunning() → wakes sandbox if needed
      3. runAgent() → streams through OpenCode
      4. toChatStream() → renders to Slack via ChatStreamer
      5. reportFailure() or runs.logInternal → persists to Convex
```

Key files:
- `lib/chat/bot.ts` — Chat SDK singleton, adapter config, event handlers
- `lib/chat/handlers/message.ts` — platform-agnostic turn handler
- `lib/chat/stream-bridge.ts` — RuntimeEvent → Chat SDK StreamChunk
- `lib/chat/errors.ts` — error classifier
- `lib/chat/error-reporter.ts` — failure reporting side-effect boundary
- `app/api/webhooks/[platform]/route.ts` — webhook entry point
- `app/api/slack/install/route.ts` — OAuth install flow
- `app/api/slack/callback/route.ts` — OAuth callback
