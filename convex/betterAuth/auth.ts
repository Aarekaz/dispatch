import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { lastLoginMethod } from "better-auth/plugins";
import { Resend } from "resend";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import schema from "./schema";

const RESET_FROM =
  process.env.AUTH_EMAIL_FROM ?? "Dispatch <onboarding@resend.dev>";

async function sendResetEmail(to: string, url: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[auth] RESEND_API_KEY not set; reset link for ${to}: ${url}`);
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: RESET_FROM,
    to,
    subject: "Reset your Dispatch password",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0a0a0a">
        <h2 style="margin:0 0 16px;font-size:20px">Reset your password</h2>
        <p style="margin:0 0 16px;color:#525252;line-height:1.5">
          Click the button below to choose a new password. This link expires in 1 hour.
        </p>
        <a href="${url}" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Reset password</a>
        <p style="margin:24px 0 0;color:#737373;font-size:12px;line-height:1.5">
          If you didn't request this, you can ignore this email.
        </p>
      </div>
    `,
  });
  if (error) throw new Error(`resend: ${error.message}`);
}

export const authComponent = createClient<DataModel, typeof schema>(
  components.betterAuth,
  {
    local: { schema },
    verbose: false,
  },
);

// Local dev gate. The deployed prod backend has SITE_URL set to a real
// host (e.g. https://app.dispatch.com); only when SITE_URL itself is
// loopback do we relax the origin check + share cookies across
// subdomains. Production keeps better-auth's strict baseURL-only rule.
const SITE_URL = process.env.SITE_URL ?? "";
const IS_LOCAL_DEV = /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(
  SITE_URL,
);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  return {
    appName: "Dispatch",
    baseURL: SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    // In local dev, trust any *.localhost origin on any port so each
    // worktree's portless URL — e.g. http://<branch>.<app>.localhost:1355 —
    // can sign in without an INVALID_ORIGIN rejection. The prod backend
    // returns the static baseURL list and stays strict.
    trustedOrigins: IS_LOCAL_DEV
      ? async (request?: Request) => {
          const base = SITE_URL ? [SITE_URL] : [];
          const origin = request?.headers.get("origin");
          if (!origin) return base;
          try {
            const u = new URL(origin);
            if (
              u.hostname === "localhost" ||
              u.hostname.endsWith(".localhost") ||
              u.hostname === "127.0.0.1"
            ) {
              return [...base, origin];
            }
          } catch {
            /* fall through */
          }
          return base;
        }
      : undefined,
    advanced: IS_LOCAL_DEV
      ? {
          // Share the session cookie across every *.localhost subdomain
          // so a single sign-in carries to every worktree's dev URL.
          crossSubDomainCookies: {
            enabled: true,
            domain: ".localhost",
          },
        }
      : undefined,
    emailAndPassword: {
      enabled: true,
      disableSignUp: process.env.ALLOW_PUBLIC_SIGNUP !== "true",
      requireEmailVerification: false,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        await sendResetEmail(user.email, url);
      },
    },
    plugins: [convex({ authConfig }), lastLoginMethod()],
  } satisfies BetterAuthOptions;
};

export const options = createAuthOptions({} as GenericCtx<DataModel>);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth(createAuthOptions(ctx));
};
