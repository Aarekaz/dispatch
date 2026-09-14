"use client";

import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/forms/forgot-password-form";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {submitted ? "Check your email" : "Forgot password"}
          </CardTitle>
          <CardDescription>
            {submitted
              ? "We've sent a password reset link to your email if an account exists."
              : "Enter your email and we'll send you a reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-foreground" />
              <p className="text-muted-foreground">
                If you don&apos;t see the email within a minute, check your
                spam folder.
              </p>
            </div>
          ) : (
            <ForgotPasswordForm onSuccess={() => setSubmitted(true)} />
          )}
        </CardContent>
        <CardFooter className="justify-center">
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
