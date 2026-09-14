/** @jsxImportSource chat */
import "server-only";

import {
  Card,
  CardText,
  Button,
  Actions,
  Fields,
  Field,
  Divider,
} from "chat";

import { BOT_NAME } from "@/lib/config/branding";

/**
 * Rich welcome card posted when the bot is invited to a channel.
 * Shows capabilities and interactive buttons for common actions.
 */
export function welcomeCard() {
  return (
    <Card title={`Meet ${BOT_NAME}`}>
      <CardText>
        I&apos;m an AI agent powered by Dispatch. @-mention me anytime and
        I&apos;ll help with tasks, research, drafting, analysis, and more.
      </CardText>
      <Divider />
      <Fields>
        <Field label="How to use" value="@-mention me with your request" />
        <Field label="DMs" value="Message me directly for private tasks" />
        <Field label="Threads" value="I follow threads I'm tagged in" />
      </Fields>
      <Actions>
        <Button id="sc-help" style="primary">
          What can you do?
        </Button>
        <Button id="sc-status">Status</Button>
      </Actions>
    </Card>
  );
}

/**
 * Help card — lists what the agent can do.
 */
export function helpCard(agentName: string) {
  return (
    <Card title={`${agentName} — Capabilities`}>
      <CardText>Here&apos;s what I can help with:</CardText>
      <Fields>
        <Field label="Research" value="Web search, summarize articles, compare options" />
        <Field label="Writing" value="Draft emails, posts, docs, and reports" />
        <Field label="Analysis" value="Break down data, spot patterns, build charts" />
        <Field label="Code" value="Read, write, and run code in my sandbox" />
        <Field label="Tasks" value="Track to-dos, follow up, manage workflows" />
      </Fields>
      <Divider />
      <CardText>Just @-mention me with what you need. I&apos;ll ask if anything is unclear.</CardText>
    </Card>
  );
}

/**
 * Status card — shows the agent's current state.
 */
export function statusCard(agentName: string, info: {
  status: string;
  model: string;
  permissions: string;
}) {
  return (
    <Card title={`${agentName} — Status`}>
      <Fields>
        <Field label="Status" value={info.status === "started" ? "Running" : info.status} />
        <Field label="Model" value={info.model || "Default"} />
        <Field label="Permissions" value={capitalize(info.permissions || "balanced")} />
      </Fields>
    </Card>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
