"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";

const schema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
type Values = z.infer<typeof schema>;

export function ResetPasswordForm({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = (values: Values) => {
    startTransition(async () => {
      const res = await authClient.resetPassword({
        newPassword: values.password,
        token,
      });
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Password reset");
      onSuccess?.();
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Controller
        name="password"
        control={form.control}
        render={({ field, fieldState }) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-password">New password</Label>
            <InputGroup>
              <InputGroupInput
                {...field}
                id="reset-password"
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
        name="confirmPassword"
        control={form.control}
        render={({ field, fieldState }) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <InputGroup>
              <InputGroupInput
                {...field}
                id="reset-confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter password"
                aria-invalid={fieldState.invalid || undefined}
              />
              <InputGroupAddon>
                <Lock aria-hidden="true" />
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
      <Button type="submit" className="w-full" disabled={pending || !token}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          "Reset password"
        )}
      </Button>
    </form>
  );
}
