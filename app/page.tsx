import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";

import activityError from "@/screenshots/showcase/05-activity-expanded-error.png";
import agentCommandCenter from "@/screenshots/showcase/02-agent-command-center-running.png";
import automationDetail from "@/screenshots/showcase/08-automation-detail-delivery-options.png";
import filesWorkspace from "@/screenshots/showcase/10-files-knowledge-and-workspace.png";
import integrationsCatalog from "@/screenshots/showcase/06-integrations-with-tool-catalog.png";
import workforceOverview from "@/screenshots/showcase/01-workforce-overview-three-agents.png";

export const metadata: Metadata = {
  title: "Dispatch - The self-hosted control plane for AI agents",
  description:
    "Dispatch keeps the record around every AI agent: chats, runs, files, tools, schedules, failures, and reviews.",
  openGraph: {
    title: "Dispatch - The self-hosted control plane for AI agents",
    description:
      "Dispatch keeps the record around every AI agent: chats, runs, files, tools, schedules, failures, and reviews.",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
      },
    ],
  },
};

const flow = [
  {
    label: "Messages arrive",
    body: "Slack, Telegram, email, webhooks, and the places your team already works.",
  },
  {
    label: "Context gathers",
    body: "The agent gets one record for chat, files, tools, schedules, settings, and memory.",
  },
  {
    label: "Work runs",
    body: "OpenCode runs inside a Daytona sandbox with the model and tool access you choose.",
  },
  {
    label: "Review stays",
    body: "Every run leaves status, transcript, errors, files touched, and the next thing to fix.",
  },
];

const proofCards: Array<{
  label: string;
  title: string;
  body: string;
  image: StaticImageData;
  alt: string;
}> = [
  {
    label: "workspace",
    title: "The agent has a desk.",
    body: "Chat sits beside the sandbox, files, sessions, tools, and live run state.",
    image: agentCommandCenter,
    alt: "Dispatch agent command center with a running chat session and workspace controls",
  },
  {
    label: "activity",
    title: "Failures do not disappear.",
    body: "Inspect the status, timing, error, and thread that produced the run.",
    image: activityError,
    alt: "Dispatch activity view with an expanded failed run and diagnostic details",
  },
  {
    label: "tools",
    title: "Tool access is explicit.",
    body: "Connect the services an agent can use before it touches real work.",
    image: integrationsCatalog,
    alt: "Dispatch integrations catalog with connected tools and available integrations",
  },
  {
    label: "automations",
    title: "Scheduled work is inspectable.",
    body: "Set a prompt, schedule, and delivery target, then review the run history.",
    image: automationDetail,
    alt: "Dispatch automation detail page showing delivery options and run configuration",
  },
  {
    label: "files",
    title: "Working files stay close.",
    body: "Upload knowledge and inspect what the agent has in its workspace.",
    image: filesWorkspace,
    alt: "Dispatch files and knowledge workspace with uploaded files",
  },
];

const stack = [
  ["Next.js", "App Router web control plane"],
  ["React + Tailwind", "interface components and landing surface"],
  ["Convex", "agents, runs, files, integrations"],
  ["Daytona", "sandbox workspaces and volumes"],
  ["OpenCode", "runtime harness inside each sandbox"],
  ["Chat SDK", "Slack, Telegram, and channel adapters"],
  ["Composio", "external app tools and OAuth"],
];

const builtOn = [
  "Next.js",
  "Convex",
  "Daytona",
  "OpenCode",
  "Chat SDK",
  "Composio",
];

const heroChannels = [
  ["Slack", "Customer question"],
  ["Telegram", "Ops update"],
  ["Email", "Follow-up needed"],
];

const heroReceipts = [
  ["Run 184", "ok", "Slack + files"],
  ["Run 185", "review", "tool blocked"],
  ["Run 186", "draft", "email ready"],
];

const heroLedger = [
  ["Transcript", "what the agent said"],
  ["Tools", "what it touched"],
  ["Files", "what it read or wrote"],
  ["Failures", "where it got stuck"],
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#ece6d8] text-[#15130f]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(240,82,35,0.12),transparent_24rem),linear-gradient(rgba(21,19,15,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(21,19,15,0.03)_1px,transparent_1px)] bg-[size:auto,56px_56px,56px_56px]" />
      <LandingNav />

      <section className="mx-auto grid max-w-[1480px] gap-8 px-4 pb-14 pt-8 sm:px-6 lg:px-8 lg:pb-20 lg:pt-12 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="px-1 py-4 sm:px-2 lg:py-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#5f5a4d]">
            Self-hosted agent supervision
          </p>
          <h1 className="mt-6 max-w-[11ch] text-[clamp(4rem,10vw,9.6rem)] font-semibold leading-[0.82] tracking-[-0.085em] text-[#15130f]">
            Agents work elsewhere. Dispatch keeps the record.
          </h1>
          <p className="mt-7 max-w-[38rem] text-lg leading-8 text-[#514c42] sm:text-xl sm:leading-9">
            Dispatch is the open-source control plane for agents that operate
            across channels, tools, files, and sandboxes. Self-host it to see
            what ran, what changed, what failed, and what needs a human next.
          </p>

          <div className="mt-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#777061]">
              Built on
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {builtOn.map((item) => (
                <span
                  key={item}
                  className="bg-[#f8f6ee]/70 px-3 py-1.5 text-sm font-semibold text-[#15130f] ring-1 ring-[#15130f]/10"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="https://github.com/Aarekaz/dispatch"
              className="inline-flex h-11 items-center justify-center rounded-none bg-[#15130f] px-5 text-sm font-semibold text-[#f8f6ee] transition hover:bg-[#2b271f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15130f]"
            >
              Self-host Dispatch
            </Link>
            <Link
              href="#evidence"
              className="inline-flex h-11 items-center justify-center rounded-none border border-[#15130f]/18 bg-transparent px-5 text-sm font-semibold text-[#15130f] transition hover:bg-[#ddd7c9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15130f]"
            >
              See the product
            </Link>
          </div>
        </div>

        <ControlPlaneEvidence />
      </section>

      <section
        id="product"
        className="mx-auto max-w-[1480px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
      >
        <div className="grid gap-4 lg:grid-cols-4">
          {flow.map((item, index) => (
            <article
              key={item.label}
              className="border-t border-[#15130f]/18 px-1 py-5 lg:px-0 lg:py-6"
            >
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#8a826f]">
                0{index + 1}
              </p>
              <h2 className="mt-8 text-3xl font-semibold leading-[0.95] tracking-[-0.055em] text-[#15130f]">
                {item.label}
              </h2>
              <p className="mt-4 text-sm leading-6 text-[#5b5549]">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1480px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid gap-6 lg:grid-cols-[0.44fr_0.56fr]">
          <div className="flex flex-col justify-between bg-[#f8f6ee]/72 p-5 ring-1 ring-[#15130f]/8 sm:p-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#777061]">
                Product shape
              </p>
              <h2 className="mt-5 max-w-xl text-6xl font-semibold leading-[0.86] tracking-[-0.075em] text-[#15130f]">
                Not another chatbot window.
              </h2>
              <p className="mt-6 max-w-lg text-base leading-7 text-[#514c42]">
                Chat is only one surface. Dispatch wraps the agent with the
                operational parts you need to trust it: workspace, run log,
                files, tools, schedules, and review state.
              </p>
            </div>
            <div className="mt-10 divide-y divide-[#15130f]/10 border-y border-[#15130f]/12">
              {[
                "Which channel did this come from?",
                "Which tool did it use?",
                "What file did it leave behind?",
                "What failed, and where?",
              ].map((question) => (
                <p key={question} className="py-3 text-sm text-[#514c42]">
                  {question}
                </p>
              ))}
            </div>
          </div>

          <div className="bg-[#15130f] p-1 shadow-[0_22px_70px_rgba(21,19,15,0.18)]">
            <Image
              src={workforceOverview}
              alt="Dispatch workforce overview showing three agents"
              sizes="(min-width: 1024px) 56vw, 100vw"
              className="h-full w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      <section
        id="evidence"
        className="mx-auto max-w-[1480px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
      >
        <div className="mb-10 grid gap-5 border-t border-[#15130f]/12 pt-10 lg:grid-cols-[0.65fr_0.35fr] lg:items-end">
          <h2 className="max-w-4xl text-6xl font-semibold leading-[0.9] tracking-[-0.075em] text-[#15130f]">
            The interface is the receipt.
          </h2>
          <p className="max-w-md text-sm leading-6 text-[#5b5549]">
            Dispatch should be judged by the surfaces it gives operators:
            agent workspace, run evidence, integration permissions, scheduled
            work, and the files agents use.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-12">
          {proofCards.map((card, index) => (
            <article
              key={card.title}
              className={
                index === 0
                  ? "grid overflow-hidden bg-[#f8f6ee]/84 ring-1 ring-[#15130f]/10 lg:col-span-12 lg:grid-cols-[0.34fr_0.66fr]"
                  : "overflow-hidden bg-[#f8f6ee]/84 ring-1 ring-[#15130f]/10 lg:col-span-6"
              }
            >
              <div className="flex min-h-56 flex-col justify-between p-5">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#777061]">
                  {card.label}
                </p>
                <div className="mt-8">
                  <h3
                    className={
                      index === 0
                        ? "max-w-sm text-5xl font-semibold leading-[0.92] tracking-[-0.07em]"
                        : "text-3xl font-semibold leading-[0.95] tracking-[-0.055em]"
                    }
                  >
                    {card.title}
                  </h3>
                  <p className="mt-4 max-w-md text-sm leading-6 text-[#5b5549]">
                    {card.body}
                  </p>
                </div>
              </div>
              <div className="border-t border-[#15130f]/10 bg-white/90 lg:border-l lg:border-t-0">
                <Image
                  src={card.image}
                  alt={card.alt}
                  sizes={
                    index === 0
                      ? "(min-width: 1024px) 66vw, 100vw"
                      : "(min-width: 1024px) 50vw, 100vw"
                  }
                  className="h-full w-full object-cover object-top"
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        id="self-host"
        className="mx-auto max-w-[1480px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
      >
        <div className="grid overflow-hidden bg-[#15130f] shadow-[0_24px_80px_rgba(21,19,15,0.16)] lg:grid-cols-[0.42fr_0.58fr]">
          <div className="p-6 text-[#f8f6ee] sm:p-8">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#bdb4a1]">
              Self-hosting
            </p>
            <h2 className="mt-5 max-w-lg text-5xl font-semibold leading-[0.9] tracking-[-0.065em]">
              Built from pieces you can replace.
            </h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#d6cdb8]">
              Dispatch is intentionally explicit about its stack. The control
              plane, database, sandbox, runtime, channels, and tools are
              separate parts you can run, replace, or audit.
            </p>
          </div>
          <div className="divide-y divide-[#15130f]/10 bg-[#f8f6ee]">
            {stack.map(([label, body]) => (
              <article
                key={label}
                className="grid gap-4 p-5 sm:grid-cols-[8rem_1fr]"
              >
                <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-[#777061]">
                  {label}
                </h3>
                <p className="text-sm leading-6 text-[#514c42]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1480px] gap-6 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[0.6fr_0.4fr] lg:px-8 lg:pb-24 lg:pt-16">
        <div className="bg-[#15130f] p-1 shadow-[0_22px_70px_rgba(21,19,15,0.16)]">
          <Image
            src={agentCommandCenter}
            alt="Dispatch command center with agent controls"
            sizes="(min-width: 1024px) 60vw, 100vw"
            className="w-full"
          />
        </div>
        <div className="flex flex-col justify-center px-1 py-4 sm:px-4 lg:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#777061]">
            Open source
          </p>
          <h2 className="mt-5 max-w-lg text-5xl font-semibold leading-[0.9] tracking-[-0.065em]">
            A control plane, not a promise.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#514c42]">
            The README gets you running. The product is what happens after:
            every agent gets a place to work, a trail to inspect, and a record
            you can keep when the model output is not enough.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="https://github.com/Aarekaz/dispatch"
              className="inline-flex h-11 items-center justify-center rounded-none bg-[#15130f] px-5 text-sm font-semibold text-[#f8f6ee] transition hover:bg-[#2b271f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15130f]"
            >
              View GitHub
            </Link>
            <Link
              href="/app"
              className="inline-flex h-11 items-center justify-center rounded-none border border-[#15130f]/18 px-5 text-sm font-semibold text-[#15130f] transition hover:bg-[#ddd7c9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15130f]"
            >
              Open app
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function ControlPlaneEvidence() {
  return (
    <div className="relative min-h-[620px] overflow-hidden bg-[#11100e] p-2 text-[#f8f6ee] shadow-[0_24px_90px_rgba(21,19,15,0.22)] sm:min-h-[680px] sm:p-3">
      <div className="pointer-events-none absolute -right-16 -top-14 h-64 w-72 rotate-[-7deg] bg-[#f05223]" />
      <div className="pointer-events-none absolute right-10 top-14 h-52 w-52 rotate-[-7deg] bg-[radial-gradient(circle,rgba(240,82,35,0.28)_1.5px,transparent_1.5px)] bg-[size:11px_11px]" />
      <div className="pointer-events-none absolute -bottom-10 left-8 h-64 w-48 rotate-[8deg] bg-[#f8f4e9]/10" />

      <div className="relative z-10 grid min-h-[596px] grid-rows-[auto_1fr_auto] bg-[#15130f]/94 ring-1 ring-[#f8f6ee]/10 sm:min-h-[648px]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#f8f6ee]/14 px-4 py-4 sm:px-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#c9c1ad]">
            Dispatch / supervision layer
          </p>
          <p className="border border-[#f8f6ee]/18 px-3 py-1.5 text-xs font-semibold text-[#f8f6ee]">
            Channels to receipts
          </p>
        </div>

        <div className="grid bg-[#f8f6ee]/10 xl:grid-cols-[0.34fr_0.66fr]">
          <div className="flex flex-col justify-between bg-[#15130f] p-4 sm:p-5">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#8f8776]">
                What Dispatch does
              </p>
              <h2 className="mt-3 max-w-xl text-5xl font-semibold leading-[0.9] tracking-[-0.065em]">
                Channels in. Receipts out.
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-6 text-[#c9c1ad]">
                Agents can answer in Slack, Telegram, email, or the web.
                Dispatch keeps the operating record: prompt, transcript, tools,
                files, failures, and the next review.
              </p>
            </div>

            <div className="mt-8 divide-y divide-[#f8f6ee]/10 border-y border-[#f8f6ee]/12">
              {heroLedger.map(([label, body]) => (
                <div key={label} className="grid grid-cols-[7rem_1fr] py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f05223]">
                    {label}
                  </p>
                  <p className="text-sm text-[#e7dfca]">{body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative min-h-[470px] overflow-hidden bg-[#f8f4e9] p-4 text-[#15130f] sm:p-5">
            <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(240,82,35,0.16)_1.3px,transparent_1.3px)] bg-[size:12px_12px] opacity-80" />
            <div className="absolute left-[29%] top-[25%] hidden h-px w-[19%] bg-[#15130f]/24 xl:block" />
            <div className="absolute right-[31%] top-[25%] hidden h-px w-[17%] bg-[#15130f]/24 xl:block" />
            <div className="absolute left-[29%] top-[49%] hidden h-px w-[19%] bg-[#15130f]/24 xl:block" />
            <div className="absolute right-[31%] top-[49%] hidden h-px w-[17%] bg-[#15130f]/24 xl:block" />
            <div className="absolute left-[29%] top-[73%] hidden h-px w-[19%] bg-[#15130f]/24 xl:block" />
            <div className="absolute right-[31%] top-[73%] hidden h-px w-[17%] bg-[#15130f]/24 xl:block" />

            <div className="relative grid h-full gap-3 xl:grid-cols-[0.24fr_0.43fr_0.33fr]">
              <div className="grid min-w-0 gap-3 self-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#777061]">
                  Channels
                </p>
                {heroChannels.map(([label, body]) => (
                  <SystemTicket key={label} label={label} body={body} />
                ))}
              </div>

              <div className="relative flex min-w-0 items-center">
                <div className="w-full bg-[#15130f] p-2 text-[#f8f6ee] shadow-[10px_10px_0_rgba(240,82,35,0.72)]">
                  <div className="p-4 ring-1 ring-[#f8f6ee]/16">
                    <div className="mb-5 flex items-center justify-between">
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#bdb4a1]">
                        Agent record
                      </p>
                      <span className="size-3 bg-[#f05223]" />
                    </div>
                    <p className="text-3xl font-semibold leading-[0.9] tracking-[-0.055em]">
                      The work can leave chat.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#d6cdb8]">
                      Dispatch keeps the desk around it: state, permissions,
                      files, run history, and review.
                    </p>
                    <div className="mt-5 grid gap-1.5">
                      {["chat", "runs", "tools", "files"].map((item) => (
                        <p
                          key={item}
                          className="bg-[#f8f6ee]/8 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#f8f6ee]"
                        >
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 gap-3 self-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#777061]">
                  Receipts
                </p>
                {heroReceipts.map(([id, status, detail]) => (
                  <ReceiptTicket key={id} id={id} status={status} detail={detail} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid border-t border-[#f8f6ee]/12 sm:grid-cols-3 sm:divide-x sm:divide-[#f8f6ee]/10">
          {["Create agents", "Connect channels", "Review runs"].map((item) => (
            <div key={item} className="bg-[#15130f] px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#908875]">
                {item}
              </p>
              <p className="mt-1 text-sm text-[#e7dfca]">
                with the record intact
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SystemTicket({ label, body }: { label: string; body: string }) {
  return (
    <article className="bg-[#fffbf1] p-3 ring-1 ring-[#15130f]/10">
      <div className="mb-5 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f05223]">
          {label}
        </p>
        <span className="size-2 border border-[#f05223]" />
      </div>
      <p className="text-sm font-semibold leading-5 tracking-[-0.02em]">{body}</p>
    </article>
  );
}

function ReceiptTicket({
  id,
  status,
  detail,
}: {
  id: string;
  status: string;
  detail: string;
}) {
  return (
    <article className="bg-[#fffbf1] p-3 ring-1 ring-[#15130f]/10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#777061]">
          {id}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f05223]">
          {status}
        </p>
      </div>
      <p className="text-sm font-semibold leading-5 tracking-[-0.02em]">{detail}</p>
    </article>
  );
}

function LandingNav() {
  return (
    <header className="mx-auto flex max-w-[1480px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
      <Link
        href="/"
        aria-label="Dispatch home"
        className="flex min-h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15130f]"
      >
        <Image
          src="/wordmark.svg"
          alt="Dispatch"
          width={116}
          height={28}
          priority
        />
      </Link>
      <nav
        aria-label="Primary navigation"
        className="hidden items-center gap-8 text-sm font-semibold text-[#514c42] md:flex"
      >
        <a
          href="#product"
          className="inline-flex min-h-11 items-center transition hover:text-[#15130f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15130f]"
        >
          Product
        </a>
        <a
          href="#self-host"
          className="inline-flex min-h-11 items-center transition hover:text-[#15130f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15130f]"
        >
          Self-host
        </a>
        <Link
          href="https://github.com/Aarekaz/dispatch"
          className="inline-flex min-h-11 items-center transition hover:text-[#15130f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15130f]"
        >
          GitHub
        </Link>
      </nav>
      <Link
        href="/app"
        className="inline-flex h-11 items-center justify-center border border-[#15130f]/18 px-4 text-sm font-semibold text-[#15130f] transition hover:bg-[#ddd7c9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15130f]"
      >
        Open app
      </Link>
    </header>
  );
}
