/**
 * Environment-driven branding strings.
 *
 * **Why a central file:** as the product grows, more strings need
 * to vary per environment (dev vs prod) — bot name, support email,
 * marketing CTA copy, etc. Putting them all here gives you one
 * single place to add the env var, set the default, and reference
 * the export everywhere. No more grep-and-replace across the
 * codebase when you create the prod Slack app.
 *
 * **Why `NEXT_PUBLIC_*` env vars:** these need to render in BOTH
 * server components (the picker page) AND client components (the
 * picker form). Next.js only exposes env vars prefixed with
 * `NEXT_PUBLIC_` to the client bundle. Server-only env vars (like
 * secrets) stay without the prefix.
 *
 * **Defaults:** every export has a sensible fallback so local dev
 * without a `.env.local` still renders correctly. If you want to
 * verify what's loaded, log `BOT_NAME` once in the picker page.
 */

/**
 * The bot's display name. Used by:
 * - Chat SDK's `userName` config (cross-platform mention fallback)
 * - User-facing error messages from Chat SDK handlers
 * - The Slack pick page descriptions and `/invite` hint
 *
 * Set per Vercel environment:
 *   - Preview:    NEXT_PUBLIC_BOT_NAME=Dispatch-Dev
 *   - Production: NEXT_PUBLIC_BOT_NAME=Dispatch
 *
 * Must match the `display_information.name` and
 * `features.bot_user.display_name` in the corresponding Slack app
 * manifest, otherwise users see two different names in two places.
 */
export const BOT_NAME: string =
  process.env.NEXT_PUBLIC_BOT_NAME?.trim() || "Dispatch";

/**
 * The bot's @-handle as customers will see it in Slack/Telegram/etc.
 * Slack treats this case-insensitively when resolving mentions, but
 * we keep the case the operator chose for display consistency.
 */
export const BOT_MENTION_HANDLE: string = `@${BOT_NAME}`;
