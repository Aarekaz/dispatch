# Copilot Instructions

## Design Context

### Users

**Operations and ops managers at small/mid-sized businesses.** Non-engineers running real businesses — support leads, ops managers, founders wearing the operations hat. They are buying AI agents to take work off their plate (support, sales follow-up, inbox triage, recurring ops). They are not technical, will not read API docs, and will not know what "endpoint", "instance", "deploy", or "runtime" mean without translation.

Their context when using Dispatch: short sessions, often interrupted, on a laptop in a busy office or coffee shop. They land here when something's broken ("an agent isn't responding"), when they want to add capacity ("create a new one"), or when they need to verify work was done ("did it actually email the customer?"). They need to *trust* the product before they trust it with their business.

**Job to be done:** "Create, supervise, and trust an AI agent fleet without becoming a technical operator."

### Where the product actually lives (CRITICAL)

**Dispatch is NOT a chat app. The web app is a control plane for agents that live somewhere else.** The agents are deployed into the customer's existing channels — **Slack, WhatsApp, Telegram, Discord, Microsoft Teams, email, etc.** — via Chat SDK. That is where the work actually happens. The customer's *team* and the customer's *customers* talk to these agents in the channels they already use.

The web app's job is therefore:
1. **Create** — onboard a new AI agent and connect it to channels
2. **Supervise** — see what every agent did across every channel, in one place
3. **Approve/intervene** — handle escalations the agent flagged for human review
4. **Configure** — change behavior, knowledge, tools, channels
5. **Test** — try out an agent in a sandboxed web chat *before* connecting it to a real channel

**Design implications:**
- The home page must answer "what are my agents doing across all my channels right now?" — not "start a chat here." Activity is the hero, not chat.
- **Channels are first-class objects in the UI**, not buried in settings. Every agent should visibly show which channels it's connected to. Every activity item should show which channel it came from.
- The website chat is *for testing and configuration only*. It should feel visibly different from a deployed channel — sandbox-styled, "preview mode" affordance, never confused with the real thing.
- The competitive frame is **Intercom Fin, Sierra, Zapier Agents, Front** — supervision dashboards for distributed AI workers. NOT ChatGPT or Claude.ai.
- Multi-channel presence is a *visible* product story, not a hidden feature. A new user landing on the home page should instantly understand "this thing works across all my apps."

### Brand Personality

**Three words:** confident, calm, considered.

**Voice:** Plain-spoken English, no jargon, no enthusiasm-theater. No "Let's get started!" or "Awesome!" or sparkle-emoji energy. Closer to a senior operations partner than a chatbot. Sentences are short. Labels are nouns the user already knows ("Inbox", "Activity", "Your agents") not invented terms.

**Emotional goal:** The user should feel like they brought in a professional firm, not signed up for another SaaS tool. The dominant feeling is *quiet competence* — the same way a well-run kitchen or a Mercury account dashboard feels. Boring in the best possible way.

**Anti-tone:** No sales-y exclamation marks. No "AI magic." No emoji as decoration. No "✨ Generated with AI" tells. No urgency theater (red badges, count-up animations, fake activity).

### Aesthetic Direction

**Reference points:** Linear, Vercel Dashboard, Mercury, Stripe Dashboard, Height. The shared DNA is *refined neutrality* — almost no color, type and spacing carry the design, every detail looks deliberate.

**Anti-references (explicit):**
- Generic AI dashboards (purple-to-blue gradients, glow accents, cyan-on-dark, sparkles icons everywhere) — the 2024 ChatGPT-clone aesthetic
- Enterprise SaaS (Salesforce, Workday — cluttered toolbars, blue headers, dense data tables)
- Crypto/web3 (neon, intentional ugliness, monospace everything)
- **Generic shadcn dashboard demo** — stat-card row, identical 2-col grid, repeating cards, lucide icons in every header

**Theme:** Light mode is the hero. Every design decision is made for light mode first. Dark mode must be correct and pleasant, but it's not where the design is *expressed*.

**Color:** Pure neutral OKLCH grays as the foundation. Accent color is reserved for actual semantic meaning — status (success / warning / destructive / info) and never for decoration. There is no brand hue. The neutrality IS the brand.

**Type:** Geist Sans is the workhorse. Geist Mono only for actual code/IDs. Newsreader serif is available for editorial moments — large display headings, empty-state hero text — but used sparingly. Body text is comfortable, not dense.

**Layout:** Resist the dashboard-grid impulse. Asymmetric, generous whitespace, varied rhythms. Not everything is a card. Cards should be the exception, not the wrapper for every block.

### Design Principles

1. **Refined neutrality, never sterile.** Linear-level restraint, but with intentional warmth in spacing, microcopy, and detail. The absence of color is the point. Sterile is a failure mode — fix it with rhythm, type, and craft, not by adding color.

2. **Plain English, never jargon.** The audience is non-technical. Every label, button, error, and empty state must read naturally to someone who has never deployed software. "Agents" is fine; "instances", "endpoints", "runtimes", "workers" are not. Test every string against: would a small-business owner understand this in two seconds?

3. **Quality is the brand.** With no color and no decoration to fall back on, every detail (alignment, spacing rhythm, hover state, empty state copy, focus ring, loading shimmer) must feel intentional. Polish IS the differentiation — the moment something looks "default", the brand collapses.

4. **Power is shown through what works, not what glows.** No gradients for "impact." No glassmorphism. No glow on hover. No animated metrics. Capability is communicated by responsiveness, accuracy, and restraint — not by visual theatrics.

5. **One voice across every surface.** Settings, errors, empty states, modals, and onboarding must all feel cut from the same cloth. There are no "fancy" pages and "boring" pages. The same care visits every screen — including the ones nobody talks about.
