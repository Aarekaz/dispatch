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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});
type Values = z.infer<typeof schema>;

export function SignUpForm({ callbackURL = "/app" }: { callbackURL?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (values: Values) => {
    startTransition(async () => {
      await authClient.signUp.email(
        {
          email: values.email,
          password: values.password,
          name: values.email.split("@")[0],
          callbackURL,
        },
        {
          onSuccess: () => {
            toast.success("Account created");
            router.push(callbackURL as Route);
          },
          onError: (ctx) => {
            toast.error(authErrorMessage(ctx, "Sign up failed."));
          },
        },
      );
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <Controller
        name="email"
        control={form.control}
        render={({ field, fieldState }) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sign-up-email">Email</Label>
            <InputGroup>
              <InputGroupInput
                {...field}
                id="sign-up-email"
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
            <Label htmlFor="sign-up-password">Password</Label>
            <InputGroup>
              <InputGroupInput
                {...field}
                id="sign-up-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 8 characters"
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
                  aria-controls="sign-up-password"
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

      <p className="text-xs leading-relaxed text-muted-foreground">
        By continuing, you agree to the{" "}
        <Link href="#" className="underline underline-offset-4">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="#" className="underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>

      <Button type="submit" className="w-full gap-2" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <>
            Create account
            <ArrowRight aria-hidden="true" />
          </>
        )}
      </Button>
    </form>
  );
}
