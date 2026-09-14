"use client";

import { useUser } from "@/hooks/use-user";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserSettingsPopover } from "@/components/workspace/user-settings-popover";

/**
 * Top-right user pill — click opens an inline settings popover with
 * Profile + Personalization edits, plus footer links to Billing
 * (separate page) and Sign out. Replaces the legacy 3-item dropdown
 * (Profile / Billing / Sign out) which navigated away to /settings
 * for every action.
 */
export function UserIsland() {
  const { data: user } = useUser();

  const initials = (user.name || user.email || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="fixed right-4 top-4 z-50">
      <Popover>
        <PopoverTrigger
          className="flex size-9 items-center justify-center rounded-full border border-border/60 bg-background text-xs font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label="Open user settings"
        >
          {user.avatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.avatar}
              alt=""
              className="size-9 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-auto p-0"
        >
          <UserSettingsPopover />
        </PopoverContent>
      </Popover>
    </div>
  );
}
