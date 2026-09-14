"use client";

import type { Route } from "next";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  HouseSimple,
  ClockCounterClockwise,
  PlugsConnected,
  FlowArrow,
  FolderSimple,
  SlidersHorizontal,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DOCK_ITEMS: {
  icon: PhosphorIcon;
  label: string;
  segment: string;
}[] = [
  { icon: HouseSimple, label: "Home", segment: "home" },
  { icon: ClockCounterClockwise, label: "Activity", segment: "activity" },
  { icon: PlugsConnected, label: "Connect", segment: "connect" },
  { icon: FlowArrow, label: "Automations", segment: "automations" },
  { icon: FolderSimple, label: "Files", segment: "files" },
  { icon: SlidersHorizontal, label: "Settings", segment: "settings" },
];

// Apple-style spring with enough duration to actually be perceived. At
// 0.35 the morph is done before your eye registers it; 0.45 lets the
// settle read. Bounce is intentionally low — this is nav, not confetti.
const MORPH_SPRING = { type: "spring", duration: 0.45, bounce: 0.2 } as const;

// Fade is slower than the morph finish so labels don't pop after the
// shape settles. Slightly longer than the morph's perceived finish.
const FADE = { duration: 0.25, ease: [0.22, 1, 0.36, 1] } as const;

// Press feedback: brief and crisp. Springs on taps feel indecisive; a
// tween commits to the gesture and releases cleanly.
const PRESS = { duration: 0.14, ease: [0.22, 1, 0.36, 1] } as const;

// Hover lift: subtler than press. The point is "I heard you're near me",
// not "I'm being clicked." Emil: whisper of reactivity, not magnification.
const HOVER = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

export function Dock() {
  const { agentId } = useParams<{ agentId: string }>();
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const base = `/${agentId}`;

  return (
    <nav
      aria-label="Workspace"
      // Translucent material + glass edge highlight. The inset white
      // shadow at the top mimics how glass catches light from above,
      // giving the dock depth without a painted-on look. Dark mode
      // uses a subtler highlight — a pure-white 60% edge in dark
      // would read as garish.
      className={cn(
        "fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-0.5",
        "rounded-2xl border border-border/40 px-1.5 py-1.5",
        "bg-background/80 backdrop-blur-xl backdrop-saturate-150",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_-4px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.6)]",
        "dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_-4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
      )}
    >
      {DOCK_ITEMS.map(({ icon: Icon, label, segment }) => {
        const href = `${base}/${segment}`;
        const isActive = pathname.startsWith(`${base}/${segment}`);

        const linkBody = (
          <motion.div
            whileHover={
              shouldReduceMotion || isActive ? undefined : { scale: 1.04 }
            }
            whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
            transition={isActive ? PRESS : HOVER}
            className={cn(
              "rounded-xl transition-colors",
              isActive
                ? "bg-foreground/[0.06]"
                : "hover:bg-foreground/[0.04]",
            )}
          >
            <Link
              href={href as Route}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center rounded-xl px-2.5 py-2 transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                size={18}
                // Phosphor uses discrete weights instead of a stroke
                // number. "regular" ≈ Lucide's 1.5, "bold" ≈ 2.
                weight={isActive ? "bold" : "regular"}
                className="shrink-0"
              />
              <AnimatePresence initial={false}>
                {isActive && (
                  <motion.span
                    key="label"
                    initial={
                      shouldReduceMotion
                        ? { opacity: 0, width: "auto", marginLeft: 6 }
                        : {
                            opacity: 0,
                            width: 0,
                            marginLeft: 0,
                            filter: "blur(4px)",
                          }
                    }
                    animate={{
                      opacity: 1,
                      width: "auto",
                      marginLeft: 6,
                      filter: "blur(0px)",
                    }}
                    exit={
                      shouldReduceMotion
                        ? { opacity: 0 }
                        : {
                            opacity: 0,
                            width: 0,
                            marginLeft: 0,
                            filter: "blur(4px)",
                          }
                    }
                    transition={
                      shouldReduceMotion
                        ? { duration: 0.15 }
                        : {
                            width: MORPH_SPRING,
                            marginLeft: MORPH_SPRING,
                            opacity: FADE,
                            filter: FADE,
                          }
                    }
                    className="overflow-hidden whitespace-nowrap text-sm font-medium"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          </motion.div>
        );

        // Keep the wrapper tree stable across active-state flips —
        // otherwise React unmounts the Tooltip and remounts a plain div
        // (or vice versa) on every route change, wiping out Motion's
        // state and skipping every enter/exit animation. Symptom: the
        // dock feels like it has no animation at all. Only toggle the
        // TooltipContent, which is a leaf and safe to unmount.
        return (
          <Tooltip key={label}>
            <TooltipTrigger render={linkBody} />
            {!isActive && (
              <TooltipContent side="top" sideOffset={8} className="text-xs">
                {label}
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}
    </nav>
  );
}
