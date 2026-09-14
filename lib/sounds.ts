import { defineSound, type SoundDefinition } from "@web-kits/audio";

/**
 * Declarative UI sound definitions, passed into `useSound` from
 * `@web-kits/audio/react`. Kept at module scope so hook callers don't
 * re-create objects per render.
 *
 * Opt-in only (see `users.soundEnabled`) — the `SoundProvider` in
 * `components/providers.tsx` reads the preference and mutes everything
 * when disabled. Hooks also respect `prefers-reduced-motion`, so no
 * per-callsite guards needed.
 *
 * Design principles:
 *   • Sub-300ms total duration so nothing lingers.
 *   • Short attack (~5ms) to avoid click artifacts on oscillator start.
 *   • Low gain (< 0.1) — UI sounds should sit under voice/music volume.
 *   • Only on "rare or occasional" events (see emil-design-eng skill):
 *     message-arrived and artifact-announced, not keystrokes or hovers.
 */

/** Soft sine pop when a new assistant message finishes streaming. */
export const MESSAGE_ARRIVED: SoundDefinition = {
  source: { type: "sine", frequency: 660 },
  envelope: { attack: 0.005, decay: 0.14 },
  gain: 0.07,
};

/** Two-step triangle rise when the agent announces a new artifact. */
export const ARTIFACT_ANNOUNCED: SoundDefinition = {
  source: {
    type: "triangle",
    frequency: { start: 523.25, end: 783.99 },
  },
  envelope: { attack: 0.008, decay: 0.22 },
  gain: 0.07,
};

/**
 * Plays the message-arrived chime once, outside the React provider —
 * used by the sound-toggle row so the user can audition the effect
 * before the Convex preference has round-tripped through `useQuery`.
 */
export const previewMessageArrived = defineSound(MESSAGE_ARRIVED);
