/**
 * Client-side helpers for opening a Composio auth flow in a popup
 * window and waiting for it to complete.
 *
 * The library exposes three entry points, layered so call sites can
 * pick whichever matches their timing constraints:
 *
 *   • `openComposioPopup()` — synchronous. Opens a placeholder
 *     `about:blank` window and returns the handle. MUST be called
 *     inside a user-gesture handler (onClick) — browsers block any
 *     `window.open` that runs after the transient activation window
 *     expires (Chrome: ~few hundred ms, Firefox: ~1s, Safari:
 *     strictest). Use this when the redirect URL isn't known until
 *     after one or more async operations, so the popup has to be
 *     opened BEFORE those awaits run.
 *
 *   • `watchComposioAuthFlow(popup, redirectUrl)` — async. Navigates
 *     an already-open popup to `redirectUrl` and polls for the OAuth
 *     callback. Use after `openComposioPopup()` once the URL is
 *     known.
 *
 *   • `initiateComposioAuthFlow(redirectUrl)` — convenience wrapper.
 *     Opens + watches in one call. Safe only when the URL is
 *     available at the moment of the click (no awaits between gesture
 *     and call). For anything that PATCHes or fetches first, use the
 *     two-step form.
 *
 * How the poll works: every 500ms we read `popup.location.href`.
 * While Composio's hosted domain is up, the read throws a cross-
 * origin exception (swallowed). As soon as Composio redirects back
 * to our `/auth/composio/callback` page the URL becomes readable
 * again and we parse `?status=success` or `?error=...` out of the
 * query string. Terminal states: resolve on `status=success`, reject
 * on explicit errors, reject on the user closing the popup.
 */

export type ComposioAuthFlowResult = {
  status: string;
  connectedAccountId?: string;
  [key: string]: string | undefined;
};

const POPUP_WINDOW_NAME = "composio-auth-popup";
const POLL_INTERVAL_MS = 500;

function getPopupFeatures(): string {
  const width = 600;
  const height = 840;
  const left =
    typeof window !== "undefined" ? (window.innerWidth - width) / 2 : 0;
  const top =
    typeof window !== "undefined" ? (window.innerHeight - height) / 2 : 0;
  return `width=${width},height=${height},left=${left},top=${top}`;
}

/**
 * Open a placeholder popup SYNCHRONOUSLY inside a user gesture.
 *
 * Returns the Window handle, or `null` if the browser blocked the
 * popup (call site should show an error and abort). The popup shows
 * `about:blank` until the caller navigates it via
 * `watchComposioAuthFlow`.
 *
 * The placeholder approach avoids the transient-activation-window
 * problem: once the popup is open, browsers let us change its
 * `location` later from async code, even after 3-5 seconds of
 * intervening awaits.
 */
export function openComposioPopup(): Window | null {
  if (typeof window === "undefined") return null;
  const popup = window.open("about:blank", POPUP_WINDOW_NAME, getPopupFeatures());
  if (popup) popup.focus();
  return popup;
}

/**
 * Navigate an already-open popup to `redirectUrl` and watch for
 * OAuth completion. See module docstring for the state machine.
 */
export function watchComposioAuthFlow(
  popup: Window,
  redirectUrl: string,
): Promise<ComposioAuthFlowResult> {
  return new Promise((resolve, reject) => {
    if (popup.closed) {
      reject(new Error("Popup closed before completion"));
      return;
    }

    try {
      popup.location.href = redirectUrl;
    } catch (err) {
      popup.close();
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const popupChecker = setInterval(() => {
      if (popup.closed) {
        clearInterval(popupChecker);
        reject(new Error("Popup closed before completion"));
        return;
      }

      let popupUrl: URL | null = null;
      try {
        // Throws while we're on Composio's hosted domain
        // (cross-origin). We swallow and keep polling — as soon as
        // Composio redirects back to our callback page the read
        // succeeds.
        popupUrl = new URL(popup.location.href);
      } catch {
        return;
      }

      if (!popupUrl) return;

      const statusValue = popupUrl.searchParams.get("status");
      const errorValue = popupUrl.searchParams.get("error");

      if (errorValue) {
        clearInterval(popupChecker);
        popup.close();
        reject(new Error(String(errorValue)));
        return;
      }

      if (statusValue) {
        const allParams: Record<string, string> = {};
        popupUrl.searchParams.forEach((value, key) => {
          allParams[key] = value;
        });
        clearInterval(popupChecker);
        popup.close();
        if (statusValue === "success") {
          resolve(allParams as ComposioAuthFlowResult);
        } else {
          reject(new Error(`Connection failed (status=${statusValue})`));
        }
      }
    }, POLL_INTERVAL_MS);
  });
}

/**
 * Convenience: open + watch in one call. Only safe when the redirect
 * URL is already available at the moment of the user gesture (no
 * intervening awaits). For anything async before the popup open,
 * use `openComposioPopup()` + `watchComposioAuthFlow()` separately.
 */
export function initiateComposioAuthFlow(
  redirectUrl: string,
): Promise<ComposioAuthFlowResult> {
  const popup = openComposioPopup();
  if (!popup) {
    return Promise.reject(
      new Error(
        "Popup blocked by your browser. Allow popups for this site and try again.",
      ),
    );
  }
  return watchComposioAuthFlow(popup, redirectUrl);
}
