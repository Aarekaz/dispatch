"use client";

import { useParams } from "next/navigation";

import { useAgent } from "@/hooks/use-agents";
import { useSandbox } from "@/hooks/use-sandbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/unicode-spinner";
import { SandboxDetails } from "@/components/workspace/sandbox-details";
import { cn } from "@/lib/utils";

/**
 * Live sandbox status pill — shows whether the agent's compute
 * is running, starting up, or stopped. Polls every 8 seconds
 * via `useSandbox`.
 *
 * Click the pill to open a Zo-computer-style popover with the full
 * system dashboard (CPU, memory, disk, region, auto-stop, preview
 * URL) and Reload / Stop actions. That surfaces all the "what is
 * my agent running on" details without bloating the Settings page.
 */
export function SandboxPill() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent } = useAgent(agentId);
  const sandbox = useSandbox(agentId);
  const { data, isLoading } = sandbox;

  const state = data?.state;
  const isRunning = state === "started" || state === "running";
  const isStopping = state === "stopping";
  const isStarting =
    !isStopping && (isLoading || !state || state === "starting");
  const isTransient = isStarting || isStopping;

  return (
    <Popover>
      <PopoverTrigger
        render={(props) => (
          <button
            type="button"
            {...props}
            className={cn(
              "fixed right-16 top-4 z-50 flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium shadow-sm transition-colors",
              "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "hover:border-muted-foreground/40",
              isTransient
                ? "border-border/60 bg-background text-muted-foreground"
                : isRunning
                  ? "border-success/20 bg-success-subtle text-success"
                  : "border-border/60 bg-background text-muted-foreground",
            )}
            aria-label={
              isStopping
                ? "Sandbox stopping — click for details"
                : isStarting
                  ? "Sandbox starting — click for details"
                  : isRunning
                    ? "Sandbox running — click for details"
                    : "Sandbox stopped — click for details"
            }
          >
            {/* Icon slot — fixed width prevents pill from reflowing between
                animation frames. The `breathe` and `cascade` contexts render
                as 3-char braille grids (~18px at text-[10px]); w-5 gives a
                hair of breathing room. */}
            <span className="inline-flex w-5 shrink-0 items-center justify-center leading-none">
              {isTransient ? (
                <Spinner
                  context="booting"
                  className="text-[10px] leading-none"
                />
              ) : isRunning ? (
                <Spinner
                  context="connecting"
                  className="text-[10px] leading-none text-success"
                />
              ) : (
                <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              )}
            </span>
            <span className="leading-none">
              {isStopping
                ? "Stopping…"
                : isStarting
                  ? "Starting…"
                  : isRunning
                    ? "Running"
                    : "Stopped"}
            </span>
          </button>
        )}
      />
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto p-0"
      >
        <SandboxDetails
          agentName={agent?.name ?? "Agent"}
          data={sandbox.data}
          isLoading={sandbox.isLoading}
          isMutating={sandbox.isMutating}
          stop={sandbox.stop}
          restart={sandbox.restart}
          error={sandbox.error}
        />
      </PopoverContent>
    </Popover>
  );
}
