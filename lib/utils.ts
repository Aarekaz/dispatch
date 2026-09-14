import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Convert a cron expression to a human-readable description.
 * Covers common patterns. Falls back to the raw expression for exotic ones.
 */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  // Every N minutes
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = parseInt(min.slice(2), 10);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }

  // Every N hours
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    const n = parseInt(hour.slice(2), 10);
    return n === 1 ? "Every hour" : `Every ${n} hours`;
  }

  // Top of every hour
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every hour";
  }

  // Daily at a specific time
  if (dom === "*" && mon === "*" && dow === "*" && !hour.includes("*") && !hour.includes("/")) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const time = formatTime(h, m);
    return `Daily at ${time}`;
  }

  // Weekdays at a specific time
  if (dom === "*" && mon === "*" && dow === "1-5" && !hour.includes("*")) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    return `Weekdays at ${formatTime(h, m)}`;
  }

  // Weekly on a specific day
  if (dom === "*" && mon === "*" && !dow.includes("*") && !dow.includes("-") && !hour.includes("*")) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayNum = parseInt(dow, 10);
    const dayName = days[dayNum] ?? `day ${dow}`;
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    return `${dayName}s at ${formatTime(h, m)}`;
  }

  return cron;
}

function formatTime(h: number, m: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12} ${period}` : `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

/**
 * Format a timestamp as relative time ("just now", "5m ago", "2h ago", "Apr 9").
 * Used across the app for activity feeds, session lists, and automation runs.
 */
export function relativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Forward sibling of `relativeTime` — describes a future timestamp
 * ("in 4h", "in 2d", "on Apr 25"). Used by the automations list to
 * show when a scheduled automation will next fire.
 */
export function relativeTimeUntil(ms: number): string {
  const seconds = Math.floor((ms - Date.now()) / 1000);
  if (seconds < 60) return "in <1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `in ${days}d`;
  return `on ${new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}
