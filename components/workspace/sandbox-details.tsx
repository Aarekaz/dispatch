"use client";

import {
  ArrowClockwise,
  ArrowSquareOut,
  Clock,
  Cpu,
  Globe,
  HardDrives,
  Memory,
  Square,
  WarningCircle,
} from "@phosphor-icons/react";
import { sileo } from "sileo";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/unicode-spinner";
import { cn } from "@/lib/utils";
import type { SandboxState } from "@/hooks/use-sandbox";

/**
 * Detailed sandbox status rendered inside the top-right pill's popover.
 *
 * Zo-computer-style card grid: each cell shows a small icon + label,
 * then the value in Geist Mono. Values we can derive are shown; values
 * we don't have from Daytona (OS, architecture, GHz, memory usage %)
 * are intentionally omitted rather than faked with placeholders.
 *
 * Reload/Stop live here — this is where users naturally look when
 * they want to kick an agent. "Reload" restarts OpenCode inside the
 * sandbox (fast — ~5s) without stopping the Daytona sandbox itself,
 * so the uptime counter above keeps running. That's intentional: the
 * common need is a config refresh, not a cold reboot.
 */
export function SandboxDetails({
  agentName,
  data,
  isLoading,
  isMutating,
  stop,
  restart,
  error,
}: {
  agentName: string;
  data: SandboxState | null;
  isLoading: boolean;
  isMutating: boolean;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  error: string | null;
}) {
  const state = data?.state ?? "unknown";
  const isRunning = state === "started" || state === "running";
  const isStopped = state === "stopped";
  const isStarting =
    (isLoading && state === "unknown") ||
    state === "starting" ||
    state === "stopping";

  function handleReload() {
    const promise = restart();
    sileo.promise(promise, {
      loading: {
        title: "Reloading agent…",
        description: "This may take 10–20s.",
        duration: null,
      },
      success: { title: "Agent reloaded" },
      error: (err) => ({
        title: "Reload failed",
        description: err instanceof Error ? err.message : "Try again.",
      }),
    });
  }

  function handleStop() {
    const promise = stop();
    sileo.promise(promise, {
      loading: { title: "Stopping agent…", duration: null },
      success: { title: "Agent stopped" },
      error: (err) => ({
        title: "Stop failed",
        description: err instanceof Error ? err.message : "Try again.",
      }),
    });
  }

  const uptimeLabel =
    isRunning && data?.updatedAt ? formatUptime(data.updatedAt) : null;

  const statusLabel = isStarting
    ? state === "stopping"
      ? "Stopping…"
      : "Starting…"
    : isRunning
      ? "Running"
      : isStopped
        ? "Stopped"
        : state;

  return (
    <div className="w-[420px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {agentName}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot state={state} loading={isStarting} />
            <span>{statusLabel}</span>
            {uptimeLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{uptimeLabel}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Error (if any) */}
      {(data?.errorReason || error) && (
        <div className="flex gap-2 border-b border-border/60 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
          <WarningCircle className="size-3.5 shrink-0" />
          <span>{data?.errorReason ?? error}</span>
        </div>
      )}

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-2 p-4">
        {data?.cpu != null && (
          <StatCard icon={Cpu} label="CPU" value={`${data.cpu} cores`} />
        )}
        {data?.memory != null && (
          <StatCard
            icon={Memory}
            label="Memory"
            value={`${data.memory} GB`}
          />
        )}
        {data?.disk != null && (
          <StatCard icon={HardDrives} label="Disk" value={`${data.disk} GB`} />
        )}
        {data?.target && (
          <StatCard icon={Globe} label="Region" value={data.target} />
        )}
        {data?.autoStopInterval != null && data.autoStopInterval > 0 && (
          <StatCard
            icon={Clock}
            label="Auto-stop"
            value={`${data.autoStopInterval} min idle`}
            className="col-span-2"
          />
        )}
        {data?.previewUrl && (
          <a
            href={data.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "col-span-2 rounded-lg border border-border/60 bg-background p-3",
              "transition-colors hover:border-muted-foreground/40 hover:bg-accent/40",
            )}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowSquareOut className="size-3.5" />
              <span>Preview URL</span>
            </div>
            <div className="mt-1 truncate font-mono text-sm text-foreground">
              {data.previewUrl.replace(/^https?:\/\//, "")}
            </div>
          </a>
        )}
      </div>

      {/* Footer meta */}
      {data?.createdAt && (
        <div className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
          Created{" "}
          {new Date(data.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReload}
          disabled={isMutating}
        >
          {isMutating ? (
            <Spinner context="button" className="text-[10px]" />
          ) : (
            <ArrowClockwise className="size-3.5" />
          )}
          Reload
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleStop}
          disabled={isMutating || isStopped || state === "stopping"}
        >
          <Square className="size-3.5" />
          Stop
        </Button>
      </div>
    </div>
  );
}

/* ── Small building blocks ──────────────────────────────── */

function StatCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-background p-3",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function StatusDot({ state, loading }: { state: string; loading: boolean }) {
  if (loading) {
    return (
      <Spinner
        context="booting"
        className="text-[9px] text-muted-foreground"
      />
    );
  }
  const color =
    state === "started" || state === "running"
      ? "bg-success"
      : state === "stopped"
        ? "bg-muted-foreground/50"
        : "bg-warning";
  return (
    <span
      className={cn("size-1.5 rounded-full", color)}
      aria-hidden="true"
    />
  );
}

function formatUptime(updatedAt: string): string {
  const ms = Date.now() - new Date(updatedAt).getTime();
  if (ms < 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}
