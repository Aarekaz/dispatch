"use client";

import { Sparkle } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { useArtifacts } from "@/components/workspace/artifacts-context";

/**
 * Top-bar pill that surfaces the artifacts drawer. Sits between the
 * sandbox pill and the user island. Only renders when at least one
 * artifact has been announced this session — when empty it's
 * invisible so we don't crowd the top bar with nothing-there UI.
 *
 * Click toggles the drawer. Matches the sandbox pill's height (h-9)
 * and rounded pill shape so they read as a set when both are visible.
 */
export function ArtifactsPill() {
  const { artifacts, isOpen, toggle } = useArtifacts();

  if (artifacts.length === 0) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "fixed right-36 top-4 z-50 flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium shadow-sm transition-colors",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "hover:border-muted-foreground/40",
        isOpen
          ? "border-foreground bg-accent text-foreground"
          : "border-border/60 bg-background text-foreground",
      )}
      aria-pressed={isOpen}
      aria-label={`${artifacts.length} ${artifacts.length === 1 ? "artifact" : "artifacts"} — click to ${isOpen ? "close" : "open"} drawer`}
    >
      <Sparkle className="size-3.5 text-muted-foreground" />
      <span className="leading-none">
        {artifacts.length}{" "}
        {artifacts.length === 1 ? "artifact" : "artifacts"}
      </span>
    </button>
  );
}
