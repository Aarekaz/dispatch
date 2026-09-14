"use client";

import { useState } from "react";
import { ArrowRight, ChatCircle, Lightning, Users } from "@phosphor-icons/react";
import { sileo } from "sileo";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

const steps = [
  {
    id: "deploy",
    title: "Deploy your first agent",
    description: "Choose from our templates or create a custom agent with your own instructions.",
    icon: Lightning,
    href: "/agents/new",
    cta: "Deploy agent",
  },
  {
    id: "connect",
    title: "Connect a channel",
    description: "Wire up Slack, Telegram, or Discord so your agent can operate where your team works.",
    icon: ChatCircle,
    href: "/",
    cta: "Connect channel",
  },
  {
    id: "task",
    title: "Run your first task",
    description: "Give your agent a real task and see it work. Start simple — it learns as you go.",
    icon: Lightning,
    href: "/agents",
    cta: "Go to agents",
  },
  {
    id: "invite",
    title: "Invite a teammate",
    description: "Agents work best when the whole team can interact with them.",
    icon: Users,
    href: "/",
    cta: "Invite teammate",
  },
];

export function OnboardingDialog() {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to Dispatch</DialogTitle>
          <DialogDescription>
            Let&apos;s get you set up in a few quick steps.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <div className="flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              Step {currentStep + 1} of {steps.length}
            </span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="mt-1.5 h-1.5" />
        </div>

        <Separator className="my-2" />

        {step && (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-accent">
              <step.icon className="size-6 text-foreground" />
            </div>
            <h3 className="mt-4 text-[15px] font-semibold text-foreground">
              {step.title}
            </h3>
            <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
              {step.description}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            className="text-muted-foreground"
          >
            Skip setup
          </Button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentStep((s) => s - 1)}
              >
                Back
              </Button>
            )}
            {currentStep < steps.length - 1 ? (
              <Button
                size="sm"
                onClick={() => setCurrentStep((s) => s + 1)}
              >
                Next
                <ArrowRight data-icon="inline-end" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false);
                  sileo.info({
                    title: "Coming soon",
                    description: "Agent creation isn't available yet.",
                  });
                }}
              >
                Get started
                <ArrowRight data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
