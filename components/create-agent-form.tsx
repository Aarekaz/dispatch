"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CaretDown, CaretRight } from "@phosphor-icons/react";
import { sileo } from "sileo";

import { agentPacks } from "@/lib/config";
import { DEFAULT_MODEL, MODELS } from "@/lib/models";
import { renderAgentsMd } from "@/lib/agents/render-agents-md";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/unicode-spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ── Templates ───────────────────────────────────────────── */
//
// Four starting points: the 3 real packs from lib/config.ts plus a
// blank "Custom" option. Each template is a starting point — name,
// role, and brief are all editable after selection.

type Template = {
  id: string;
  name: string;
  role: string;
  description: string;
  suggestedName: string;
  brief: string;
};

const CUSTOM_TEMPLATE: Template = {
  id: "custom",
  name: "Custom",
  role: "",
  description: "Start blank. You write the role and the behavior yourself.",
  suggestedName: "",
  brief: "",
};

const TEMPLATES: Template[] = [
  ...agentPacks.map(
    (pack): Template => ({
      id: pack.id,
      name: pack.name,
      role: pack.vertical,
      description: pack.description,
      suggestedName: pack.suggestedName ?? "",
      brief: pack.brief ?? pack.description,
    }),
  ),
  CUSTOM_TEMPLATE,
];

/* ── Form ────────────────────────────────────────────────── */

export function CreateAgentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill from ?pack= query param (set by ghost cards on the home empty state).
  const initialTemplate =
    TEMPLATES.find((t) => t.id === searchParams.get("pack")) ?? TEMPLATES[0];

  const [templateId, setTemplateId] = useState(initialTemplate.id);
  const template = useMemo(
    () => TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0],
    [templateId],
  );

  const [name, setName] = useState(initialTemplate.suggestedName);
  const [role, setRole] = useState(initialTemplate.role);
  const [brief, setBrief] = useState(initialTemplate.brief);
  const [modelId, setModelId] = useState(DEFAULT_MODEL.id);
  const [showPreview, setShowPreview] = useState(false);
  const [deploying, setDeploying] = useState(false);

  // Apply template defaults when the user picks a different template.
  // Keeps any field the user has manually changed (only overwrites if
  // the field still matches the *previous* template's default).
  function selectTemplate(nextId: string) {
    const next = TEMPLATES.find((t) => t.id === nextId);
    if (!next) return;

    const prev = template;
    setTemplateId(nextId);
    if (name === prev.suggestedName) setName(next.suggestedName);
    if (role === prev.role) setRole(next.role);
    if (brief === prev.brief) setBrief(next.brief);
  }

  const selectedModel = useMemo(
    () => MODELS.find((m) => m.id === modelId) ?? DEFAULT_MODEL,
    [modelId],
  );

  const previewMd = useMemo(
    () =>
      renderAgentsMd({
        name: name || "Your agent",
        model: selectedModel?.id ?? "",
        vertical: role || "General",
        persona: brief || undefined,
      }),
    [name, role, brief, selectedModel],
  );

  async function handleDeploy() {
    if (!name.trim()) {
      sileo.error({ title: "Give your agent a name" });
      return;
    }

    setDeploying(true);

    const promise = (async () => {
      const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          vertical: role.trim() || "General",
          model: selectedModel?.id ?? DEFAULT_MODEL.id,
          emoji: undefined,
          persona: brief.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = "Failed to create agent.";
        if (errorText) {
          try {
            const errorData = JSON.parse(errorText) as { error?: string };
            errorMessage = errorData.error ?? errorMessage;
          } catch {
            errorMessage = errorText;
          }
        }
        throw new Error(errorMessage);
      }

      const text = await res.text();
      let data: { error?: string; id?: string } = {};
      if (text) {
        try {
          data = JSON.parse(text) as { error?: string; id?: string };
        } catch {
          throw new Error("Agent creation returned an invalid response.");
        }
      }
      if (!data.id) throw new Error("Agent creation did not return an id.");
      router.push(`/${data.id}/home` as Route);
      return data;
    })();

    sileo.promise(promise, {
      loading: {
        title: "Creating " + (name || "your agent"),
        description: "Provisioning sandbox and writing AGENTS.md…",
        duration: null,
      },
      success: {
        title: `${name} is ready`,
        description: "Your new agent is ready.",
        duration: 4000,
      },
      error: (err) => ({
        title: "Creation failed",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
        duration: null,
      }),
    });

    promise.catch(() => {}).finally(() => setDeploying(false));
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        {/* Top action */}
        <div className="flex items-center justify-start">
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={"/agents" as Route} />}
          >
            <ArrowLeft data-icon="inline-start" />
            Back to agents
          </Button>
        </div>

        {/* Hero */}
        <h1 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
          Create your next AI agent
        </h1>
        <p className="mt-6 max-w-2xl font-serif text-2xl font-normal leading-snug tracking-tight text-muted-foreground md:text-3xl">
          Pick a starting template, customize their behavior, and{" "}
          <span className="text-foreground">deploy in about a minute</span>.
        </p>

        {/* ── Pick a template ── */}
        <Section title="Pick a template" className="mt-16">
          <div className="grid gap-3 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                selected={t.id === templateId}
                onSelect={() => selectTemplate(t.id)}
              />
            ))}
          </div>
        </Section>

        {/* ── Identity ── */}
        <Section title="Identity" className="mt-16">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-name" className="text-xs">
                Name
              </Label>
              <Input
                id="agent-name"
                placeholder="Sarah"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-role" className="text-xs">
                Role
              </Label>
              <Input
                id="agent-role"
                placeholder="Customer Support"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
          </div>
        </Section>

        {/* ── Behavior ── */}
        <Section title="Behavior" className="mt-16">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-brief" className="text-xs">
                What should this agent do? Plain English.
              </Label>
              <Textarea
                id="agent-brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                spellCheck={false}
                className="min-h-[320px] text-sm leading-relaxed"
                placeholder="Describe the agent's role, what it should do, and what it should never do."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Model</Label>
              <Select
                value={modelId}
                onValueChange={(v) => v && setModelId(v)}
              >
                <SelectTrigger size="sm" className="w-full sm:w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.provider}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        {/* ── Reach (Coming soon) ── */}
        <Section title="Reach" className="mt-16">
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every new agent is reachable on{" "}
            <span className="text-foreground">web</span> by default. Slack,
            WhatsApp, Telegram, Email, and Discord are{" "}
            <span className="text-foreground">coming soon</span> — connect them
            on each agent&apos;s manage page after deployment.
          </p>
        </Section>

        {/* ── AGENTS.md preview ── */}
        <Section title="Preview" className="mt-16">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showPreview ? (
              <CaretDown className="size-3" />
            ) : (
              <CaretRight className="size-3" />
            )}
            {showPreview ? "Hide" : "Show"} the AGENTS.md that will be written
          </button>
          {showPreview && (
            <pre className="mt-3 overflow-auto rounded-lg border border-border bg-secondary/30 p-4 font-mono text-[11px] leading-relaxed text-foreground">
              {previewMd}
            </pre>
          )}
        </Section>

        {/* ── Deploy ── */}
        <div className="mt-16 flex items-center justify-end gap-3">
          {deploying && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner context="booting" className="text-[10px]" />
              Provisioning sandbox…
            </span>
          )}
          <Button onClick={handleDeploy} disabled={deploying || !name.trim()}>
            {deploying ? (
              <>
                <Spinner context="button" className="text-[10px]" />
                Creating…
              </>
            ) : (
              `Create ${name || "this agent"}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Section header ──────────────────────────────────────── */

function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <h2 className="mb-4 text-sm font-medium tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ── Template card ───────────────────────────────────────── */

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: Template;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group flex flex-col items-start rounded-xl border p-4 text-left outline-none transition-all",
        selected
          ? "border-foreground/30 bg-secondary/40 shadow-card"
          : "border-border bg-background hover:border-foreground/15 hover:bg-secondary/20",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{template.name}</p>
        {selected && (
          <span className="shrink-0 text-xs text-muted-foreground">
            Selected
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {template.description}
      </p>
    </button>
  );
}
