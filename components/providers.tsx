"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useEffect } from "react";
import { Toaster as SileoToaster } from "sileo";
import { SoundProvider } from "@web-kits/audio/react";
import { authClient } from "@/lib/auth-client";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUser } from "@/hooks/use-user";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Force Convex to reconnect when the page is restored from bfcache.
 * Without this, pressing the browser back button shows loading
 * skeletons that never resolve because the WebSocket died in cache.
 */
function useBfcacheRecovery() {
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        // Page was restored from bfcache — the WebSocket is likely dead.
        // Trigger a client-side navigation to force React + Convex to
        // re-render and re-subscribe.
        window.dispatchEvent(new Event("online"));
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);
}

/**
 * Reads `users.soundEnabled` from Convex and feeds `<SoundProvider>`.
 * Mounted inside `ConvexBetterAuthProvider` so `useUser` works; the
 * default-false means UI sounds stay off until the user opts in from
 * the settings popover.
 */
function SoundPrefGate({ children }: { children: ReactNode }) {
  const { data } = useUser();
  return (
    <SoundProvider enabled={Boolean(data.soundEnabled)}>{children}</SoundProvider>
  );
}

export function Providers({
  children,
  initialToken,
}: {
  children: ReactNode;
  initialToken?: string | null;
}) {
  useBfcacheRecovery();

  return (
    <NuqsAdapter>
      <ConvexBetterAuthProvider
        client={convex}
        authClient={authClient}
        initialToken={initialToken}
      >
        <TooltipProvider delay={200}>
          <ToastProvider position="bottom-right">
            <SoundPrefGate>
              {children}
              <SileoToaster position="top-center" />
            </SoundPrefGate>
          </ToastProvider>
        </TooltipProvider>
      </ConvexBetterAuthProvider>
    </NuqsAdapter>
  );
}
