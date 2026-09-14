"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AuthLogo } from "@/components/auth/logo";
import { SignInForm } from "@/components/forms/sign-in-form";

function SignInInner() {
  const params = useSearchParams();
  const callbackURL = params.get("callbackURL") ?? "/app";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="mx-auto w-full max-w-xs space-y-6">
        <div className="space-y-2 text-center">
          <AuthLogo className="mx-auto h-16 w-16" />
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="text-muted-foreground">
            Sign in to manage your AI agents.
          </p>
        </div>

        <SignInForm callbackURL={callbackURL} />

        <div className="text-center text-sm">
          No account?{" "}
          <Link
            href="/sign-up"
            className="text-primary font-medium hover:underline"
          >
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
