"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { sileo } from "sileo";
import {
  ArrowRight,
  Check,
  Clock,
  Hand,
  Lightning,
  MagnifyingGlass,
  Pause,
  Plus,
  X,
} from "@phosphor-icons/react";

import { cn, relativeTime, relativeTimeUntil } from "@/lib/utils";
import { computeNextRun } from "@/lib/cron/next-run";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAgent } from "@/hooks/use-agents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from "@/lib/automations/templates";

// Mapped to the `icon` discriminants declared in `lib/automations/templates.ts`.
const TEMPLATE_ICONS: Record<AutomationTemplate["icon"], string> = {
  calendar: "📅",
  eyes: "👀",
  play: "▶️",
};

type TriggerKind = "scheduled" | "event" | "manual" | "paused";

type AutomationRow = {
  _id: Id<"agentAutomations">;
  name: string;
  enabled: boolean;
  instructions: string;
  schedules: Array<{ id: string; cron: string; timezone: string }>;
  triggers: Array<{
    id: string;
    type: string;
    label?: string;
    config: unknown;
  }>;
  defaultDelivery?: {
    type:
      | "activity_log"
      | "slack_channel"
      | "slack_thread"
      | "telegram_channel";
    config?: unknown;
  };
  lastRunStatus?: string;
  lastRunAt?: number;
};

function getTriggerKind(a: AutomationRow): TriggerKind {
  if (!a.enabled) return "paused";
  if (a.schedules.length > 0) return "scheduled";
  if (a.triggers.length > 0) return "event";
  return "manual";
}

const TRIGGER_ICON: Record<TriggerKind, typeof Clock> = {
  scheduled: Clock,
  event: Lightning,
  manual: Hand,
  paused: Pause,
};

function getDeliveryLabel(delivery: AutomationRow["defaultDelivery"]): string {
  if (!delivery) return "Activity log";
  switch (delivery.type) {
    case "activity_log":
      return "Activity log";
    case "slack_channel":
      return "Slack";
    case "slack_thread":
      return "Slack thread";
    case "telegram_channel":
      return "Telegram";
    default:
      return delivery.type;
  }
}

function getRightMeta(a: AutomationRow): {
  label: string;
  statusIcon: "success" | "failed" | null;
} {
  if (!a.enabled) return { label: "Paused", statusIcon: null };

  // Already ran at least once — show last-run info with a status glyph.
  if (a.lastRunAt) {
    const statusIcon: "success" | "failed" | null =
      a.lastRunStatus === "failed"
        ? "failed"
        : a.lastRunStatus === "completed" || a.lastRunStatus === "ok"
          ? "success"
          : null;
    return { label: relativeTime(a.lastRunAt), statusIcon };
  }

  // Never run. For scheduled automations, show the next occurrence so
  // the row says something useful. For event/manual, say so explicitly.
  if (a.schedules.length > 0) {
    try {
      const first = a.schedules[0];
      const next = computeNextRun(first.cron, first.timezone);
      return { label: `Next ${relativeTimeUntil(next)}`, statusIcon: null };
    } catch {
      return { label: "Scheduled", statusIcon: null };
    }
  }

  if (a.triggers.length > 0) return { label: "Listening", statusIcon: null };

  return { label: "Not run yet", statusIcon: null };
}

export default function AutomationsPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent } = useAgent(agentId);
  const automations = useQuery(api.agentAutomations.listByAgent, {
    agentId: agentId as Id<"agents">,
  });
  const [search, setSearch] = useState("");
  const [showGallery, setShowGallery] = useState(false);

  const isLoading = automations === undefined;
  const list = (automations ?? []) as AutomationRow[];

  const filtered = search.trim()
    ? list.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase()),
      )
    : list;

  const activeCount = list.filter((a) => a.enabled).length;
  const pausedCount = list.length - activeCount;
  const countLine = [
    `${list.length} automation${list.length === 1 ? "" : "s"}`,
    activeCount > 0 ? `${activeCount} active` : null,
    pausedCount > 0 ? `${pausedCount} paused` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (isLoading) {
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-2xl space-y-2 px-4 py-12">
          <Skeleton className="mb-6 h-8 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header */}
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-light tracking-tight text-foreground md:text-[26px]">
              Automations
            </h1>
            {list.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">{countLine}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {list.length > 3 && (
              <div className="relative">
                <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-48 pl-8 text-sm"
                />
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowGallery(true)}
            >
              <Plus className="size-3.5" />
              New
            </Button>
          </div>
        </header>

        {/* List */}
        {list.length === 0 ? (
          <EditorialEmpty
            agentName={agent?.name}
            onCreate={() => setShowGallery(true)}
          />
        ) : filtered.length === 0 ? (
          <p className="mt-12 text-center text-sm text-muted-foreground">
            No automations match &ldquo;{search}&rdquo;
          </p>
        ) : (
          <ul className="mt-8 space-y-0.5">
            {filtered.map((a, idx) => (
              <AutomationRowItem
                key={a._id}
                agentId={agentId}
                automation={a}
                index={idx}
              />
            ))}
          </ul>
        )}

        {/* Template gallery dialog */}
        <TemplateGalleryDialog
          agentId={agentId}
          open={showGallery}
          onOpenChange={setShowGallery}
        />
      </div>
    </div>
  );
}

/* ── Row ─────────────────────────────────────────────────── */

function AutomationRowItem({
  agentId,
  automation: a,
  index,
}: {
  agentId: string;
  automation: AutomationRow;
  index: number;
}) {
  const kind = getTriggerKind(a);
  const TriggerIcon = TRIGGER_ICON[kind];
  const { label: rightLabel, statusIcon } = getRightMeta(a);
  const instructionPreview = a.instructions.trim();

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      // 40ms stagger, clamped so very long lists don't feel slow. Under
      // ~400ms total on initial paint is Emil's sweet spot for list
      // entry — any longer and the page feels draggy.
      transition={{
        duration: 0.3,
        delay: Math.min(index * 0.04, 0.32),
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <Link
        href={`/${agentId}/automations/${a._id}` as Route}
        className="group -mx-3 flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-secondary/40"
      >
        <TriggerIcon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            kind === "paused"
              ? "text-muted-foreground/50"
              : kind === "scheduled"
                ? "text-foreground/70"
                : "text-muted-foreground",
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "truncate text-sm font-medium",
                kind === "paused"
                  ? "text-muted-foreground"
                  : "text-foreground",
              )}
            >
              {a.name}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs">
            {instructionPreview ? (
              <span className="text-muted-foreground/80">
                {instructionPreview}
              </span>
            ) : (
              <span className="italic text-muted-foreground/50">
                No instructions yet
              </span>
            )}
            <span className="ml-1.5 inline-flex items-center gap-1 text-muted-foreground/60">
              <ArrowRight className="size-2.5" />
              {getDeliveryLabel(a.defaultDelivery)}
            </span>
          </p>
        </div>

        <div className="shrink-0 pt-0.5 text-right">
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            {statusIcon === "success" && (
              <Check className="size-3 text-success" aria-label="Succeeded" />
            )}
            {statusIcon === "failed" && (
              <X className="size-3 text-destructive" aria-label="Failed" />
            )}
            <span>{rightLabel}</span>
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

/* ── Empty state ─────────────────────────────────────────── */

function EditorialEmpty({
  agentName,
  onCreate,
}: {
  agentName: string | undefined;
  onCreate: () => void;
}) {
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <h2 className="font-serif text-xl font-light tracking-tight text-foreground/90 md:text-[22px]">
        Nothing on a schedule yet.
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Give {agentName ?? "your agent"} work that runs while you sleep —
        checks, reports, summaries, anything that should happen on its own.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-6"
        onClick={onCreate}
      >
        <Plus className="size-3.5" />
        Create the first one
      </Button>
    </div>
  );
}

/* ── Template gallery ─────────────────────────────────────── */

function TemplateGalleryDialog({
  agentId,
  open,
  onOpenChange,
}: {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createAutomation = useMutation(api.agentAutomations.create);

  async function handleSelect(template: AutomationTemplate) {
    try {
      const id = await createAutomation({
        agentId: agentId as Id<"agents">,
        name: template.name,
        instructions: template.defaults.instructions,
        schedules: template.defaults.schedules,
        triggers: template.defaults.triggers,
        defaultDelivery: template.defaults.defaultDelivery,
      });
      sileo.success({
        title: "Automation created",
        description: template.name,
      });
      onOpenChange(false);
      router.push(`/${agentId}/automations/${id}` as Route);
    } catch (err) {
      sileo.error({
        title: "Couldn't create automation",
        description: err instanceof Error ? err.message : "Try again",
      });
    }
  }

  async function handleScratch() {
    try {
      const id = await createAutomation({
        agentId: agentId as Id<"agents">,
        name: "Untitled Automation",
        instructions: "",
      });
      onOpenChange(false);
      router.push(`/${agentId}/automations/${id}` as Route);
    } catch (err) {
      sileo.error({
        title: "Couldn't create automation",
        description: err instanceof Error ? err.message : "Try again",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Automation</DialogTitle>
          <DialogDescription>
            Pick a template to get started, or create one from scratch.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {AUTOMATION_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => handleSelect(template)}
              className="relative flex w-full items-start gap-4 overflow-hidden rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent/50"
            >
              <span className="mt-0.5 text-xl" role="img" aria-hidden>
                {TEMPLATE_ICONS[template.icon] ?? "⚡"}
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {template.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {template.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <button
            type="button"
            onClick={handleScratch}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Create from scratch &rarr;
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
