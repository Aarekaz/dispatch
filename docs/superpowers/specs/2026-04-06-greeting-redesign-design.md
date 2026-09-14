# Agent Greeting Screen Redesign

**Date:** 2026-04-06
**Scope:** Chat greeting/transition UX (Option A from brainstorm)

## Overview

Redesign the agent page to have two distinct views: a greeting screen for new conversations and a chat screen for active sessions. Bring back Dispatch v1's design language (blob avatars, serif typography, dot grid, staggered animations).

## UX Flow

```
User opens /agents/[id]
  ├─ No active session → Greeting View (centered, landing-page feel)
  │   User types message and hits send
  │   → Create session via API
  │   → Set activeSessionId + initialMessage
  │   → Switch to Chat View
  │
  └─ Has active session (URL ?session=xyz or selected from sidebar)
      → Chat View (assistant-ui Thread, composer at bottom)
```

**Key constraint:** The greeting's input is a plain HTML input, NOT ComposerPrimitive. Only one ComposerPrimitive instance exists, in the chat view. This avoids all state management conflicts.

## Component Architecture

### New Files

**`components/agent-avatar.tsx`** — Reusable blob avatar
- Props: `name: string`, `size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'`, `theme?: ColorTheme`
- 6 color themes from v1: gray, aurora, ocean, emerald, sunset, violet
- Auto-assigns theme by hashing agent name if not specified
- Renders 4 animated blob layers with `mix-blend-mode: screen`
- Highlight/shine pulse effect
- Initial letter centered with text-shadow
- Sizes: xs=24px, sm=32px, md=40px, lg=56px, xl=80px
- Respects `prefers-reduced-motion`

**`components/agent-greeting.tsx`** — Greeting screen
- Props: `agentName: string`, `agentTheme?: ColorTheme`, `suggestions: string[]`, `onSend: (message: string) => void`
- Layout: centered flex column, vertically centered in parent
- Dot grid background (CSS radial-gradient, faded with mask)
- AgentAvatar (lg size)
- Agent name label (12px, muted)
- Hero text: "Let's get started" (Newsreader serif, 30px)
- Subtitle: "What would you like to build today?" (14px, muted)
- Plain input styled like v1 composer (border, 4-layer shadow, 20px radius, send button)
- Suggestion pills below input (click fills input and submits)
- Staggered enter animation (600ms, 80ms delay increments, blur+translateY)
- On submit: calls `onSend(message)` — parent handles session creation

### Modified Files

**`components/assistant-ui/thread.tsx`**
- Remove `ThreadWelcome` component (replaced by AgentGreeting at parent level)
- Thread only renders when there's an active chat session
- Existing message rendering, composer, scroll button, thinking indicator unchanged

**`components/agent-chat.tsx`**
- Add state: `showGreeting` (derived from whether there's an active session with messages)
- When `showGreeting`: render `<AgentGreeting onSend={handleFirstMessage} />`
- When not greeting: render `<ChatThread />` as current
- `handleFirstMessage(text)`: creates session, sets activeSessionId, sets initialMessage state
- Pass initialMessage to ChatThread so it's sent on mount via the runtime

**`app/globals.css`**
- Add `@import` for Newsreader font (Google Fonts)
- Add blob animation keyframes: siriBlob1, siriBlob2, siriBlob3, siriBlob4, siriPulse
- Add staggered enter animation keyframe
- Add `.dot-grid` utility class
- Add `.greeting-input-shadow` utility (4-layer shadow from v1)

### Sidebar Avatar Update

**`components/app-sidebar.tsx`**
- Replace emoji avatar with `<AgentAvatar size="xs" />` in agent list items
- Each agent gets a unique animated blob avatar based on name hash

## Design Tokens

### Typography
- Hero text: `font-family: 'Newsreader', Georgia, serif`
- Hero size: 30px, weight 400, letter-spacing -0.5px
- Agent label: 12px, weight 500, color muted
- Subtitle: 14px, weight 400, color muted

### Colors (Avatar Themes)
```
gray:    bg=#1a1a1a  blobs=[#a3a3a3, #d4d4d4, #737373, #e5e5e5]
aurora:  bg=#0c0414  blobs=[#FF2D87, #00C9FF, #7B61FF, #FF6B9D]
ocean:   bg=#060E1F  blobs=[#38bdf8, #818cf8, #06b6d4, #6366f1]
emerald: bg=#04120C  blobs=[#10b981, #059669, #34d399, #047857]
sunset:  bg=#140804  blobs=[#f97316, #ef4444, #eab308, #dc2626]
violet:  bg=#0E0418  blobs=[#a855f7, #ec4899, #8b5cf6, #d946ef]
```

### Animations
- Enter: 600ms cubic-bezier(0.25, 0.46, 0.45, 0.94), from opacity:0 translateY:8px blur:4px
- Stagger: 80ms increments via CSS custom property `--stagger`
- Blob: 3-5.4s ease-in-out infinite alternate (each blob different duration)
- Shine: 3s ease-in-out infinite alternate pulse

### Composer Shadow (v1 style)
```
light: 0 0 0 0.7px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.03), 0 2px 2px rgba(0,0,0,0.02), 0 1px 5px rgba(0,0,0,0.05)
dark:  0 0 0 0.7px rgba(255,255,255,0.06), 0 1px 1px rgba(0,0,0,0.2), 0 2px 2px rgba(0,0,0,0.15), 0 1px 5px rgba(0,0,0,0.25)
```

### Dot Grid
```css
background-image: radial-gradient(circle, currentColor 1px, transparent 1px);
background-size: 16px 16px;
opacity: 0.035;
mask-image: linear-gradient(to bottom, black 30%, transparent 75%);
```

## What's NOT Changing
- Chat message rendering (UserMessage, AssistantMessage)
- Tool call cards, file cards, markdown rendering
- Thinking indicator (already fixed in ViewportFooter)
- Session management API routes
- Convex persistence layer
- Artifact panel
- Settings, model config, agent management views

## Fast Follow (ship separately after greeting is verified)
- Recent session cards on greeting page (2-column grid below composer, Ghost Inc pattern)
- Sidebar hides session list when on greeting view (no active session)
- Data source: reuse existing `loadSessions()` — just different rendering

## Testing Checklist
- [ ] Greeting shows on fresh agent page (no session)
- [ ] Typing in greeting input and pressing Enter creates session and switches to chat
- [ ] Clicking suggestion pill fills input and submits
- [ ] Chat view loads with first message already sent
- [ ] Sidebar shows blob avatars for all agents
- [ ] Clicking existing session in sidebar skips greeting, goes straight to chat
- [ ] "New chat" button returns to greeting
- [ ] Blob animations render smoothly (check GPU usage)
- [ ] Reduced motion preference disables blob animations
- [ ] Dark mode works for all new components
- [ ] Mobile responsive (greeting scales down, sidebar hidden)
