"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail } from "lucide-react";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";

const schema = z.object({
  email: z.email("Enter a valid email address."),
});
type Values = z.infer<typeof schema>;

export function ForgotPasswordForm({
  onSuccess,
  redirectTo = "/reset-password",
}: {
  onSuccess?: () => void;
  redirectTo?: string;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = (values: Values) => {
    startTransition(async () => {
      await authClient.requestPasswordReset({
        email: values.email,
        redirectTo,
      });
      onSuccess?.();
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Controller
        name="email"
        control={form.control}
        render={({ field, fieldState }) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="forgot-email">Email</Label>
            <InputGroup>
              <InputGroupInput
                {...field}
                id="forgot-email"
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
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          "Send reset link"
        )}
      </Button>
    </form>
  );
}
