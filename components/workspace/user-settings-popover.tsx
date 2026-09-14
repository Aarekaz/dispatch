"use client";

import { useState } from "react";
import { CreditCard, SignOut, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { sileo } from "sileo";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/unicode-spinner";
import { BillingDialog } from "@/components/billing/billing-dialog";
import { previewMessageArrived } from "@/lib/sounds";

/**
 * User-scope settings, rendered inside the UserIsland popover.
 *
 * The sole account-settings surface now. Profile + Personalization
 * edit inline in the popover body; Billing opens as a dialog from
 * the footer (see `BillingDialog`); Memory is agent-scoped and
 * lives at `/[agentId]/files` → Knowledge. No standalone `/settings`
 * page anymore — legacy bookmarks redirect to `/`.
 *
 * Save behavior: one PATCH request for all dirty fields. Popover
 * stays open after save so the user can keep editing or close on
 * their terms.
 */

type Draft = {
  name?: string;
  nickname?: string;
  company?: string;
  industry?: string;
  timezone?: string;
  customInstructions?: string;
  background?: string;
};

export function UserSettingsPopover() {
  const { data: user, isLoading } = useUser();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [soundSaving, setSoundSaving] = useState(false);

  // Local edits override server values; falling back to user.* lets
  // the server-fetched defaults render before any edits.
  const v = <K extends keyof Draft>(key: K, fallback: string): string =>
    (draft[key] as string | undefined) ?? fallback;

  const isDirty = Object.keys(draft).length > 0;
  const inferredTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const promise = (async () => {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
      setDraft({});
    })();

    sileo.promise(promise, {
      loading: { title: "Saving…", duration: null },
      success: { title: "Saved" },
      error: (err) => ({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
      }),
    });

    promise.finally(() => setSaving(false));
  }

  async function handleSignOut() {
    sileo.info({ title: "Signing out…", duration: 2000 });
    await authClient.signOut();
    router.push("/sign-in");
  }

  // Saves immediately — not batched with the Draft footer — because
  // the toggle is one-click and the user wants instant audible
  // feedback. The preview chime fires on enable regardless of the
  // provider state, since the Convex subscription hasn't round-tripped
  // yet at the moment we want the user to hear it.
  async function handleSoundToggle(next: boolean) {
    if (soundSaving) return;
    setSoundSaving(true);
    if (next) previewMessageArrived();
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundEnabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
    } catch (err) {
      sileo.error({
        title: "Couldn't save preference",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSoundSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="w-[440px] p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="mt-4 h-32 w-full" />
      </div>
    );
  }

  const initials = (user.name || user.email || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex max-h-[80vh] w-[440px] flex-col">
      {/* ── Header: avatar + email ────────────── */}
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-medium text-foreground">
          {user.avatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.avatar}
              alt=""
              className="size-full rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {user.name || "Account"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {user.email}
          </p>
        </div>
      </header>

      {/* ── Scrollable body: Profile + Personalization ── */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {/* Profile fields */}
        <section className="space-y-3">
          <FieldRow
            label="Name"
            value={v("name", user.name)}
            onChange={(val) => set("name", val)}
            placeholder="Your full name"
          />
          <FieldRow
            label="Nickname"
            value={v("nickname", user.nickname)}
            onChange={(val) => set("nickname", val)}
            placeholder="What should agents call you?"
          />
          <FieldRow
            label="Timezone"
            value={v("timezone", user.timezone || inferredTz)}
            onChange={(val) => set("timezone", val)}
            placeholder="America/Los_Angeles"
          />
          <FieldRow
            label="Company"
            value={v("company", user.company)}
            onChange={(val) => set("company", val)}
            placeholder="Your company name"
          />
          <FieldRow
            label="Industry"
            value={v("industry", user.industry)}
            onChange={(val) => set("industry", val)}
            placeholder="e.g. Marketing, SaaS"
          />
        </section>

        {/* Personalization */}
        <section className="space-y-4 border-t border-border/60 pt-5">
          <div>
            <label className="block text-xs font-medium text-foreground">
              Custom instructions
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Rules every agent follows.
            </p>
            <Textarea
              value={v("customInstructions", user.customInstructions)}
              onChange={(e) => set("customInstructions", e.target.value)}
              placeholder="e.g. Always use British English. Keep responses concise."
              rows={3}
              className="mt-2 resize-y text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground">
              About you
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Background and context for your agents.
            </p>
            <Textarea
              value={v("background", user.background)}
              onChange={(e) => set("background", e.target.value)}
              placeholder="e.g. I run a 15-person marketing agency."
              rows={3}
              className="mt-2 resize-y text-xs"
            />
          </div>
        </section>
      </div>

      {/* ── Footer: save bar OR navigation links + sign out ── */}
      {isDirty ? (
        <footer className="flex items-center justify-end gap-3 border-t border-border/60 px-4 py-3">
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Spinner context="button" className="text-[10px]" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </footer>
      ) : (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => handleSoundToggle(!user.soundEnabled)}
            disabled={soundSaving}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              {user.soundEnabled ? (
                <SpeakerHigh className="size-3.5" />
              ) : (
                <SpeakerSlash className="size-3.5" />
              )}
              Interface sounds
            </span>
            <span
              aria-hidden
              className={`h-4 w-7 rounded-full transition-colors ${
                user.soundEnabled ? "bg-foreground/80" : "bg-border"
              }`}
            >
              <span
                className={`block size-3 translate-y-0.5 rounded-full bg-background shadow-sm transition-transform ${
                  user.soundEnabled ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>
          <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-2">
            <button
              type="button"
              onClick={() => setBillingOpen(true)}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <CreditCard className="size-3.5" />
              Billing &amp; usage
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <SignOut className="size-3.5" />
              Sign out
            </button>
          </footer>
        </div>
      )}
      <BillingDialog open={billingOpen} onOpenChange={setBillingOpen} />
    </div>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-20 shrink-0 text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 flex-1 text-xs"
      />
    </div>
  );
}
