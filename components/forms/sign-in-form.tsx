"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
// import { LastUsedIndicator } from "@/components/auth/last-used-indicator";

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  rememberMe: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function SignInForm({ callbackURL = "/app" }: { callbackURL?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  // const mounted = useSyncExternalStore(
  //   () => () => {},
  //   () => true,
  //   () => false,
  // );

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  const onSubmit = (values: Values) => {
    startTransition(async () => {
      await authClient.signIn.email(
        { ...values, callbackURL },
        {
          onSuccess: () => {
            toast.success("Signed in");
            router.push(callbackURL as Route);
          },
          onError: (ctx) => {
            toast.error(authErrorMessage(ctx, "Sign in failed."));
          },
        },
      );
    });
  };

  // const isLastEmail = mounted && authClient.isLastUsedLoginMethod("email");

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <Controller
        name="email"
        control={form.control}
        render={({ field, fieldState }) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sign-in-email">Email</Label>
            <InputGroup>
              <InputGroupInput
                {...field}
                id="sign-in-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                aria-invalid={fieldState.invalid || undefined}
              />
              <InputGroupAddon>
                <Mail aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>
            {fieldState.error && (
              <p className="text-xs text-destructive-foreground">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )}
      />

      <Controller
        name="password"
        control={form.control}
        render={({ field, fieldState }) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sign-in-password">Password</Label>
              <Link
                href={"/forgot-password" as Route}
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <InputGroup>
              <InputGroupInput
                {...field}
                id="sign-in-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                aria-invalid={fieldState.invalid || undefined}
              />
              <InputGroupAddon>
                <Lock aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupAddon align="inline-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  aria-controls="sign-in-password"
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" />
                  ) : (
                    <Eye aria-hidden="true" />
                  )}
                </Button>
              </InputGroupAddon>
            </InputGroup>
            {fieldState.error && (
              <p className="text-xs text-destructive-foreground">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )}
      />

      <Controller
        name="rememberMe"
        control={form.control}
        render={({ field }) => (
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="remember-me"
              checked={field.value}
              onCheckedChange={(v) => field.onChange(v === true)}
            />
            <Label htmlFor="remember-me" className="font-normal">
              Remember for 30 days
            </Label>
          </div>
        )}
      />

      <div className="relative">
        <Button type="submit" className="w-full gap-2" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <>
              Sign in
              <ArrowRight aria-hidden="true" />
            </>
          )}
        </Button>
        {/* {isLastEmail && <LastUsedIndicator />} */}
      </div>

      {/*
        Google sign-in (disabled). To enable:
        1. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET via `npx convex env set`
        2. Add `socialProviders: { google: { clientId, clientSecret } }` in convex/betterAuth/auth.ts
        3. Render a coss <Button variant="outline"> calling authClient.signIn.social({ provider: "google" })
      */}
    </form>
  );
}
