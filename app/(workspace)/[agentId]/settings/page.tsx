"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowUpRight } from "@phosphor-icons/react";
import { sileo } from "sileo";

import { useAgent } from "@/hooks/use-agents";
import { useModels } from "@/hooks/use-agent-config";
import { channelLabel } from "@/lib/channels";
import {
  TOOL_PRESETS,
  DEFAULT_PRESET,
  type ToolPreset,
  type ToolPermission,
} from "@/lib/config/tool-permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/unicode-spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChannelPill } from "@/components/ui/channel-pill";
import { cn } from "@/lib/utils";

import { AgentManagementIdentity } from "@/components/agent-management/agent-management-identity";
import { AgentManagementDangerZone } from "@/components/agent-management/agent-management-danger-zone";

/**
 * Agent settings — page-controlled, single coherent form.
 *
 * Architecture difference vs the previous version:
 *   - The PAGE owns all editable state (`draft`). Sub-sections are
 *     presentational: read from the merged `draft + agent` view, push
 *     edits back via `set(field, value)`.
 *   - One sticky save bar replaces the previous 3 inconsistent
 *     per-section save buttons. Saves all dirty fields in a single
 *     PATCH; "applied after the next restart" status is unified.
 *   - Identity is editable inline (name + role) — was read-only.
 *   - Channels summarize as a single bordered card (replacing the
 *     pills + "Manage channels" link), with an Edit affordance that
 *     links to the dedicated /connect page where the full picker lives.
 *   - Danger zone stays separate (its action is destructive +
 *     irreversible — does not belong in a batch save).
 */

type Draft = {
  name?: string;
  vertical?: string;
  persona?: string;
  model?: string;
  toolPermissions?: string;
};

const PRESET_ORDER: ToolPreset[] = ["conservative", "balanced", "permissive"];

const TOOL_LABELS: Record<string, string> = {
  bash: "Terminal",
  read: "Read files",
  write: "Write files",
  edit: "Edit files",
  browser: "Web browser",
  email: "Email",
  memory: "Memory",
  web_fetch: "Open URLs",
  web_search: "Search the web",
};

export default function SettingsPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent, isLoading } = useAgent(agentId);
  const { data: models } = useModels();

  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const v = <K extends keyof Draft>(key: K, fallback: string): string =>
    (draft[key] as string | undefined) ?? fallback;

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const isDirty = Object.keys(draft).length > 0;
  const dirtyCount = Object.keys(draft).length;

  async function handleSave() {
    if (!isDirty) return;
    setSaving(true);
    const promise = (async () => {
      const res = await fetch(`/api/agents/${agentId}`, {
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
      loading: { title: "Saving changes…", duration: null },
      success: {
        title: "Saved",
        description: "Applied after the next restart.",
      },
      error: (err) => ({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Try again.",
      }),
    });

    promise.finally(() => setSaving(false));
  }

  function handleDiscard() {
    setDraft({});
  }

  if (isLoading || !agent) {
    return <SettingsSkeleton />;
  }

  // Merged values used by every section below.
  const name = v("name", agent.name);
  const vertical = v("vertical", agent.vertical);
  const persona = v("persona", agent.persona ?? "");
  const model = v("model", agent.model);
  const toolPermissions = v(
    "toolPermissions",
    (agent.toolPermissions as ToolPreset) || DEFAULT_PRESET,
  ) as ToolPreset;

  return (
    <div className="h-full overflow-auto">
      {/* Bottom padding clears the sticky save bar so the last section
          (Danger zone) isn't covered by the floating bar. */}
      <div className="mx-auto max-w-3xl px-4 pb-32 pt-12">
        <AgentManagementIdentity
          name={name}
          vertical={vertical}
          onChangeName={(value) => set("name", value)}
          onChangeVertical={(value) => set("vertical", value)}
          reachabilitySentence={
            <ChannelSummary channels={agent.channels} name={name} />
          }
        />

        <div className="mt-16 space-y-16">
          <ChannelsCard agentId={agentId} channels={agent.channels} />
          <BehaviorSection
            value={persona}
            onChange={(value) => set("persona", value)}
          />
          <ModelSection
            value={model}
            models={models}
            onChange={(value) => set("model", value)}
          />
          <PermissionsSection
            value={toolPermissions}
            onChange={(value) => set("toolPermissions", value)}
          />
          <AgentManagementDangerZone
            agentId={agentId}
            agentName={agent.name}
          />
        </div>
      </div>

      {/* Sticky save bar — only visible when anything is dirty. */}
      {isDirty && (
        <SaveBar
          dirtyCount={dirtyCount}
          saving={saving}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      )}
    </div>
  );
}

/* ── Channels card ─────────────────────────────────────── */

function ChannelsCard({
  agentId,
  channels,
}: {
  agentId: string;
  channels: string[];
}) {
  const externals = channels.filter((c) => c !== "web");
  return (
    <section>
      <header className="mb-4">
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          Channels
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Where this agent can be reached.
        </p>
      </header>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChannelPill channel="web" />
          {externals.map((channel) => (
            <ChannelPill key={channel} channel={channel} />
          ))}
          {externals.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Web only — connect more channels to expand reach.
            </span>
          )}
        </div>
        <Link
          href={`/${agentId}/connect` as Route}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Edit
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </section>
  );
}

/* ── Behavior (Instructions) ───────────────────────────── */

function BehaviorSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section>
      <header className="mb-4">
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          Instructions
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Tell this agent who it is, what to do, and what to avoid. Plain
          English — no special syntax.
        </p>
      </header>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-[320px] resize-y text-sm leading-relaxed"
        placeholder="Describe the agent's role, what it should do, and any guardrails."
      />
    </section>
  );
}

/* ── Model ──────────────────────────────────────────────── */

function ModelSection({
  value,
  models,
  onChange,
}: {
  value: string;
  models: { id: string; label: string; provider: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <section>
      <header className="mb-4">
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          Model
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Which AI model powers this agent.
        </p>
      </header>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger size="sm" className="w-auto min-w-[220px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
              <span className="ml-2 text-xs text-muted-foreground">
                {m.provider}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

/* ── Permissions ────────────────────────────────────────── */

function PermissionsSection({
  value,
  onChange,
}: {
  value: ToolPreset;
  onChange: (value: ToolPreset) => void;
}) {
  const activePreset = TOOL_PRESETS[value];
  return (
    <section>
      <header className="mb-4">
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          Permissions
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Which tools this agent can use without asking you first.
        </p>
      </header>

      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        role="radiogroup"
        aria-label="Permission preset"
      >
        {PRESET_ORDER.map((key) => {
          const preset = TOOL_PRESETS[key];
          const isSelected = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(key)}
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                isSelected
                  ? "border-foreground bg-accent"
                  : "border-border hover:border-muted-foreground/40",
              )}
            >
              <span className="block text-sm font-medium text-foreground">
                {preset.label}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          {activePreset.label} lets the agent:
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
          {Object.entries(activePreset.permissions).map(([tool, level]) => (
            <PermissionIndicator
              key={tool}
              label={TOOL_LABELS[tool] ?? tool}
              level={level}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PermissionIndicator({
  label,
  level,
}: {
  label: string;
  level: ToolPermission;
}) {
  const isAllowed = level === "allow";
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className={isAllowed ? "text-success" : "text-destructive"}
        aria-hidden="true"
      >
        {isAllowed ? "\u2713" : "\u2717"}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/* ── Sticky save bar ───────────────────────────────────── */

function SaveBar({
  dirtyCount,
  saving,
  onSave,
  onDiscard,
}: {
  dirtyCount: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 transform"
      role="region"
      aria-label="Unsaved changes"
    >
      <div className="flex items-center gap-3 rounded-full border border-border bg-background px-4 py-2 shadow-lg">
        <span className="text-xs text-muted-foreground tabular-nums">
          {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={saving}
        >
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving && <Spinner context="button" className="text-[10px]" />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

/* ── Editorial summary sentence ─────────────────────────── */

function ChannelSummary({
  channels,
  name,
}: {
  channels: string[];
  name: string;
}) {
  const externalChannels = channels.filter((c) => c !== "web");

  if (externalChannels.length === 0) {
    return (
      <>
        <span className="text-foreground">{name}</span> is reachable on{" "}
        <span className="text-foreground">web</span>. Add Slack, WhatsApp, or
        email to expand reach.
      </>
    );
  }

  const externalLabels = externalChannels.map(channelLabel);
  const list = formatList(["Web", ...externalLabels]);
  return (
    <>
      <span className="text-foreground">{name}</span> is reachable on{" "}
      <span className="text-foreground">{list}</span>.
    </>
  );
}

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/* ── Skeleton ──────────────────────────────────────────── */

function SettingsSkeleton() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl space-y-12 px-4 py-12">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-10 w-3/4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
