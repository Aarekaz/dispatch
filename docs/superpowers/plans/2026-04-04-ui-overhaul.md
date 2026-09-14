# UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Dispatch v1's design system into v2 with Manus-inspired interaction patterns — pure neutral OKLCH palette, pill buttons, shadow-defined cards, contextual hover actions, resizable workspace panel, and smooth transitions across all views.

**Architecture:** Design tokens live in layered CSS files (primitives → semantic → component). shadcn components use CVA variants mapped to tokens. Views consume components without hardcoding visual decisions. Token swap = full theme swap.

**Tech Stack:** Tailwind CSS v4 (via `@theme inline`), CVA (class-variance-authority), Next.js App Router, shadcn/ui, assistant-ui, React refs for resize logic.

**Spec:** `docs/superpowers/specs/2026-04-04-ui-overhaul-design.md`

---

### Task 1: Design Token Migration — Primitives & Semantic Layer

Migrate `globals.css` from warm-tinted OKLCH to v1's pure neutral OKLCH palette. Restructure tokens into clear primitive → semantic layers.

**Files:**
- Modify: `app/globals.css` (full rewrite of token section, lines 4-126)

- [ ] **Step 1: Back up current globals.css and read it fully**

Read the file completely before modifying. Note every CSS variable currently used.

- [ ] **Step 2: Rewrite the `@theme inline` block with v1's pure neutral palette**

Replace the current `@theme inline` block (lines 4-47) with v1's pure neutral OKLCH values:

```css
@import "tailwindcss";

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@theme inline {
  --color-background: oklch(var(--bg));
  --color-foreground: oklch(var(--fg));
  --color-card: oklch(var(--card));
  --color-card-foreground: oklch(var(--card-fg));
  --color-popover: oklch(var(--popover));
  --color-popover-foreground: oklch(var(--popover-fg));
  --color-primary: oklch(var(--primary));
  --color-primary-foreground: oklch(var(--primary-fg));
  --color-secondary: oklch(var(--secondary));
  --color-secondary-foreground: oklch(var(--secondary-fg));
  --color-muted: oklch(var(--muted));
  --color-muted-foreground: oklch(var(--muted-fg));
  --color-accent: oklch(var(--accent));
  --color-accent-foreground: oklch(var(--accent-fg));
  --color-destructive: oklch(var(--destructive));
  --color-destructive-foreground: oklch(var(--destructive-fg));
  --color-success: oklch(var(--success));
  --color-success-foreground: oklch(var(--success-fg));
  --color-warning: oklch(var(--warning));
  --color-warning-foreground: oklch(var(--warning-fg));
  --color-info: oklch(var(--info));
  --color-info-foreground: oklch(var(--info-fg));
  --color-border: oklch(var(--border));
  --color-input: oklch(var(--input));
  --color-ring: oklch(var(--ring));

  --color-success-subtle: oklch(var(--success-subtle));
  --color-warning-subtle: oklch(var(--warning-subtle));
  --color-info-subtle: oklch(var(--info-subtle));
  --color-destructive-subtle: oklch(var(--destructive-subtle));

  --color-sidebar-bg: var(--sidebar-bg);
  --color-sidebar-fg: var(--sidebar-fg);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-fg: var(--sidebar-accent-fg);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-muted: var(--sidebar-muted);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-xl: 24px;
  --radius-full: 9999px;
  --radius: 12px;

  --shadow-card: 0 0 0 0.7px #ebeced,
    0 1px 1px -0.5px rgba(0,0,0,0.09),
    0 2px 2px -1px rgba(0,0,0,0.05);
  --shadow-card-hover: 0 0 0 0.7px #e0e1e3,
    0 2px 4px -1px rgba(0,0,0,0.10),
    0 4px 8px -2px rgba(0,0,0,0.06);
  --shadow-floating: 0 0 0 0.7px rgba(0,0,0,0.06),
    0 4px 12px -2px rgba(0,0,0,0.12),
    0 8px 24px -4px rgba(0,0,0,0.08);
  --shadow-subtle: 0 1px 2px 0 rgba(0,0,0,0.05);
  --shadow-input: 0 1px 2px 0 rgba(0,0,0,0.04);
  --shadow-input-focus: 0 0 0 3px rgba(0,0,0,0.06);
}
```

- [ ] **Step 3: Rewrite `:root` light theme variables**

Replace lines 50-97 with v1's pure neutral OKLCH:

```css
:root {
  /* Primitives — pure neutral (chroma 0, hue 0) */
  --bg: 0.99 0 0;
  --fg: 0.25 0 0;
  --card: 0.99 0 0;
  --card-fg: 0.25 0 0;
  --popover: 0.99 0 0;
  --popover-fg: 0.25 0 0;
  --primary: 0.18 0 0;
  --primary-fg: 0.99 0 0;
  --secondary: 0.955 0 0;
  --secondary-fg: 0.35 0 0;
  --muted: 0.955 0 0;
  --muted-fg: 0.55 0 0;
  --accent: 0.95 0 0;
  --accent-fg: 0.25 0 0;
  --destructive: 0.63 0.257 29;
  --destructive-fg: 0.99 0 0;
  --border: 0.94 0 0;
  --input: 0.94 0 0;
  --ring: 0.55 0 0;

  /* Status */
  --success: 0.60 0.12 152;
  --success-fg: 0.99 0 0;
  --warning: 0.75 0.17 75;
  --warning-fg: 0.25 0 0;
  --info: 0.63 0.19 255;
  --info-fg: 0.99 0 0;

  /* Subtle status backgrounds */
  --success-subtle: 0.95 0.03 152;
  --warning-subtle: 0.95 0.04 75;
  --info-subtle: 0.95 0.03 255;
  --destructive-subtle: 0.95 0.04 29;

  /* Sidebar */
  --sidebar-bg: #f8f8f8;
  --sidebar-fg: #3d3d3d;
  --sidebar-accent: #eeeeee;
  --sidebar-accent-fg: #1a1a1a;
  --sidebar-border: #e8e8e8;
  --sidebar-muted: #888888;
}
```

- [ ] **Step 4: Rewrite `.dark` theme variables**

Replace lines 99-126 with v1's dark mode:

```css
.dark {
  --bg: 0.26 0 0;
  --fg: 0.98 0 0;
  --card: 0.29 0 0;
  --card-fg: 0.98 0 0;
  --popover: 0.29 0 0;
  --popover-fg: 0.98 0 0;
  --primary: 0.98 0 0;
  --primary-fg: 0.18 0 0;
  --secondary: 0.32 0 0;
  --secondary-fg: 0.90 0 0;
  --muted: 0.32 0 0;
  --muted-fg: 0.60 0 0;
  --accent: 0.34 0 0;
  --accent-fg: 0.98 0 0;
  --destructive: 0.63 0.257 29;
  --destructive-fg: 0.99 0 0;
  --border: 0.36 0 0;
  --input: 0.36 0 0;
  --ring: 0.60 0 0;

  --success: 0.60 0.12 152;
  --success-fg: 0.15 0 0;
  --warning: 0.75 0.17 75;
  --warning-fg: 0.15 0 0;
  --info: 0.63 0.19 255;
  --info-fg: 0.15 0 0;

  --success-subtle: 0.30 0.04 152;
  --warning-subtle: 0.30 0.04 75;
  --info-subtle: 0.30 0.04 255;
  --destructive-subtle: 0.30 0.04 29;

  --sidebar-bg: #1e1e1e;
  --sidebar-fg: #d4d4d4;
  --sidebar-accent: #2a2a2a;
  --sidebar-accent-fg: #e5e5e5;
  --sidebar-border: #333333;
  --sidebar-muted: #777777;

  --shadow-card: 0 0 0 0.7px rgba(255,255,255,0.06),
    0 1px 1px -0.5px rgba(0,0,0,0.3),
    0 2px 2px -1px rgba(0,0,0,0.2);
  --shadow-card-hover: 0 0 0 0.7px rgba(255,255,255,0.08),
    0 2px 4px -1px rgba(0,0,0,0.35),
    0 4px 8px -2px rgba(0,0,0,0.25);
}
```

- [ ] **Step 5: Add global interactive utilities**

Add to the `@layer utilities` section:

```css
@layer utilities {
  .focus-ring {
    @apply outline-none ring-2 ring-ring/20 ring-offset-2 ring-offset-background;
  }
  .press-scale {
    @apply transition-transform duration-100 active:scale-[0.96];
  }
  .hover-lift {
    @apply transition-shadow duration-150 hover:shadow-card-hover;
  }
  .contextual-action {
    @apply opacity-0 transition-opacity duration-150 group-hover:opacity-100;
  }
}
```

- [ ] **Step 6: Update base styles for 12px radius and transition defaults**

Ensure the base layer uses the new radius and adds global transition defaults:

```css
@layer base {
  * {
    @apply border-border;
  }
  html {
    scroll-behavior: smooth;
  }
  body {
    @apply bg-background text-foreground antialiased;
  }
  h1, h2, h3, h4, h5, h6 {
    letter-spacing: -0.01em;
  }
  button, a, [role="button"] {
    @apply press-scale;
  }
}
```

- [ ] **Step 7: Verify dev server renders correctly**

Run: `npm run dev`

Open the app and verify:
- Background is pure neutral (no warm tint)
- Cards show multi-layer shadows
- Buttons have scale-on-click feedback
- Dark mode toggle works with correct dark values
- No visual regressions in layout

- [ ] **Step 8: Commit**

```bash
git add app/globals.css
git commit -m "design: migrate to v1 pure neutral OKLCH tokens with layered shadow system"
```

---

### Task 2: Button Component — Pill Shape, Scale, Shadows

Upgrade the button to v1's signature pill shape with tactile feedback.

**Files:**
- Modify: `components/ui/button.tsx`

- [ ] **Step 1: Read the current button component**

Read `components/ui/button.tsx` fully. Note all existing variants and sizes.

- [ ] **Step 2: Update CVA variants for pill shape and active scale**

Replace the `buttonVariants` definition. Key changes:
- Base classes: `rounded-full` instead of `rounded-md`, add `press-scale` utility
- Default variant: add subtle shadow (`shadow-subtle`)
- Sizes: update to spec heights (xs:28px, sm:32px, default:36px, lg:40px, xl:44px)
- Icon sizes: circular with matching heights

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-subtle hover:opacity-90",
        destructive: "bg-destructive text-destructive-foreground shadow-subtle hover:opacity-90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-5 text-sm",
        xs: "h-7 px-3 text-xs",
        sm: "h-8 px-4 text-sm",
        lg: "h-10 px-6 text-sm",
        xl: "h-11 px-8 text-base",
        icon: "size-9",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
```

- [ ] **Step 3: Verify buttons render correctly**

Run: `npm run dev`

Check across the app: sidebar "New chat" button, "Deploy agent", "Save changes" in settings. All should be pill-shaped with scale-on-click.

- [ ] **Step 4: Commit**

```bash
git add components/ui/button.tsx
git commit -m "design: pill-shaped buttons with scale-on-click and shadow"
```

---

### Task 3: Card Component — Shadow-Defined, No Borders

Upgrade cards to use shadows for edge definition instead of visible borders. Add variants.

**Files:**
- Modify: `components/ui/card.tsx`

- [ ] **Step 1: Read the current card component**

Read `components/ui/card.tsx`. Note existing structure and any custom classes like `shadow-fig-card` or `text-ds-text`.

- [ ] **Step 2: Update Card with shadow-based styling and CVA variants**

Replace the Card component with CVA-driven variants:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva(
  "rounded-xl bg-card text-card-foreground transition-shadow duration-150",
  {
    variants: {
      variant: {
        default: "shadow-card hover:shadow-card-hover",
        ghost: "bg-transparent shadow-none",
        framed: "shadow-card-hover p-1",
        selected: "shadow-card ring-2 ring-primary/20",
      },
      size: {
        sm: "",
        default: "",
        lg: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Card({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      className={cn(cardVariants({ variant, size }), className)}
      {...props}
    />
  );
}

const cardContentPadding = {
  sm: "px-4 py-3",
  default: "px-5 py-4",
  lg: "px-6 py-5",
};

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-5 pt-5", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-base font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 pb-5", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-5 pb-5", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants };
```

- [ ] **Step 3: Remove `border` from Card usages across views**

Search all views for `<Card` usage. Remove any explicit `border` classes that conflict with shadow-only styling. The Card component's default variant now uses shadow, not border.

Run: `grep -rn "border" components/views/ | grep -i card` to find conflicts.

- [ ] **Step 4: Verify cards render with shadows, no borders**

Run: `npm run dev`

Check: home stat cards, settings cards, agent list wrapper, inbox/events cards. All should show subtle shadow edges, lift on hover. No visible 1px borders.

- [ ] **Step 5: Commit**

```bash
git add components/ui/card.tsx components/views/
git commit -m "design: shadow-defined cards with variant system, remove visible borders"
```

---

### Task 4: Badge Component — Appearances & Status Variants

Upgrade badges with light/outline/ghost appearances and proper status colors.

**Files:**
- Modify: `components/ui/badge.tsx`

- [ ] **Step 1: Read the current badge component**

Read `components/ui/badge.tsx`. Note existing `tone` variants.

- [ ] **Step 2: Replace with full variant system**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        success: "bg-success text-success-foreground",
        warning: "bg-warning text-warning-foreground",
        info: "bg-info text-info-foreground",
        destructive: "bg-destructive text-destructive-foreground",
      },
      appearance: {
        solid: "",
        light: "",
        outline: "bg-transparent border",
        ghost: "bg-transparent",
      },
      shape: {
        default: "rounded-md",
        pill: "rounded-full",
      },
      size: {
        xs: "px-1.5 py-0.5 text-[10px]",
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-0.5 text-[12px]",
        lg: "px-3 py-1 text-[13px]",
      },
    },
    compoundVariants: [
      // Light appearances use subtle bg + tinted text
      { variant: "success", appearance: "light", className: "bg-success-subtle text-success" },
      { variant: "warning", appearance: "light", className: "bg-warning-subtle text-warning" },
      { variant: "info", appearance: "light", className: "bg-info-subtle text-info" },
      { variant: "destructive", appearance: "light", className: "bg-destructive-subtle text-destructive" },
      { variant: "default", appearance: "light", className: "bg-secondary text-secondary-foreground" },
      // Outline appearances
      { variant: "success", appearance: "outline", className: "border-success/30 text-success" },
      { variant: "warning", appearance: "outline", className: "border-warning/30 text-warning" },
      { variant: "info", appearance: "outline", className: "border-info/30 text-info" },
      { variant: "destructive", appearance: "outline", className: "border-destructive/30 text-destructive" },
    ],
    defaultVariants: {
      variant: "default",
      appearance: "solid",
      shape: "pill",
      size: "sm",
    },
  },
);

function Badge({
  className,
  variant,
  appearance,
  shape,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, appearance, shape, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
```

- [ ] **Step 3: Update badge usages across the codebase**

Search for existing `<Badge` usages. The old `tone` prop is now `variant` + `appearance`. Update:
- `tone="neutral"` → `variant="secondary" appearance="light"`
- `tone="success"` → `variant="success" appearance="light"`
- `tone="warning"` → `variant="warning" appearance="light"`
- Any bare `<Badge>` without tone keeps working (default variant).

Run: `grep -rn "<Badge" components/` to find all usages.

- [ ] **Step 4: Verify badges render correctly**

Run: `npm run dev`

Check: agent list channel badges, inbox type badges, settings "Owner" badge, agent detail status badge.

- [ ] **Step 5: Commit**

```bash
git add components/ui/badge.tsx components/views/ components/app-sidebar.tsx
git commit -m "design: badge variant system with appearances (solid/light/outline/ghost)"
```

---

### Task 5: Input Component — Ghost Variant & Sizes

Add ghost and filled variants to inputs.

**Files:**
- Modify: `components/ui/input.tsx`

- [ ] **Step 1: Read current input component**

- [ ] **Step 2: Add CVA variants**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const inputVariants = cva(
  "flex w-full min-w-0 text-base outline-none transition-all duration-150 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 md:text-sm",
  {
    variants: {
      variant: {
        default: "rounded-lg border border-input bg-transparent shadow-input focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        ghost: "rounded-lg border border-transparent bg-transparent focus-visible:bg-card focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20",
        filled: "rounded-lg border border-transparent bg-secondary focus-visible:bg-card focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20",
      },
      inputSize: {
        sm: "h-8 px-3 py-1 text-sm",
        default: "h-9 px-3 py-1",
        lg: "h-12 px-4 py-2 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "default",
    },
  },
);

function Input({
  className,
  type,
  variant,
  inputSize,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, inputSize }), className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
```

- [ ] **Step 3: Verify inputs render correctly**

Run: `npm run dev`

Check settings page form inputs. They should look the same (default variant unchanged). Test ghost variant by adding `variant="ghost"` to one input temporarily.

- [ ] **Step 4: Commit**

```bash
git add components/ui/input.tsx
git commit -m "design: input variants (default/ghost/filled) with size options"
```

---

### Task 6: StatusDot Component — Pulse Animation & Narrative Tooltip

Upgrade StatusDot with pulse for active agents and tooltip support.

**Files:**
- Modify: `components/status-dot.tsx`

- [ ] **Step 1: Read current status-dot component**

- [ ] **Step 2: Rewrite with pulse animation and tooltip**

```tsx
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type AgentStatus = "active" | "idle" | "draft" | "attention" | "error";

const statusConfig: Record<AgentStatus, { color: string; pulse: boolean; defaultLabel: string }> = {
  active: { color: "bg-emerald-500", pulse: true, defaultLabel: "Running" },
  idle: { color: "bg-muted-foreground/40", pulse: false, defaultLabel: "Idle" },
  draft: { color: "bg-muted-foreground/25", pulse: false, defaultLabel: "Draft" },
  attention: { color: "bg-amber-500", pulse: true, defaultLabel: "Needs attention" },
  error: { color: "bg-destructive", pulse: true, defaultLabel: "Error" },
};

export function StatusDot({
  status,
  narrative,
  className,
}: {
  status: AgentStatus;
  narrative?: string;
  className?: string;
}) {
  const config = statusConfig[status];
  const label = narrative || config.defaultLabel;

  const dot = (
    <span className={cn("relative inline-block size-2 shrink-0 rounded-full", config.color, className)}>
      {config.pulse && (
        <span
          className={cn(
            "absolute inset-0 rounded-full animate-ping",
            config.color,
            "opacity-40",
          )}
        />
      )}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">{dot}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 3: Update StatusDot usages to pass `narrative` where available**

Search for `<StatusDot` usages. For now, all existing usages keep working without `narrative` (falls back to default label). The `narrative` prop will be wired to real data in later tasks.

- [ ] **Step 4: Verify status dots render with tooltips**

Run: `npm run dev`

Check: sidebar agent items, agents index, home page "Your agents" card. Hover a dot — tooltip should appear. Active dots should pulse.

- [ ] **Step 5: Commit**

```bash
git add components/status-dot.tsx
git commit -m "design: StatusDot with pulse animation and narrative tooltip"
```

---

### Task 7: Tabs Component — Underline Style

Switch tabs to underline-style triggers for a cleaner look.

**Files:**
- Modify: `components/ui/tabs.tsx`

- [ ] **Step 1: Read current tabs component**

Note the existing `variant` support (default vs line). The current `line` variant already uses an underline approach. We need to make `line` the default look and refine the active indicator.

- [ ] **Step 2: Update TabsList and TabsTrigger default styling**

Update the TabsList default variant to use transparent background with a subtle bottom border. Update TabsTrigger active state to use a bottom border indicator instead of a filled background.

Key changes to `tabsListVariants`:
- default variant: `bg-transparent border-b border-border` instead of `bg-muted rounded-lg`
- Trigger active state: `border-b-2 border-foreground` instead of `bg-background`

Read the current file, then update the specific CVA variant lines. Keep the `line` variant as an alias if needed.

- [ ] **Step 3: Verify tabs render with underline style**

Run: `npm run dev`

Check: settings page tabs (General, Team, Billing, Integrations, API Keys). Active tab should show a bottom border indicator, not a filled background.

- [ ] **Step 4: Commit**

```bash
git add components/ui/tabs.tsx
git commit -m "design: underline-style tab triggers"
```

---

### Task 8: Chat Page — Resizable Workspace Panel

Add a draggable divider to the chat page's workspace panel. Panel is toggleable (not always-on), resizable when visible, width persisted to localStorage.

**Files:**
- Create: `components/resize-handle.tsx`
- Modify: `components/agent-chat.tsx` (lines 168-188, layout structure)
- Modify: `components/artifact-panel.tsx` (remove self-contained header/close)
- Modify: `components/views/agent-detail-view.tsx` (pass resize props)

- [ ] **Step 1: Create ResizeHandle component**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "dispatch:workspace-width";
const MIN_CHAT = 300;
const MIN_WORKSPACE = 280;
const DEFAULT_RATIO = 0.4; // workspace takes 40%

export function useResizablePanel(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setWorkspaceWidth(Number(saved));
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWorkspaceWidth = rect.right - e.clientX;
      const chatWidth = rect.width - newWorkspaceWidth;

      if (chatWidth < MIN_CHAT) return;

      if (newWorkspaceWidth < MIN_WORKSPACE) {
        setWorkspaceWidth(0);
        return;
      }

      setWorkspaceWidth(newWorkspaceWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      // Persist
      const el = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const w = workspaceWidth ?? rect.width * DEFAULT_RATIO;
        if (w > 0) localStorage.setItem(STORAGE_KEY, String(w));
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [containerRef, workspaceWidth]);

  const getInitialWidth = useCallback((containerWidth: number) => {
    return workspaceWidth ?? containerWidth * DEFAULT_RATIO;
  }, [workspaceWidth]);

  return { workspaceWidth, setWorkspaceWidth, onMouseDown, getInitialWidth };
}

export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "group flex w-1.5 cursor-col-resize items-center justify-center",
        "hover:bg-accent transition-colors duration-150",
      )}
    >
      <div className="h-8 w-0.5 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/50" />
    </div>
  );
}
```

- [ ] **Step 2: Update AgentChat layout to use resizable panel**

In `components/agent-chat.tsx`, modify the return JSX (around line 168) to wrap the chat and artifact panels in a flex container with the resize handle between them. Use `useResizablePanel` hook with a container ref.

The workspace panel should only render when `showArtifacts` is true. When visible, the ResizeHandle appears between chat and workspace.

```tsx
const containerRef = useRef<HTMLDivElement>(null);
const { workspaceWidth, onMouseDown, getInitialWidth } = useResizablePanel(containerRef);

return (
  <div ref={containerRef} className="flex h-full overflow-hidden">
    <div className="min-h-0 min-w-0 flex-1">
      <AgentContext.Provider value={agentContextValue}>
        <ChatThread
          key={threadKey}
          agentId={agentId}
          sessionId={activeSessionId}
          initialMessages={initialMessages}
          onPortDetected={onPortDetected}
        />
      </AgentContext.Provider>
    </div>

    {showArtifacts && (
      <>
        <ResizeHandle onMouseDown={onMouseDown} />
        <div
          style={{ width: workspaceWidth ?? getInitialWidth(containerRef.current?.offsetWidth ?? 1000) }}
          className="min-h-0 shrink-0"
        >
          <ArtifactPanel agentId={agentId} onClose={onCloseArtifacts ?? (() => {})} autoPort={detectedPort} />
        </div>
      </>
    )}
  </div>
);
```

- [ ] **Step 3: Verify resizable panel works**

Run: `npm run dev`

Navigate to an agent chat. Toggle workspace panel on. Drag the divider — both panels should resize. Collapse workspace by dragging past minimum. Refresh page — width should persist.

- [ ] **Step 4: Commit**

```bash
git add components/resize-handle.tsx components/agent-chat.tsx
git commit -m "feat: resizable workspace panel with localStorage persistence"
```

---

### Task 9: Chat Page — Message Bubble Styling

Port v1's asymmetric user bubbles and clean assistant messages.

**Files:**
- Modify: `components/assistant-ui/thread.tsx` (lines 300-319 UserMessage, lines 220-249 AssistantMessage)

- [ ] **Step 1: Read the current thread.tsx message components**

Read `components/assistant-ui/thread.tsx` fully. Note the exact Primitive components used and their styling.

- [ ] **Step 2: Update UserMessage styling**

Find the UserMessage component (around line 300). Update the content wrapper's className:
- Change `rounded-2xl` to `rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-sm` (asymmetric — sharp bottom-right, v1 signature)
- Keep `bg-muted px-4 py-2.5`
- Add `max-w-[85%]`

- [ ] **Step 3: Update AssistantMessage styling**

Find the AssistantMessage component (around line 220). Key changes:
- Remove any background styling on the message wrapper (text should flow freely, no bubble)
- Add `leading-relaxed` to text content for comfortable reading
- The assistant-ui Primitives handle avatar/content layout — only adjust className props

- [ ] **Step 4: Add completion footer to assistant messages**

After the message content, add a subtle completion footer that shows when the message has tool calls:

```tsx
{/* Completion footer — only for substantial responses */}
<div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
  <span className="text-emerald-500">&#10003;</span>
  <span>Done</span>
</div>
```

This should be added conditionally when the message contains tool-call parts.

- [ ] **Step 5: Update tool call card styling**

Find the tool-call rendering in `thread.tsx` (within AssistantMessage part rendering). Update the tool-call card styling to match the spec:
- Wrapper: `rounded-xl border border-border overflow-hidden`
- Header: `bg-muted/70 px-3 h-9 flex items-center gap-2 text-[13px]`
- Status: Running → `text-info` with spinner, Done → `text-success` with check, Error → `text-destructive` with X
- Body (when expanded): `bg-secondary/50 p-3 max-h-64 overflow-y-auto font-mono text-[12px]`
- Collapsed by default — expand on click via local state

If the current tool-call rendering uses `tool-fallback.tsx` or `file-card.tsx`, update those files as well.

- [ ] **Step 6: Verify message styling**

Run: `npm run dev`

Send a message in chat. User bubble should have the asymmetric rounded corners (sharp bottom-right). Assistant response should flow freely without a bubble background. Tool calls should render as compact cards.

- [ ] **Step 7: Commit**

```bash
git add components/assistant-ui/thread.tsx
git commit -m "design: v1-style message bubbles — asymmetric user corners, clean assistant text"
```

---

### Task 10: Chat Page — Header & Composer

Minimal header, ghost-style composer.

**Files:**
- Modify: `components/views/agent-detail-view.tsx` (lines 56-114, header section)
- Modify: `components/assistant-ui/thread.tsx` (composer section, around lines 151-207)

- [ ] **Step 1: Simplify the agent detail header**

In `agent-detail-view.tsx`, reduce header height from `h-14` to `h-12`. Simplify the header content:
- Left: agent emoji + name (keep existing)
- Right: workspace toggle (monitor icon), settings (gear), controls (sliders) — keep existing icons but make them `size-7` with `text-muted-foreground hover:text-foreground` transition
- Remove the visible bottom border — use `shadow-subtle` or `border-b border-border/50` (very subtle)

- [ ] **Step 2: Update composer styling**

In `thread.tsx`, find the Composer section. Update:
- Container: `rounded-xl border border-border/50 bg-transparent transition-colors focus-within:bg-card focus-within:border-border` (ghost-like behavior)
- Send button: already circular, add `bg-primary text-primary-foreground` when content present, `bg-muted` when empty
- Keep auto-grow behavior

- [ ] **Step 3: Verify header and composer**

Run: `npm run dev`

Check: header should be thinner and cleaner. Composer should be transparent until focused, then gain a subtle background and border.

- [ ] **Step 4: Commit**

```bash
git add components/views/agent-detail-view.tsx components/assistant-ui/thread.tsx
git commit -m "design: minimal chat header (h-12) and ghost-style composer"
```

---

### Task 11: Sidebar — Contextual Actions & Status Storytelling

Visual refinements to sidebar: hover-reveal actions, lowercase labels, status narrative.

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Read sidebar component fully**

Note section labels, agent tree items, hover states.

- [ ] **Step 2: Update section labels**

Find the "DEPLOYED AGENTS" label (around line 123). Change from uppercase to sentence case:
- Change `text-[11px] uppercase` to `text-[11px] font-medium`
- Change text from "DEPLOYED AGENTS" to "Deployed agents"

- [ ] **Step 3: Add contextual actions to agent items**

In the `AgentTreeItem` component (around line 210), wrap the agent button content in a `group` class. Add hover-reveal action icons:

After the agent name and status dot, add:

```tsx
<span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
  <button className="rounded-md p-1 hover:bg-sidebar-accent" title="Settings">
    <Settings className="size-3.5 text-sidebar-muted" />
  </button>
</span>
```

Make sure the parent element has `group` in its className.

- [ ] **Step 4: Add status narrative for active agents**

Below the agent name, conditionally render a one-line status when the agent is active:

```tsx
{agent.status === "active" && (
  <span className="block truncate text-[11px] text-sidebar-muted">
    {agent.currentActivity || "Running..."}
  </span>
)}
```

This uses a `currentActivity` field that may not exist on the agent type yet. For now, fall back to "Running..." — the real narrative will be wired when activity tracking is built.

- [ ] **Step 5: Smooth session list transitions**

Add `transition-all duration-200` to the session subtree container so it animates open/close smoothly.

- [ ] **Step 6: Verify sidebar refinements**

Run: `npm run dev`

Check: "Deployed agents" label is lowercase. Hover an agent item — gear icon should fade in. Active agents should show a status line. Session list should expand/collapse smoothly.

- [ ] **Step 7: Commit**

```bash
git add components/app-sidebar.tsx
git commit -m "design: sidebar contextual actions, status narrative, smooth transitions"
```

---

### Task 12: Home/Dashboard — Stat Cards & Activity Feed

Update stat cards to shadow-only, wire activity feed placeholder.

**Files:**
- Modify: `components/views/home-view.tsx`

- [ ] **Step 1: Read home-view.tsx fully**

Note stat card structure, activity feed section, quick deploy pills.

- [ ] **Step 2: Update stat cards**

Find the stat card section (around line 256). Update:
- Remove any explicit `border` classes on the Card wrapper
- Card should use default variant (shadow-card, no border — from Task 3)
- Number styling: ensure `font-bold` (not just semibold)
- Add `hover-lift` class to each stat card for shadow lift on hover

- [ ] **Step 3: Update activity feed section**

Find the "Recent activity" card (around line 163). Replace the placeholder text with a proper empty state:

```tsx
<div className="flex flex-col items-center justify-center py-8 text-center">
  <p className="text-[13px] text-muted-foreground">
    Your agents are idle. Activity will appear here when they're working.
  </p>
</div>
```

This will be replaced with real Convex data later, but the empty state should look intentional, not placeholder-ish.

- [ ] **Step 4: Update quick deploy pills**

Find the quick deploy pills (around line 90). Update styling:
- Add `press-scale` class (scale-on-click)
- These should already be `rounded-full` — verify

- [ ] **Step 5: Verify home page**

Run: `npm run dev`

Check: stat cards have shadows (no borders), lift on hover. Activity section shows clean empty state. Deploy pills have scale-on-click.

- [ ] **Step 6: Commit**

```bash
git add components/views/home-view.tsx
git commit -m "design: shadow stat cards, clean activity empty state, scale-on-click pills"
```

---

### Task 13: Management Views — Agents, Settings, Inbox, Events

Light polish across all remaining views. One commit per view.

**Files:**
- Modify: `components/views/agents-index-view.tsx`
- Modify: `components/views/settings-view.tsx`
- Modify: `components/views/inbox-view.tsx`
- Modify: `components/views/events-view.tsx`

- [ ] **Step 1: Agents Index — hover actions, shadow card**

In `agents-index-view.tsx`:
- The list wrapper Card should use default variant (shadow, no border) — may already work from Task 3
- On each agent row, add `group` to the parent. Replace the static arrow icon with contextual actions that fade in:

```tsx
<span className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
  <button className="rounded-full p-1.5 hover:bg-accent" title="Chat">
    <MessageSquare className="size-4 text-muted-foreground" />
  </button>
  <button className="rounded-full p-1.5 hover:bg-accent" title="Settings">
    <Settings className="size-4 text-muted-foreground" />
  </button>
</span>
```

- [ ] **Step 2: Commit agents index**

```bash
git add components/views/agents-index-view.tsx
git commit -m "design: agents index hover actions, shadow card"
```

- [ ] **Step 3: Settings — underline tabs, ghost inputs**

In `settings-view.tsx`:
- The `<Tabs>` component should already use the updated underline style from Task 7
- Change form inputs to ghost variant: `<Input variant="ghost" />`
- Ensure all Card components use shadow (no explicit border overrides)
- Save buttons should already be pill-shaped from Task 2

- [ ] **Step 4: Commit settings**

```bash
git add components/views/settings-view.tsx
git commit -m "design: settings ghost inputs, underline tabs"
```

- [ ] **Step 5: Inbox — hover actions, subtle unread dot**

In `inbox-view.tsx`:
- Add `group` to each item wrapper
- Add contextual action on hover (e.g., "Go to chat" icon that fades in)
- Change unread dot from `bg-primary` to `bg-foreground size-1.5` (smaller, subtler)
- Update type badges to use the new Badge component: `<Badge variant="info" appearance="light" size="xs">`

- [ ] **Step 6: Commit inbox**

```bash
git add components/views/inbox-view.tsx
git commit -m "design: inbox hover actions, subtle unread dot, light badges"
```

- [ ] **Step 7: Events — same treatment**

In `events-view.tsx`:
- Add `group` to each event item
- Use StatusDot component with narrative tooltips (already upgraded in Task 6)
- Add hover bg tint: `hover:bg-accent/50` with 150ms transition

- [ ] **Step 8: Commit events**

```bash
git add components/views/events-view.tsx
git commit -m "design: events hover tint, narrative status dots"
```

---

### Task 14: Final Verification & Cleanup

Full pass through the app to catch inconsistencies.

**Files:**
- Any files with remaining issues

- [ ] **Step 1: TypeScript check**

Run: `npx tsc --noEmit --pretty`

Fix any type errors introduced by component API changes (e.g., old `tone` prop on Badge, missing variant props).

- [ ] **Step 2: Visual sweep — all views**

Run: `npm run dev`

Walk through every view:
1. Home (empty state + dashboard state)
2. Agents index
3. Agent detail / chat (send a message, check bubbles)
4. Settings (all tabs)
5. Inbox
6. Events
7. Sidebar (hover agents, expand sessions)
8. Dark mode toggle (every view)

Check for:
- Any remaining visible card borders that should be shadows
- Any non-pill buttons that should be pill
- Any missing scale-on-click
- Any missing hover transitions
- Color consistency (no warm tint remnants)

- [ ] **Step 3: Fix any issues found**

Address each issue directly in the relevant file.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "design: final UI overhaul polish and consistency fixes"
```

---

## Implementation Notes

- **Do not break existing functionality.** Every task should produce a working app. If a component API change breaks a consumer, fix the consumer in the same task.
- **Test dark mode at every step.** The OKLCH token system should handle dark mode automatically, but verify shadows and borders especially.
- **Existing assistant-ui Primitives should not be replaced** — only their `className` props get updated. The runtime behavior (messages, streaming, tool calls) stays untouched.
- **The `press-scale` utility on `button, a, [role="button"]` in Task 1 applies globally.** If any element shouldn't have it, add `active:scale-100` to override.
