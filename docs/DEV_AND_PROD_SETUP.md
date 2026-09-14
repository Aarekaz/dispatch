# Development & Production Environment Setup

Complete guide for setting up isolated dev and prod environments for Dispatch.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  PRODUCTION                                             │
│  Vercel: app.dispatch.com                              │
│  Convex: prod:compassionate-rooster-288                 │
│  Slack:  "Dispatch" (production app)                      │
│  Telegram: per-agent bots (user-created)                │
│  OpenRouter: production key (unlimited)                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  DEVELOPMENT                                            │
│  Vercel: dispatch-v2-git-<branch>-dispatch.vercel.app│
│  Convex: dev:compassionate-rooster-288                  │
│  Slack:  "Dispatch-Dev" (separate dev app)                │
│  Telegram: dev bot via BotFather                        │
│  OpenRouter: dev key (rate-limited is fine)              │
└─────────────────────────────────────────────────────────┘
```

## 1. Convex: Dev vs Prod Deployments

Convex supports separate dev and prod deployments within the same project. They share the schema but have independent data.

### Current setup

```
dev:compassionate-rooster-288   ← localhost uses this
prod:compassionate-rooster-288  ← Vercel production uses this
```

### Create a prod deployment (if not already done)

```bash
npx convex deploy --prod
```

This pushes the current schema + functions to the prod deployment. Data starts empty.

### Cloning prod data to dev

Convex supports export/import for copying data between deployments:

```bash
# 1. Export production data (with files if needed)
npx convex export --prod --path ./prod-snapshot.zip --include-file-storage

# 2. Import into dev (replaces all dev data)
npx convex import ./prod-snapshot.zip --replace-all

# 3. Clean up
rm ./prod-snapshot.zip
```

**One-liner to clone prod → dev:**

```bash
npx convex export --prod --path /tmp/convex-snapshot.zip && \
npx convex import /tmp/convex-snapshot.zip --replace-all && \
rm /tmp/convex-snapshot.zip
```

### Import options

| Flag | Behavior |
|------|----------|
| `--replace-all` | Wipe dev completely, replace with imported data |
| `--replace` | Replace only tables that appear in the import |
| `--append` | Add imported rows to existing dev data |

### Per-table import

```bash
# Export a single table
npx convex export --prod --path /tmp/snapshot.zip
# Extract and import just one table
unzip /tmp/snapshot.zip agents.jsonl -d /tmp/
npx convex import --table agents /tmp/agents.jsonl --replace
```

### Automating data sync

There's no built-in "auto-mirror" in Convex. For regular dev refreshes, create a script:

```bash
#!/bin/bash
# scripts/sync-prod-to-dev.sh
set -e
echo "Exporting production data..."
npx convex export --prod --path /tmp/convex-prod-snapshot.zip --include-file-storage
echo "Importing into dev..."
npx convex import /tmp/convex-prod-snapshot.zip --replace-all
rm /tmp/convex-prod-snapshot.zip
echo "Dev database synced with production."
```

## 2. Environment Variables

### Dev (.env.local)

These are for `localhost:3000` + the dev Convex deployment.

```bash
# ── Convex ──
NEXT_PUBLIC_CONVEX_URL=https://compassionate-rooster-288.convex.cloud
CONVEX_DEPLOYMENT=dev:compassionate-rooster-288

# ── Secrets (generate unique ones for dev) ──
CHAT_STATE_INTERNAL_SECRET=<dev-secret>
CRON_INTERNAL_SECRET=<dev-secret>
CRON_SECRET=<dev-secret>

# ── Daytona ──
DAYTONA_API_KEY=<your-key>
DAYTONA_API_URL=<your-url>

# ── OpenRouter ──
OPENROUTER_API_KEY=<dev-or-shared-key>

# ── Slack (dev app — "Dispatch-Dev") ──
SLACK_CLIENT_ID=<dev-app-client-id>
SLACK_CLIENT_SECRET=<dev-app-client-secret>
SLACK_SIGNING_SECRET=<dev-app-signing-secret>
SLACK_REDIRECT_URI=http://localhost:3000/api/slack/callback
NEXT_PUBLIC_BOT_NAME=Dispatch-Dev

# ── Telegram (for testing locally — needs HTTPS) ──
NEXT_PUBLIC_APP_URL=https://<your-preview-url>.vercel.app
VERCEL_AUTOMATION_BYPASS_SECRET=<from-vercel-project-settings>

# ── Stripe (test mode) ──
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Prod (Vercel Environment Variables)

Set these in Vercel → Project → Settings → Environment Variables, scoped to **Production**.

```bash
# ── Convex ──
NEXT_PUBLIC_CONVEX_URL=https://compassionate-rooster-288.convex.cloud
CONVEX_DEPLOYMENT=prod:compassionate-rooster-288

# ── Secrets (separate from dev!) ──
CHAT_STATE_INTERNAL_SECRET=<prod-secret>
CRON_INTERNAL_SECRET=<prod-secret>
CRON_SECRET=<prod-secret>

# ── Daytona ──
DAYTONA_API_KEY=<same-or-separate>
DAYTONA_API_URL=<your-url>

# ── OpenRouter ──
OPENROUTER_API_KEY=<prod-key-unlimited>

# ── Slack (production app — "Dispatch") ──
SLACK_CLIENT_ID=<prod-app-client-id>
SLACK_CLIENT_SECRET=<prod-app-client-secret>
SLACK_SIGNING_SECRET=<prod-app-signing-secret>
SLACK_REDIRECT_URI=https://app.dispatch.com/api/slack/callback
NEXT_PUBLIC_BOT_NAME=Dispatch

# ── Stripe (live mode) ──
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Preview deployments (Vercel)

Vercel sets these automatically for all preview deployments:
- `VERCEL_PROJECT_PRODUCTION_URL` — used by Telegram connect for HTTPS webhook URLs
- `VERCEL_URL` — the deployment-specific URL

For preview deployments to work with Telegram, also set `VERCEL_AUTOMATION_BYPASS_SECRET` scoped to **Preview**.

## 3. Slack: Dev vs Prod Apps

You need **two separate Slack apps** — they cannot share credentials.

| | Dev | Prod |
|---|---|---|
| App name | Dispatch-Dev | Dispatch |
| Webhook URL | `https://<preview>.vercel.app/api/webhooks/slack` | `https://app.dispatch.com/api/webhooks/slack` |
| OAuth redirect | `http://localhost:3000/api/slack/callback` | `https://app.dispatch.com/api/slack/callback` |
| Bot name env | `NEXT_PUBLIC_BOT_NAME=Dispatch-Dev` | `NEXT_PUBLIC_BOT_NAME=Dispatch` |

Both apps use the **same manifest structure** (see `docs/SLACK_PRODUCTION_SETUP.md`), just with different URLs.

### Dev Slack app tips

- Install to a test workspace only
- The dev app's webhook URL needs to be reachable — either use the Vercel preview URL or a tunnel like ngrok
- OAuth redirect can be `localhost` for local testing (Slack allows it)
- **Never** share `SLACK_CLIENT_SECRET` between dev and prod

## 4. Telegram: Dev vs Prod

Telegram bots are per-agent (each agent has its own BotFather token). For dev:

1. Create a test bot via @BotFather (e.g., `@dispatch_dev_bot`)
2. Connect it on the manage page (paste token)
3. The webhook URL will point at the Vercel preview deployment

No special config needed — dev and prod Telegram bots are naturally isolated because each has its own token and webhook URL.

## 5. Quick Start: New Developer

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd <repo>

# 2. Install dependencies
pnpm install

# 3. Copy env template and fill in values
cp .env.example .env.local
# Edit .env.local with your dev credentials

# 4. Push schema to dev Convex
npx convex dev

# 5. (Optional) Clone prod data for realistic testing
npx convex export --prod --path /tmp/snapshot.zip
npx convex import /tmp/snapshot.zip --replace-all
rm /tmp/snapshot.zip

# 6. Start dev server
pnpm dev
```

## 6. Deployment Checklist

### Before first production deploy

- [ ] Create prod Convex deployment: `npx convex deploy --prod`
- [ ] Set all prod env vars on Vercel (see section 2)
- [ ] Create production Slack app (see `docs/SLACK_PRODUCTION_SETUP.md`)
- [ ] Verify webhook URLs in Slack manifest point to prod domain
- [ ] Set `CONVEX_DEPLOYMENT=prod:compassionate-rooster-288` on Vercel (Production scope)
- [ ] Deploy: `git push` to main (Vercel auto-deploys)
- [ ] Verify Slack webhook: check Vercel logs for `POST /api/webhooks/slack`
- [ ] Install Slack app to a workspace, test full loop

### Routine dev workflow

```bash
# Work on a feature branch
git checkout -b feat/my-feature

# Convex dev watcher (auto-pushes schema changes)
npx convex dev

# Next.js dev server
pnpm dev

# Push — Vercel creates a preview deployment automatically
git push origin feat/my-feature
```

### Refreshing dev data from prod

```bash
npx convex export --prod --path /tmp/snapshot.zip --include-file-storage && \
npx convex import /tmp/snapshot.zip --replace-all && \
rm /tmp/snapshot.zip
```

## Key Differences Summary

| Concern | Dev | Prod |
|---------|-----|------|
| Convex deployment | `dev:compassionate-rooster-288` | `prod:compassionate-rooster-288` |
| Next.js | `localhost:3000` | `app.dispatch.com` |
| Slack app | Dispatch-Dev | Dispatch |
| Slack webhook | Preview URL / ngrok | Production domain |
| Telegram | Test bot, preview webhook | User-created bots, prod webhook |
| OpenRouter key | Rate-limited OK | Unlimited |
| Secrets | Separate set | Separate set |
| Stripe | Test mode (`sk_test_`) | Live mode (`sk_live_`) |
