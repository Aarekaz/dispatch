"use client";

/**
 * Unicode-based animated spinners powered by unicode-animations.
 *
 * Single source of truth for ALL loading/status animations in the app.
 * Instead of Lucide's Loader2 + CSS animate-spin everywhere, each
 * context gets a semantically meaningful braille animation.
 *
 * Usage:
 *   <Spinner />                     — default inline spinner
 *   <Spinner context="thinking" />  — agent working animation
 *   <Spinner context="button" />    — compact button spinner
 *   <Spinner context="booting" />   — sandbox/environment setup
 *
 * The `context` prop maps to a unicode-animations spinner name.
 * Animation choice is centralized here — change a mapping once,
 * every surface updates.
 */
import spinners from "unicode-animations";
import { cn } from "@/lib/utils";
import { useAnimatedFrame } from "@/hooks/use-animated-frame";

/**
 * Semantic contexts → spinner mappings.
 *
 * Each context describes WHY something is spinning, not HOW.
 * The animation is chosen to match the feel of what's happening.
 */
const CONTEXT_MAP: Record<string, keyof typeof spinners> = {
  /** Default — compact inline spinner for general loading */
  default: "braille",
  /** Button actions — saving, submitting, connecting */
  button: "braille",
  /** Agent thinking / executing instructions */
  thinking: "helix",
  /** Sandbox booting / environment setup */
  booting: "cascade",
  /** Fetching data — channels, files, lists */
  loading: "scan",
  /** Run in progress — automation executing */
  running: "orbit",
  /** Tool call executing in chat */
  tool: "braille",
  /** Connecting to external service */
  connecting: "breathe",
};

type SpinnerContext = keyof typeof CONTEXT_MAP;

export function Spinner({
  context = "default",
  className,
  label,
}: {
  /** Semantic context — determines which animation plays */
  context?: SpinnerContext;
  className?: string;
  /** Optional text label shown after the spinner */
  label?: string;
}) {
  const spinnerName = CONTEXT_MAP[context] ?? "braille";
  const { frames, interval } = spinners[spinnerName];
  const frame = useAnimatedFrame(frames.length, interval);

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-mono", className)}
      role="status"
      aria-label={label ?? "Loading"}
    >
      <span aria-hidden="true">{frames[frame]}</span>
      {label && <span className="font-sans">{label}</span>}
    </span>
  );
}

/**
 * Static unicode status indicator — replaces colored dots.
 *
 * For active/running states, animates. For static states (completed,
 * failed, idle), shows a fixed unicode character. Provides richer
 * visual feedback than a colored circle while staying monochrome
 * and consistent with the brand.
 */

type StatusVariant = "active" | "idle" | "draft" | "attention" | "error";

// Only `attention` animates — the sparkle genuinely wants to pull
// the user's eye when something needs review. Every other state is
// a static glyph so that long lists (agent sidebar, automations
// list) don't look like they're constantly loading. "Active"
// previously used a braille pulse that was routinely misread as a
// loading spinner — a solid static dot communicates "healthy and
// enabled" more clearly.
const STATUS_DISPLAY: Record<
  StatusVariant,
  { char: string; animated?: keyof typeof spinners; color: string; label: string }
> = {
  active: { char: "●", color: "text-success", label: "Active" },
  idle: { char: "○", color: "text-muted-foreground/40", label: "Idle" },
  draft: { char: "◌", color: "text-muted-foreground/25", label: "Draft" },
  attention: { char: "◉", animated: "sparkle", color: "text-warning", label: "Needs attention" },
  error: { char: "✕", color: "text-destructive", label: "Error" },
};

export function StatusIndicator({
  status,
  narrative,
  className,
}: {
  status: StatusVariant;
  /** Override the default tooltip label */
  narrative?: string;
  className?: string;
}) {
  const config = STATUS_DISPLAY[status];
  const { frames, interval } = config.animated
    ? spinners[config.animated]
    : { frames: [config.char], interval: 0 };
  const frame = useAnimatedFrame(frames.length, interval, !!config.animated);

  const display = config.animated ? frames[frame] : config.char;
  const label = narrative ?? config.label;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center font-mono text-[10px] leading-none",
        config.color,
        className,
      )}
      title={label}
      role="status"
      aria-label={label}
    >
      {display}
    </span>
  );
}

/**
 * Run execution status indicator — replaces ui/status-dot.tsx.
 *
 * Maps run lifecycle states to visual indicators:
 * - completed → static green check-like character
 * - running → animated orbit spinner
 * - failed → static red cross
 */
type RunStatus = "completed" | "running" | "failed";

const RUN_STATUS_DISPLAY: Record<
  RunStatus,
  { char: string; animated?: keyof typeof spinners; color: string }
> = {
  completed: { char: "●", color: "text-success" },
  running: { char: "◌", animated: "orbit", color: "text-warning" },
  failed: { char: "✕", color: "text-destructive" },
};

export function RunStatusIndicator({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const config = RUN_STATUS_DISPLAY[status as RunStatus] ?? {
    char: "○",
    color: "text-muted-foreground",
  };
  const { frames, interval } = config.animated
    ? spinners[config.animated]
    : { frames: [config.char], interval: 0 };
  const frame = useAnimatedFrame(frames.length, interval, !!config.animated);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center font-mono text-[10px] leading-none",
        config.color,
        className,
      )}
      aria-hidden="true"
    >
      {config.animated ? frames[frame] : config.char}
    </span>
  );
}
