"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsBilling } from "@/components/settings/settings-billing";

/**
 * Billing & usage as a dialog rather than a full page.
 *
 * The content is read-first — current plan, usage this month, a
 * "Manage subscription" action. That's comfortably dialog-sized; a
 * full-page `/settings?tab=billing` felt heavy for how rarely users
 * visit and how little they interact with it.
 *
 * When Stripe Checkout/Portal get wired, the "Manage" button will
 * redirect via `window.location.href = portalUrl` — dialog closes
 * naturally when the browser navigates, no coordination needed.
 */
export function BillingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Billing &amp; usage</DialogTitle>
          <DialogDescription>
            Current plan and what you&apos;ve used this month.
          </DialogDescription>
        </DialogHeader>
        <SettingsBilling />
      </DialogContent>
    </Dialog>
  );
}
