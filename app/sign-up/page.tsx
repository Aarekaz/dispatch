"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AuthLogo } from "@/components/auth/logo";
import { SignUpForm } from "@/components/forms/sign-up-form";

function SignUpInner() {
  const params = useSearchParams();
  const callbackURL = params.get("callbackURL") ?? "/app";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="mx-auto w-full max-w-xs space-y-6">
        <div className="space-y-2 text-center">
          <AuthLogo className="mx-auto h-16 w-16" />
          <h1 className="text-3xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="text-muted-foreground">
            Welcome! Create an account to get started.
          </p>
        </div>

        <SignUpForm callbackURL={callbackURL} />

        <div className="text-center text-sm">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-primary font-medium hover:underline"
          >
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpInner />
    </Suspense>
  );
}
