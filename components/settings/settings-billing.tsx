"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/unicode-spinner";

export function SettingsBilling() {
  const { data: user, isLoading } = useUser();
  const summary = useQuery(api.credits.summary);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner context="loading" />
      </div>
    );
  }

  const total = summary?.total ?? 5000;
  const used = summary?.used ?? 0;
  const percentUsed = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const isHigh = percentUsed > 80;
  const barColor = isHigh ? "bg-destructive" : "bg-foreground";

  return (
    <section>
      <header className="mb-6">
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          Plan & usage
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Your subscription and credit usage this month.
        </p>
      </header>

      <dl className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-xs text-muted-foreground">Plan</dt>
          <dd className="text-foreground">{user.plan}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-xs text-muted-foreground">
            Credits used
          </dt>
          <dd className="tabular-nums text-foreground">
            {summary ? (
              <>
                {used.toLocaleString()}{" "}
                <span className="text-muted-foreground">
                  of {total.toLocaleString()}
                </span>
              </>
            ) : (
              <Skeleton className="inline-block h-4 w-24" />
            )}
          </dd>
        </div>
        {summary?.costUsd != null && summary.costUsd > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-xs text-muted-foreground">
              Cost this month
            </dt>
            <dd className="tabular-nums text-foreground">
              ${summary.costUsd.toFixed(2)}
            </dd>
          </div>
        )}
      </dl>

      {/* Usage bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${barColor} transition-[width] duration-300 ease-out`}
          style={{ width: `${percentUsed}%` }}
        />
      </div>
      {isHigh && (
        <p className="mt-2 text-xs text-destructive">
          You&apos;ve used {Math.round(percentUsed)}% of your monthly credits.
        </p>
      )}

      {/* Per-agent breakdown */}
      {summary?.byAgent && summary.byAgent.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            By agent
          </p>
          <ul className="space-y-1.5">
            {summary.byAgent.map((a) => (
              <li
                key={a.agentId}
                className="flex items-baseline justify-between text-sm"
              >
                <span className="text-foreground">{a.agentName}</span>
                <span className="tabular-nums text-muted-foreground">
                  {a.credits.toLocaleString()} credits
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Per-model breakdown */}
      {summary?.byModel && summary.byModel.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            By model
          </p>
          <ul className="space-y-1.5">
            {summary.byModel.map((m) => (
              <li
                key={m.model}
                className="flex items-baseline justify-between text-sm"
              >
                <span className="text-foreground">
                  {m.model.split("/").pop() ?? m.model}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {m.credits.toLocaleString()} credits
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="inline-flex items-center rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Coming soon
        </span>
        <Button variant="outline" size="sm" disabled>
          Manage plan
        </Button>
      </div>
    </section>
  );
}
