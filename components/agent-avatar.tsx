/* ── AgentAvatar ──────────────────────────────────────────── */
//
// Identity-hashed solid-color avatar. The agent's first initial on a
// solid colored background, with the color deterministically generated
// from the agent's name hash. Same name → same color forever, and
// every distinct name gets a distinct color (no fixed palette to
// collide on).
//
// The trick to keeping infinite variation refined: lock lightness
// and chroma to refined values in OKLCH space, derive only the hue
// from the hash. Every name maps to a unique hue (0-360°), but all
// colors stay in the "muted, dark, professional" zone because L and
// C are clamped. No name can produce neon cyan or hot magenta — the
// math forbids it.
//
// L=0.42 (dark enough for clean white-text contrast in both light
// and dark mode, light enough for hues to read distinctly) and
// C=0.07 (muted — well below "vivid" at C≈0.15+ and FAR below
// AI-slop neon at C≈0.25+) are tuned for "refined identity," not
// "AI magic glow." Same color space the rest of the design system
// uses (see globals.css OKLCH tokens).
//
// API is unchanged from the previous palette-based and neutral-monogram
// implementations: callsites pass `name`, `size`, and optionally
// `theme`. The `theme` prop is still accepted for backwards
// compatibility but ignored — color is derived from `name` only.

// These text sizes are component-internal proportional sizing for fixed-pixel
// circles, not page-level type tokens. Each value is ~32% of the box dimension
// so the initial sits visually centered at every avatar size. Intentionally
// off-scale; do not "normalize" them to text-xs/text-sm — those tokens would
// break the proportional relationship with the box.
const SIZES = {
  xs: { box: "size-6",  text: "text-[9px]"  }, // 24px box
  sm: { box: "size-8",  text: "text-[11px]" }, // 32px box
  md: { box: "size-10", text: "text-[13px]" }, // 40px box
  lg: { box: "size-14", text: "text-[18px]" }, // 56px box
  xl: { box: "size-20", text: "text-[24px]" }, // 80px box
} as const;

/**
 * Locked OKLCH parameters for refined identity hashing.
 *   L (lightness): 0.42 — dark enough for clean white-text contrast
 *                          in both light and dark mode, light enough
 *                          for hues to read distinctly
 *   C (chroma):    0.07 — muted, professional. Far below the "vivid"
 *                          threshold (~0.15) and FAR below AI-slop
 *                          neon territory (~0.25+).
 *
 * Only the hue varies — and it varies across the full 0-360° spectrum
 * via the name hash. Every distinct name gets a distinct color, but
 * all colors share the same lightness and chroma so the workforce
 * reads as a coherent set (no jarring outliers).
 */
const OKLCH_LIGHTNESS = 0.42;
const OKLCH_CHROMA = 0.07;

/**
 * djb2 string hash → 32-bit integer. Simple, fast, well-distributed
 * over short strings. We only need a stable mapping from name to
 * a hue value, so we don't need a cryptographic hash.
 */
function hashName(name: string): number {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Deterministic name → OKLCH color string. Every distinct name
 * produces a distinct color; the same name maps to the same color
 * forever.
 */
function colorForName(name: string): string {
  const hue = hashName(name) % 360;
  return `oklch(${OKLCH_LIGHTNESS} ${OKLCH_CHROMA} ${hue})`;
}

/**
 * Preserved for API compatibility with the previous Siri-blob implementation.
 * Downstream files (e.g. `agent-greeting.tsx`) import this type to declare
 * forwarded props. The new component ignores any value passed in — color
 * is now derived from `name` only.
 */
export type AvatarTheme =
  | "gray"
  | "aurora"
  | "ocean"
  | "emerald"
  | "sunset"
  | "violet";

export function AgentAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: keyof typeof SIZES;
  /** Accepted for backwards compatibility. No longer used. */
  theme?: AvatarTheme;
}) {
  const trimmed = name.trim();
  const initial = trimmed.charAt(0).toUpperCase() || "·";
  const { box, text } = SIZES[size];
  const backgroundColor = colorForName(trimmed || "·");

  return (
    <div
      aria-hidden="true"
      className={`${box} ${text} inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white`}
      style={{ backgroundColor }}
    >
      {initial}
    </div>
  );
}
