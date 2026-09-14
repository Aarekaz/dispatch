import { Spinner } from "@/components/ui/unicode-spinner";

/**
 * Streams immediately while the `page.tsx` server component blocks
 * on the Slack `conversations.list` call (typically 500–1500ms).
 *
 * Without this file, users see a white browser tab for the duration
 * of the Slack API roundtrip — a jarring end to the OAuth flow they
 * just completed. With it, they see an immediate "Connecting…"
 * confirmation that gets replaced once the channel list is ready.
 *
 * Next.js auto-wraps the route segment in a Suspense boundary
 * whenever a `loading.tsx` is present, so we don't need to write
 * `<Suspense>` ourselves.
 *
 * Layout mirrors `page.tsx`'s container (max-w-2xl, identical
 * padding) so the transition from loading to content doesn't shift
 * the page. The fallback has no access to `params`, so the copy
 * stays generic rather than naming the specific agent.
 */
export default function Loading() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        <div className="mt-20 flex flex-col items-center text-center">
          <Spinner
            context="connecting"
            className="text-sm text-muted-foreground"
          />
          <p className="mt-5 text-sm font-medium text-foreground">
            Connecting to Slack
          </p>
          <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
            Fetching your workspace&apos;s channels — this usually takes
            a second.
          </p>
        </div>
      </div>
    </div>
  );
}
