"use client";

/**
 * /auth/composio/callback
 *
 * Dedicated landing page for Composio OAuth popup completion.
 *
 * This page is NEVER navigated to in the main app flow — it only
 * exists as a landing target for the popup window opened by
 * `initiateComposioAuthFlow`. Composio's hosted auth flow redirects
 * here with one of two query-param shapes:
 *
 *   Success: ?status=success&connectedAccountId=conn_abc123
 *   Failure: ?error=<message>&status=failed
 *
 * The page's job is deliberately minimal:
 *
 *   1. Show a clear success/failure state so if the parent polling
 *      gets confused the user at least sees "it worked" or "it broke"
 *      and can close the window manually.
 *   2. Keep the URL query params UNTOUCHED — the parent window's
 *      polling loop reads `popup.location.href` and looks for the
 *      `status` param to decide when to close the popup. If we
 *      rewrote the URL (e.g. via `router.replace`) we'd lose the
 *      signal and the parent would sit polling forever.
 *   3. Not auto-close. Composio docs recommend the parent window
 *      closes the popup via `popup.close()` once it sees the
 *      success param — that's cleaner than trying to close from
 *      inside the popup (which can hit "Scripts may close only
 *      windows that were opened by script" restrictions).
 *
 * The design pattern is taken verbatim from Composio's
 * `app-auth-popup-ui.md` rule:
 *
 *   > Always route popup completion to a dedicated page like
 *   > `/auth/composio/callback` to show clear success/failure
 *   > states, provide a stable URL shape for parameter parsing,
 *   > prevent exposing auth-link query params in unrelated pages,
 *   > and keep popup close/cleanup logic predictable.
 */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

export default function ComposioCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell state="loading" />}>
      <CallbackInner />
    </Suspense>
  );
}

function CallbackInner() {
  const params = useSearchParams();
  const status = params.get("status");
  const error = params.get("error");
  // Composio has been observed to send both camelCase and snake_case
  // variants of this param across different toolkits, so we accept
  // either and normalize to one field for display.
  const connectedAccountId =
    params.get("connectedAccountId") ?? params.get("connected_account_id");

  if (error) {
    return <CallbackShell state="error" message={error} />;
  }

  if (status === "success") {
    return (
      <CallbackShell
        state="success"
        message={
          connectedAccountId
            ? `Account ${connectedAccountId.slice(-8)} connected.`
            : undefined
        }
      />
    );
  }

  if (status === "failed") {
    return (
      <CallbackShell
        state="error"
        message="The connection attempt failed. You can close this window and try again."
      />
    );
  }

  // Neither success nor failure — Composio may still be redirecting.
  // The parent polling loop will catch the terminal params once they
  // land; we just show a generic "in progress" state.
  return <CallbackShell state="loading" />;
}

type ShellState = "loading" | "success" | "error";

function CallbackShell({
  state,
  message,
}: {
  state: ShellState;
  message?: string;
}) {
  const title =
    state === "success"
      ? "Connected"
      : state === "error"
        ? "Connection failed"
        : "Finishing connection…";

  const body =
    state === "success"
      ? (message ?? "You can close this window. The agent will pick up the new connection automatically.")
      : state === "error"
        ? (message ?? "Something went wrong. You can close this window and try again.")
        : "Please wait while we complete the authorization.";

  const accent =
    state === "success"
      ? "text-success"
      : state === "error"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <h1 className={`text-lg font-medium tracking-tight ${accent}`}>
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{body}</p>
        {state !== "loading" && (
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-6 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Close this window
          </button>
        )}
      </div>
    </div>
  );
}
