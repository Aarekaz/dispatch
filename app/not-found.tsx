import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <p className="text-sm font-mono text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold text-foreground">
        Page not found
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/app"
        className="mt-6 inline-flex items-center rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-foreground/90"
      >
        Go to app
      </Link>
    </main>
  );
}
