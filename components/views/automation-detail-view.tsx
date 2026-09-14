"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { useMutation } from "convex/react";
import {
  ArrowLeft,
  Check,
  Clock,
  DotsThreeVertical,
  Play,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { sileo } from "sileo";

import { cn, relativeTime, cronToHuman } from "@/lib/utils";
import { deriveRunStatus, getTriggerLabel } from "@/lib/automations/status";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAutomation } from "@/hooks/use-automations";
import { useAgents } from "@/hooks/use-agents";
import { useSlackChannels } from "@/hooks/use-slack-channels";
import { useTelegramChats } from "@/hooks/use-telegram-chats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner, RunStatusIndicator } from "@/components/ui/unicode-spinner";
import { TRIGGER_OPTIONS } from "@/lib/automations/prefetch/trigger-options";

export function AutomationDetailView({
  automationId,
  backHref,
  backLabel = "Automations",
}: {
  automationId: string;
  backHref: Route;
  backLabel?: string;
}) {
  const router = useRouter();
  const { automation, sessions, isLoading } = useAutomation(automationId);
  const { data: agents } = useAgents();
  const updateAutomation = useMutation(api.agentAutomations.update);
  const removeAutomation = useMutation(api.agentAutomations.remove);

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  // ── Local form state (initialized from automation data) ──
  const [name, setName] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // Derive display values: local state if dirty, else from automation
  const displayName = name ?? automation?.name ?? "";
  const displayInstructions = instructions ?? automation?.instructions ?? "";
  const displayEnabled = enabled ?? automation?.enabled ?? true;

  const isDirty =
    name !== null || instructions !== null || enabled !== null;

  const handleSave = useCallback(async () => {
    if (!automation || !isDirty) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (name !== null) updates.name = name;
      if (instructions !== null) updates.instructions = instructions;
      if (enabled !== null) updates.enabled = enabled;

      await updateAutomation({
        id: automation._id,
        ...updates,
      });

      // Reset dirty state
      setName(null);
      setInstructions(null);
      setEnabled(null);

      sileo.success({ title: "Saved", description: "Automation updated." });
    } catch (err) {
      sileo.error({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }, [automation, isDirty, name, instructions, enabled, updateAutomation]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/automations/${automationId}/run`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Run failed");

      if (data.status === "failed") {
        sileo.error({
          title: "Run failed",
          description: data.error ?? data.summary ?? "Unknown error",
        });
      } else {
        sileo.success({
          title: data.status === "running" ? "Started" : "Completed",
          description:
            data.status === "running"
              ? "Automation is running in the background."
              : data.summary?.slice(0, 100) ?? "Automation completed.",
        });
      }
    } catch (err) {
      sileo.error({
        title: "Run failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRunning(false);
    }
  }, [automationId]);

  const handleDelete = useCallback(() => {
    if (!automation) return;
    sileo.action({
      title: `Delete "${automation.name}"?`,
      description:
        "This will permanently delete the automation and all its run history. This cannot be undone.",
      duration: null,
      button: {
        title: "Delete",
        onClick: async () => {
          await removeAutomation({ id: automation._id });
          router.push(backHref);
          sileo.success({ title: "Deleted" });
        },
      },
    });
  }, [automation, removeAutomation, router, backHref]);

  const handleAgentChange = useCallback(
    async (newAgentId: string | null) => {
      if (!automation || newAgentId === null) return;
      await updateAutomation({
        id: automation._id,
        agentId: newAgentId as Id<"agents">,
      });
    },
    [automation, updateAutomation],
  );

  if (isLoading) return <DetailLoadingSkeleton />;
  if (!automation) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Automation not found.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        {/* Back link */}
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={backHref} />}
        >
          <ArrowLeft className="mr-1 size-3" />
          {backLabel}
        </Button>

        {/* Header */}
        <div className="mt-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Input
              value={displayName}
              onChange={(e) => setName(e.target.value)}
              className="h-auto border-none bg-transparent px-0 text-lg font-semibold tracking-tight text-foreground shadow-none focus-visible:ring-0"
              placeholder="Untitled Automation"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={displayEnabled}
              onCheckedChange={(v) => setEnabled(v)}
              aria-label="Enabled"
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon">
                    <DotsThreeVertical className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={handleDelete}
                >
                  <Trash className="mr-2 size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRun}
              disabled={running}
            >
              {running ? (
                <Spinner context="button" className="mr-1.5 text-xs" />
              ) : (
                <Play className="mr-1.5 size-3.5" />
              )}
              Run
            </Button>
          </div>
        </div>

        {/* Slug */}
        <p className="mt-1 text-xs text-muted-foreground">
          /{automation.slug}
        </p>

        {/* Properties */}
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-8">
            <Label className="w-28 shrink-0 text-xs text-muted-foreground">
              Agent
            </Label>
            <Select
              value={String(automation.agentId)}
              onValueChange={handleAgentChange}
            >
              <SelectTrigger className="h-8 w-auto max-w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.emoji ?? ""} {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {automation.composioToolkits &&
            automation.composioToolkits.length > 0 && (
              <ToolkitNarrowing
                allToolkits={automation.composioToolkits}
                allowed={automation.allowedToolkits as string[] | undefined}
                onSave={async (toolkits) => {
                  await updateAutomation({
                    id: automation._id,
                    allowedToolkits: toolkits,
                  });
                  sileo.success({ title: "Tools updated" });
                }}
              />
            )}
        </div>

        {/* Divider */}
        <div className="my-16" aria-hidden="true" />

        {/* Schedules */}
        <ScheduleEditor
          schedules={automation.schedules as Array<{ id: string; cron: string; timezone: string }>}
          onSave={async (schedules) => {
            await updateAutomation({
              id: automation._id,
              schedules,
            });
            sileo.success({ title: "Schedules updated" });
          }}
        />

        {/* Triggers */}
        <TriggerEditor
          agentId={automation.agentId as string}
          triggers={automation.triggers as Array<{ id: string; type: string; label?: string; config: unknown }>}
          connectedPlatforms={automation.connectedPlatforms as Array<{ platform: string; channelBinding: string | null }>}
          composioToolkits={automation.composioToolkits as string[] ?? []}
          onSave={async (triggers) => {
            await updateAutomation({ id: automation._id, triggers });
            sileo.success({ title: "Triggers updated" });
          }}
        />

        {/* Delivery */}
        <DeliveryPicker
          agentId={String(automation.agentId)}
          current={automation.defaultDelivery as { type: string; config?: unknown } | undefined}
          connectedPlatforms={automation.connectedPlatforms as Array<{ platform: string; channelBinding: string | null }> ?? []}
          onSave={async (delivery) => {
            await updateAutomation({
              id: automation._id,
              defaultDelivery: delivery as { type: "activity_log" | "slack_channel"; config?: unknown },
            });
            sileo.success({ title: "Delivery updated" });
          }}
        />

        {/* Divider */}
        <div className="my-16" aria-hidden="true" />

        {/* Instructions */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Instructions
            </h2>
            {isDirty && (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Spinner context="button" className="mr-1.5 text-xs" />
                ) : (
                  <Check className="mr-1.5 size-3" />
                )}
                Save
              </Button>
            )}
          </div>
          <Textarea
            value={displayInstructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Tell the agent what to do when this automation runs..."
            rows={12}
            className="mt-3 resize-y font-mono text-sm"
          />
        </section>

        {/* Divider */}
        <div className="my-16" aria-hidden="true" />

        {/* Sessions (runs) */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Runs{" "}
              {sessions.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {sessions.length}
                </span>
              )}
            </h2>
          </div>
          {sessions.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No runs yet. Click Run to trigger this automation manually.
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {sessions.map((session) => {
                const status = deriveRunStatus(session);
                const isActive = status === "pending" || status === "running";

                return (
                  <li key={session._id}>
                    <Link
                      // Run detail lives under the workspace so the
                      // user keeps their dock + sandbox pill after
                      // clicking in. Agent id comes from the loaded
                      // automation (always present when sessions are).
                      href={
                        `/${automation.agentId}/automations/${automationId}/runs/${session._id}` as Route
                      }
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-accent/30"
                    >
                      {isActive ? (
                        <Spinner context="running" className="text-xs text-muted-foreground" />
                      ) : status === "failed" ? (
                        <RunStatusIndicator status="failed" />
                      ) : (
                        <RunStatusIndicator status="completed" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {status === "pending"
                            ? "Preparing..."
                            : status === "running"
                              ? "Running..."
                              : status === "failed"
                                ? session.title ?? "Failed"
                                : session.title ?? "Completed"}
                        </p>
                      </div>
                      {session.automationTrigger && (
                        <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                          {getTriggerLabel(session.automationTrigger)}
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(session.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── Trigger editor ──────────────────────────── */

function TriggerEditor({
  agentId,
  triggers,
  connectedPlatforms,
  composioToolkits,
  onSave,
}: {
  agentId: string;
  triggers: Array<{ id: string; type: string; label?: string; config: unknown }>;
  connectedPlatforms: Array<{ platform: string; channelBinding: string | null }>;
  composioToolkits: string[];
  onSave: (triggers: Array<{ id: string; type: string; label?: string; config: unknown }>) => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [slackChannels, setSlackChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);

  const hasSlack = connectedPlatforms.some((p) => p.platform === "slack");

  // Determine which trigger types are available to this agent
  const availableToolkits = new Set([
    ...composioToolkits.map((t) => t.toLowerCase()),
    ...(hasSlack ? ["slack"] : []),
  ]);

  // Fetch Slack channels when selecting the scanner trigger
  const fetchSlackChannels = useCallback(async () => {
    if (slackChannels.length > 0) return;
    setLoadingChannels(true);
    try {
      const params = new URLSearchParams({ agentId });
      const res = await fetch(`/api/slack/channels?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSlackChannels(data.channels ?? []);
      }
    } catch { /* non-critical */ }
    finally { setLoadingChannels(false); }
  }, [agentId, slackChannels.length]);

  function selectTriggerType(type: string) {
    const option = TRIGGER_OPTIONS.find((t) => t.type === type);
    if (!option) return;
    setSelectedType(type);
    setConfigValues({ ...option.defaultConfig });
    setShowAdvanced(false);
    if (type === "slack.channel_scanner") void fetchSlackChannels();
  }

  async function handleAddTrigger() {
    if (!selectedType) return;
    const option = TRIGGER_OPTIONS.find((t) => t.type === selectedType);
    if (!option) return;

    // For Slack scanner, inject teamId from the binding
    const config = { ...configValues };
    if (selectedType === "slack.channel_scanner") {
      const slackBinding = connectedPlatforms.find((p) => p.platform === "slack");
      const binding = slackBinding?.channelBinding ?? "";
      if (binding.startsWith("team:")) config.teamId = binding.replace("team:", "");
    }

    // Validate required fields before saving
    const requiredFields = option.configFields.filter((f) => !f.advanced && f.type === "text");
    for (const field of requiredFields) {
      const val = config[field.key];
      if (!val || String(val).trim() === "") {
        sileo.error({ title: `${field.label} is required` });
        return;
      }
    }
    // For Slack scanner, channelId is required
    if (selectedType === "slack.channel_scanner" && !config.channelId) {
      sileo.error({ title: "Please select a channel" });
      return;
    }

    const newTrigger = {
      id: `trg_${Date.now().toString(36)}`,
      type: selectedType,
      label: option.label,
      config,
    };
    await onSave([...triggers, newTrigger]);
    setShowAdd(false);
    setSelectedType(null);
  }

  async function handleRemove(id: string) {
    await onSave(triggers.filter((t) => t.id !== id));
  }

  const basicFields = selectedType
    ? (TRIGGER_OPTIONS.find((t) => t.type === selectedType)?.configFields ?? []).filter((f) => !f.advanced)
    : [];
  const advancedFields = selectedType
    ? (TRIGGER_OPTIONS.find((t) => t.type === selectedType)?.configFields ?? []).filter((f) => f.advanced)
    : [];

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Triggers</h2>
        {triggers.length < 3 && (
          <Button variant="ghost" size="sm" onClick={() => { setShowAdd(!showAdd); setSelectedType(null); }}>
            <Plus className="mr-1 size-3" />
            Add
          </Button>
        )}
      </div>

      {triggers.length === 0 && !showAdd && (
        <p className="mt-2 text-xs text-muted-foreground">
          No triggers. Click + to add a data source.
        </p>
      )}

      {/* Existing triggers */}
      {triggers.length > 0 && (
        <div className="mt-3 space-y-2">
          {triggers.map((t) => {
            const option = TRIGGER_OPTIONS.find((o) => o.type === t.type);
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <span className="text-base">{option?.icon ?? "⚡"}</span>
                <span className="flex-1 text-xs font-medium text-foreground">
                  {t.label ?? option?.label ?? t.type}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(t.id)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add trigger panel */}
      {showAdd && !selectedType && (
        <div className="mt-3 space-y-2">
          {TRIGGER_OPTIONS.map((option) => {
            const available = availableToolkits.has(option.requiredToolkit);
            const alreadyAdded = triggers.some((t) => t.type === option.type);
            return (
              <button
                key={option.type}
                type="button"
                disabled={!available || alreadyAdded}
                onClick={() => selectTriggerType(option.type)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md border border-border p-3 text-left transition-colors",
                  available && !alreadyAdded
                    ? "hover:bg-accent/50"
                    : "cursor-not-allowed opacity-40",
                )}
              >
                <span className="mt-0.5 text-base">{option.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{option.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {!available
                      ? `Connect ${option.requiredToolkit} on the agent's settings page first.`
                      : alreadyAdded
                        ? "Already added."
                        : option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Config form for selected trigger type */}
      {showAdd && selectedType && (
        <div className="mt-3 rounded-md border border-border p-3">
          <p className="mb-3 text-xs font-medium text-foreground">
            Configure {TRIGGER_OPTIONS.find((t) => t.type === selectedType)?.label}
          </p>
          <div className="space-y-3">
            {basicFields.map((field) => (
              <TriggerConfigField
                key={field.key}
                field={field}
                value={configValues[field.key]}
                slackChannels={field.key === "channelId" ? slackChannels : undefined}
                loadingChannels={field.key === "channelId" ? loadingChannels : false}
                onChange={(val) => setConfigValues((prev) => ({ ...prev, [field.key]: val }))}
              />
            ))}

            {advancedFields.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showAdvanced ? "Hide" : "Show"} advanced settings
                </button>
                {showAdvanced && advancedFields.map((field) => (
                  <TriggerConfigField
                    key={field.key}
                    field={field}
                    value={configValues[field.key]}
                    onChange={(val) => setConfigValues((prev) => ({ ...prev, [field.key]: val }))}
                  />
                ))}
              </>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedType(null); setShowAdd(false); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddTrigger}>
              Add Trigger
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Renders a single config field based on its type. */
function TriggerConfigField({
  field,
  value,
  slackChannels,
  loadingChannels,
  onChange,
}: {
  field: { key: string; label: string; type: string; placeholder?: string; helpText?: string };
  value: unknown;
  slackChannels?: Array<{ id: string; name: string }>;
  loadingChannels?: boolean;
  onChange: (val: unknown) => void;
}) {
  // Special case: channelId rendered as a Slack channel dropdown
  if (field.key === "channelId" && slackChannels) {
    return (
      <div>
        <Label className="text-xs">{field.label}</Label>
        {loadingChannels ? (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Spinner context="loading" className="text-[10px]" />Loading channels…</p>
        ) : slackChannels.length > 0 ? (
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>Select a channel</option>
            {slackChannels.map((ch) => (
              <option key={ch.id} value={ch.id}>#{ch.name}</option>
            ))}
          </select>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">
            No channels found. Make sure the bot is added to a channel.
          </p>
        )}
        {field.helpText && <p className="mt-1 text-[11px] text-muted-foreground">{field.helpText}</p>}
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs">{field.label}</Label>
          {field.helpText && <p className="text-[11px] text-muted-foreground">{field.helpText}</p>}
        </div>
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    );
  }

  return (
    <div>
      <Label className="text-xs">{field.label}</Label>
      <Input
        type={field.type === "number" ? "number" : "text"}
        className="mt-1 text-xs"
        placeholder={field.placeholder}
        value={value != null ? String(value) : ""}
        onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)}
      />
      {field.helpText && <p className="mt-1 text-[11px] text-muted-foreground">{field.helpText}</p>}
    </div>
  );
}

/* ── Schedule editor ─────────────────────────── */

const FREQUENCIES = ["Hourly", "Daily", "Weekdays", "Weekly"] as const;
type Frequency = (typeof FREQUENCIES)[number];

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const period = i >= 12 ? "pm" : "am";
  const h = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${h}:00${period}` };
});

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

function buildCron(freq: Frequency, hour: number, day: number): string {
  switch (freq) {
    case "Hourly": return "0 * * * *";
    case "Daily": return `0 ${hour} * * *`;
    case "Weekdays": return `0 ${hour} * * 1-5`;
    case "Weekly": return `0 ${hour} * * ${day}`;
  }
}

function ScheduleEditor({
  schedules,
  onSave,
}: {
  schedules: Array<{ id: string; cron: string; timezone: string }>;
  onSave: (
    schedules: Array<{ id: string; cron: string; timezone: string }>,
  ) => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [freq, setFreq] = useState<Frequency>("Daily");
  const [hour, setHour] = useState(9);
  const [day, setDay] = useState(1);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleSchedule = async () => {
    const cron = buildCron(freq, hour, day);
    const newSchedule = {
      id: `sch_${freq.toLowerCase()}_${day}_${hour}_${schedules.length + 1}`,
      cron,
      timezone: tz,
    };
    await onSave([...schedules, newSchedule]);
    setShowAdd(false);
  };

  const handleRemove = async (id: string) => {
    await onSave(schedules.filter((s) => s.id !== id));
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Schedules</h2>
        {schedules.length < 3 && (
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="size-3" />
          </button>
        )}
      </div>

      {schedules.length === 0 && !showAdd && (
        <p className="mt-2 text-xs text-muted-foreground">
          No schedules. Click + to run on a timer.
        </p>
      )}

      {schedules.length > 0 && (
        <div className="mt-3 space-y-2">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
            >
              <Clock className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm text-foreground">
                {cronToHuman(s.cron)}
              </span>
              <span className="text-xs text-muted-foreground">
                {s.timezone.replace(/^America\//, "").replace(/_/g, " ")}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(s.id)}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="mt-3 rounded-lg border border-border p-4">
          {/* Frequency tabs */}
          <p className="text-xs font-medium text-foreground">Frequency</p>
          <div className="mt-2 flex gap-1">
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFreq(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs transition-colors",
                  freq === f
                    ? "bg-foreground text-background"
                    : "bg-accent/50 text-foreground hover:bg-accent",
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Time picker (not shown for Hourly) */}
          {freq !== "Hourly" && (
            <div className="mt-4">
              <p className="text-xs font-medium text-foreground">Time</p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={hour}
                  onChange={(e) => setHour(parseInt(e.target.value, 10))}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  {HOURS.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  {tz.replace(/^America\//, "").replace(/_/g, " ")}
                </span>
              </div>
            </div>
          )}

          {/* Day picker (only for Weekly) */}
          {freq === "Weekly" && (
            <div className="mt-4">
              <p className="text-xs font-medium text-foreground">Day</p>
              <div className="mt-2">
                <select
                  value={day}
                  onChange={(e) => setDay(parseInt(e.target.value, 10))}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSchedule}>
              Schedule
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Toolkit narrowing ───────────────────────── */

function ToolkitNarrowing({
  allToolkits,
  allowed,
  onSave,
}: {
  allToolkits: string[];
  allowed: string[] | undefined;
  onSave: (toolkits: string[]) => Promise<void>;
}) {
  // If allowed is empty/undefined, all are enabled
  const enabledSet = new Set(
    allowed && allowed.length > 0 ? allowed : allToolkits,
  );

  const handleToggle = async (toolkit: string) => {
    const next = new Set(enabledSet);
    if (next.has(toolkit)) {
      next.delete(toolkit);
      // Don't allow disabling everything
      if (next.size === 0) return;
    } else {
      next.add(toolkit);
    }
    // If all are enabled, save as empty array (inherit full set)
    const arr = next.size === allToolkits.length ? [] : [...next];
    await onSave(arr);
  };

  return (
    <div className="flex items-start gap-8">
      <Label className="w-28 shrink-0 pt-1 text-xs text-muted-foreground">
        Tools
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {allToolkits.map((toolkit) => {
          const isEnabled = enabledSet.has(toolkit);
          return (
            <button
              key={toolkit}
              type="button"
              onClick={() => handleToggle(toolkit)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs transition-colors",
                isEnabled
                  ? "border-foreground/20 bg-foreground/5 text-foreground"
                  : "border-border bg-transparent text-muted-foreground/50 line-through",
              )}
            >
              {toolkit}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Delivery picker (dynamic based on agent integrations) ── */

function extractTeamId(binding: string | null): string | null {
  if (!binding) return null;
  if (binding.startsWith("team:")) return binding.replace("team:", "");
  // For channel bindings, we'd need the team too — but it's not in the string.
  // The API route handles this via chatState lookup.
  return null;
}

function DeliveryPicker({
  agentId,
  current,
  connectedPlatforms,
  onSave,
}: {
  agentId: string;
  current: { type: string; config?: unknown } | undefined;
  connectedPlatforms: Array<{ platform: string; channelBinding: string | null }>;
  onSave: (delivery: { type: string; config?: unknown }) => Promise<void>;
}) {
  const currentConfig = (current?.config ?? {}) as {
    channelId?: string;
    chatId?: string;
    channelName?: string;
    chatTitle?: string;
  };
  const deliveryType = current?.type ?? "activity_log";
  const currentChannelId = currentConfig.channelId;
  const currentChatId = currentConfig.chatId;

  const hasSlack = connectedPlatforms.some((p) => p.platform === "slack");
  const slackBinding = connectedPlatforms.find((p) => p.platform === "slack");
  const teamId = slackBinding ? extractTeamId(slackBinding.channelBinding) : null;
  const isSlackSelected = deliveryType === "slack_channel";

  // Lazy-fetch the Slack channel list (for the dropdown) when the
  // user first selects the Slack delivery option. See
  // `hooks/use-slack-channels.ts` for the caching semantics — the
  // fetch runs once per picker session, not per render.
  const { channels: slackChannels, loading: loadingChannels } =
    useSlackChannels({
      agentId,
      teamId,
      enabled: isSlackSelected && hasSlack,
    });

  const hasTelegram = connectedPlatforms.some((p) => p.platform === "telegram");
  const isTelegramSelected = deliveryType === "telegram_channel";

  // Same lazy-fetch pattern for the Telegram chat dropdown.
  const { chats: telegramChats, loading: loadingTgChats } = useTelegramChats({
    agentId,
    enabled: isTelegramSelected && hasTelegram,
  });


  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-foreground">
        Output destination
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Where should the result go when this automation runs?
      </p>
      <div className="mt-3 space-y-2">
        {/* Chat only — always available */}
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-accent/30">
          <input
            type="radio"
            name="delivery"
            checked={deliveryType === "activity_log"}
            onChange={() => onSave({ type: "activity_log" })}
            className="accent-foreground"
          />
          <div>
            <p className="text-xs font-medium text-foreground">
              Show in chat only
            </p>
            <p className="text-[11px] text-muted-foreground">
              The result appears as a session in the agent&apos;s chat list.
            </p>
          </div>
        </label>

        {/* Slack delivery with channel picker */}
        {hasSlack && (
          <div
            className={cn(
              "rounded-md border border-border px-3 py-2.5 transition-colors",
              isSlackSelected ? "bg-accent/10" : "hover:bg-accent/30",
            )}
          >
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="delivery"
                checked={isSlackSelected}
                onChange={() => {
                  // Select Slack, but don't save until a channel is picked
                  if (!currentChannelId && slackChannels.length > 0) {
                    // Auto-pick first channel
                    onSave({
                      type: "slack_channel",
                      config: {
                        teamId,
                        channelId: slackChannels[0].id,
                        channelName: slackChannels[0].name,
                      },
                    });
                  } else if (currentChannelId) {
                    onSave({
                      type: "slack_channel",
                      config: current?.config,
                    });
                  } else {
                    // No channels loaded yet — save placeholder, fetchChannels will fire
                    onSave({
                      type: "slack_channel",
                      config: { teamId },
                    });
                  }
                }}
                className="accent-foreground"
              />
              <div>
                <p className="text-xs font-medium text-foreground">
                  Also post to Slack
                </p>
                <p className="text-[11px] text-muted-foreground">
                  The result is posted to a Slack channel and saved as a session.
                </p>
              </div>
            </label>

            {/* Channel picker — shown when Slack is selected */}
            {isSlackSelected && (
              <div className="mt-3 pl-7">
                {loadingChannels ? (
                  <div className="flex items-center gap-2">
                    <Spinner context="loading" className="text-xs text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Loading channels...
                    </span>
                  </div>
                ) : slackChannels.length > 0 ? (
                  <select
                    value={currentChannelId ?? ""}
                    onChange={(e) => {
                      const ch = slackChannels.find((c) => c.id === e.target.value);
                      if (ch) {
                        onSave({
                          type: "slack_channel",
                          config: {
                            teamId,
                            channelId: ch.id,
                            channelName: ch.name,
                          },
                        });
                      }
                    }}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  >
                    <option value="" disabled>
                      Select a channel
                    </option>
                    {slackChannels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        #{ch.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No channels found. Make sure the bot is added to a channel.
                  </p>
                )}
                {currentChannelId && !loadingChannels && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Posting to #{currentConfig.channelName ?? currentChannelId}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Telegram delivery with chat picker */}
        {hasTelegram && (
          <div
            className={cn(
              "rounded-md border border-border px-3 py-2.5 transition-colors",
              isTelegramSelected ? "bg-accent/10" : "hover:bg-accent/30",
            )}
          >
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="delivery"
                checked={isTelegramSelected}
                onChange={() => {
                  if (currentChatId) {
                    onSave({
                      type: "telegram_channel",
                      config: { agentId, chatId: currentChatId },
                    });
                  } else if (telegramChats.length > 0) {
                    onSave({
                      type: "telegram_channel",
                      config: {
                        agentId,
                        chatId: String(telegramChats[0].chatId),
                        chatTitle: telegramChats[0].title,
                      },
                    });
                  } else {
                    onSave({
                      type: "telegram_channel",
                      config: { agentId },
                    });
                  }
                }}
                className="accent-foreground"
              />
              <div>
                <p className="text-xs font-medium text-foreground">
                  Also send to Telegram
                </p>
                <p className="text-[11px] text-muted-foreground">
                  The result is sent via the agent&apos;s Telegram bot and
                  saved as a session.
                </p>
              </div>
            </label>

            {isTelegramSelected && (
              <div className="mt-3 pl-7">
                {loadingTgChats ? (
                  <div className="flex items-center gap-2">
                    <Spinner context="loading" className="text-xs text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Loading chats...
                    </span>
                  </div>
                ) : telegramChats.length > 0 ? (
                  <select
                    value={currentChatId ?? ""}
                    onChange={(e) => {
                      const ch = telegramChats.find(
                        (c) => String(c.chatId) === e.target.value,
                      );
                      if (ch) {
                        onSave({
                          type: "telegram_channel",
                          config: {
                            agentId,
                            chatId: String(ch.chatId),
                            chatTitle: ch.title,
                          },
                        });
                      }
                    }}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  >
                    <option value="" disabled>
                      Select a chat
                    </option>
                    {telegramChats.map((ch) => (
                      <option key={ch.chatId} value={String(ch.chatId)}>
                        {ch.type === "private" ? "👤 " : ch.type === "supergroup" || ch.type === "group" ? "👥 " : "📢 "}
                        {ch.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No chats found. Send a message to the bot first, then
                    come back here to pick the chat.
                  </p>
                )}
                {currentChatId && !loadingTgChats && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Posting to {currentConfig.chatTitle ?? `chat ${currentChatId}`}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {!hasSlack && !hasTelegram && (
          <p className="px-3 text-[11px] text-muted-foreground">
            Connect Slack or Telegram on the agent&apos;s settings page to
            unlock more delivery options.
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Loading skeleton ────────────────────────── */

function DetailLoadingSkeleton() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-6 h-8 w-64" />
        <Skeleton className="mt-2 h-3 w-32" />
        <div className="mt-8 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-72" />
        </div>
        <div className="my-16" aria-hidden="true" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
