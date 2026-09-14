"use client";

import { useMemo, useState } from "react";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
} from "@phosphor-icons/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAgent } from "@/hooks/use-agents";
import type { AgentRun } from "@/lib/types";
import { relativeTime, cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelPill } from "@/components/ui/channel-pill";
import { RunStatusIndicator } from "@/components/ui/unicode-spinner";
import { TriggerBadge, capitalize } from "@/components/ui/trigger-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AgentErrorDetail } from "@/components/agent-management/agent-error-detail";
import { resolveChannel } from "@/components/activity/activity-row";
import { MODELS } from "@/lib/models";

/**
 * Activity — paginated, sortable table of every run the agent has done.
 *
 * Built on TanStack Table (headless) + shadcn Table primitives.
 *   • Filter tabs (status)
 *   • Full-text search
 *   • Sortable columns (click header)
 *   • 25 per page, Prev/Next
 *   • Failed rows expand inline with AgentErrorDetail
 */

type Filter = "all" | "failed" | "running" | "completed";

type Run = AgentRun & {
  startedAtMs: number;
  totalTokens: number;
};

const PAGE_SIZE = 25;

export default function ActivityPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent } = useAgent(agentId);
  const rawRuns = useQuery(api.runs.list, {
    agentId: agentId as Id<"agents">,
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "startedAtMs", desc: true },
  ]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const runs: Run[] = useMemo(
    () =>
      (rawRuns ?? []).map((r) => ({
        id: r._id,
        trigger: r.trigger as AgentRun["trigger"],
        channel: r.channel ?? undefined,
        sessionId: r.sessionId ?? undefined,
        sessionTitle: r.sessionTitle ?? undefined,
        automationId: r.automationId ?? undefined,
        automationName: r.automationName ?? undefined,
        status: r.status as AgentRun["status"],
        summary: r.summary ?? "",
        model: r.model ?? "",
        tokensIn: r.tokensIn ?? 0,
        tokensOut: r.tokensOut ?? 0,
        credits: r.credits ?? 0,
        startedAt: new Date(r.startedAt).toLocaleString(),
        startedAtMs: r.startedAt,
        duration: r.duration ?? "",
        errorCategory: r.errorCategory ?? undefined,
        errorDetail: r.errorDetail ?? undefined,
        correlationId: r.correlationId ?? undefined,
        totalTokens: (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
      })),
    [rawRuns],
  );

  const counts = useMemo(
    () => ({
      all: runs.length,
      failed: runs.filter((r) => r.status === "failed").length,
      running: runs.filter((r) => r.status === "running").length,
      completed: runs.filter((r) => r.status === "completed").length,
    }),
    [runs],
  );

  // Pre-filter by tab before handing to the table (simpler than a column filter)
  const filteredByTab = useMemo(() => {
    if (filter === "all") return runs;
    return runs.filter((r) => r.status === filter);
  }, [runs, filter]);

  const columns = useMemo<ColumnDef<Run>[]>(
    () => [
      {
        id: "status",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center">
            <RunStatusIndicator status={row.original.status} />
          </div>
        ),
        enableSorting: false,
      },
      {
        id: "channel",
        header: "Channel",
        cell: ({ row }) => <ChannelCell run={row.original} />,
        enableSorting: false,
      },
      {
        id: "summary",
        header: "Summary",
        cell: ({ row }) => (
          <span className="truncate text-foreground">
            {summaryText(row.original)}
          </span>
        ),
      },
      {
        id: "model",
        header: "Model",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {modelLabel(row.original.model)}
          </span>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.original.duration || "—"}
          </span>
        ),
      },
      {
        id: "tokens",
        accessorKey: "totalTokens",
        header: "Tokens",
        cell: ({ row }) => {
          const t = row.original.totalTokens;
          return (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t > 0 ? t.toLocaleString() : "—"}
            </span>
          );
        },
      },
      {
        id: "startedAtMs",
        accessorKey: "startedAtMs",
        header: "Time",
        cell: ({ row }) => (
          <time
            className="text-xs text-muted-foreground tabular-nums"
            dateTime={new Date(row.original.startedAtMs).toISOString()}
            title={new Date(row.original.startedAtMs).toLocaleString()}
          >
            {relativeTime(row.original.startedAtMs)}
          </time>
        ),
      },
    ],
    [],
  );

  // TanStack Table returns non-memoizable functions; this usage is intentional.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredByTab,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
    globalFilterFn: (row, _colId, filterValue) => {
      const q = String(filterValue).trim().toLowerCase();
      if (!q) return true;
      const r = row.original;
      return (
        r.summary.toLowerCase().includes(q) ||
        (r.sessionTitle ?? "").toLowerCase().includes(q) ||
        (r.automationName ?? "").toLowerCase().includes(q) ||
        (r.channel ?? "").toLowerCase().includes(q) ||
        r.trigger.toLowerCase().includes(q) ||
        (r.correlationId ?? "").toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q)
      );
    },
  });

  // Reset to page 1 whenever the tab or search changes
  const [lastFilter, setLastFilter] = useState(filter);
  const [lastSearch, setLastSearch] = useState(search);
  if (lastFilter !== filter || lastSearch !== search) {
    setLastFilter(filter);
    setLastSearch(search);
    table.setPageIndex(0);
  }

  const isLoading = rawRuns === undefined;

  if (isLoading) {
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <Skeleton className="mb-8 h-8 w-32" />
          <Skeleton className="mb-6 h-9 w-80" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  const rows = table.getRowModel().rows;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const totalFiltered = table.getFilteredRowModel().rows.length;
  const start = totalFiltered === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const end = Math.min((pageIndex + 1) * PAGE_SIZE, totalFiltered);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-12">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-baseline gap-2">
            <h1 className="font-serif text-2xl font-light leading-snug tracking-tight text-foreground">
              Activity
            </h1>
            {counts.failed > 0 && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                {counts.failed} failed
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Every run {agent?.name ?? "this agent"} has handled.
          </p>
        </header>

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-1" aria-label="Filter runs">
            <FilterTab
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label="All"
              count={counts.all}
            />
            <FilterTab
              active={filter === "failed"}
              onClick={() => setFilter("failed")}
              label="Failed"
              count={counts.failed}
              tone="destructive"
            />
            <FilterTab
              active={filter === "running"}
              onClick={() => setFilter("running")}
              label="Running"
              count={counts.running}
            />
            <FilterTab
              active={filter === "completed"}
              onClick={() => setFilter("completed")}
              label="Completed"
              count={counts.completed}
            />
          </nav>
          <div className="relative">
            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search runs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-64 pl-8 text-sm"
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="border-b border-border/60 hover:bg-transparent"
                >
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground/70",
                          hiddenColumn(header.id),
                        )}
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            {sorted === "asc" ? (
                              <CaretRight className="size-3 rotate-90" />
                            ) : sorted === "desc" ? (
                              <CaretDown className="size-3" />
                            ) : null}
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={columns.length}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    {search.trim()
                      ? `No runs match "${search}".`
                      : counts.all === 0
                        ? "No activity yet."
                        : "Nothing in this category."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const run = row.original;
                  const isFailed = run.status === "failed";
                  const isExpanded = expanded.has(run.id);
                  return (
                    <ActivityTableRow
                      key={run.id}
                      agentId={agentId}
                      run={run}
                      cells={row
                        .getVisibleCells()
                        .map((cell) => ({
                          id: cell.id,
                          columnId: cell.column.id,
                          content: flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          ),
                        }))}
                      colSpan={columns.length}
                      isFailed={isFailed}
                      isExpanded={isExpanded}
                      onToggleExpand={() => {
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(run.id)) next.delete(run.id);
                          else next.add(run.id);
                          return next;
                        });
                      }}
                    />
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalFiltered > 0 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              Showing <span className="text-foreground">{start}</span>–
              <span className="text-foreground">{end}</span> of{" "}
              <span className="text-foreground">{totalFiltered}</span>
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <CaretLeft className="size-3.5" />
                Previous
              </Button>
              <span className="tabular-nums">
                Page {pageIndex + 1} of {Math.max(1, pageCount)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
                <CaretRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Row component (handles expand + click-to-navigate) ── */

function ActivityTableRow({
  agentId,
  run,
  cells,
  colSpan,
  isFailed,
  isExpanded,
  onToggleExpand,
}: {
  agentId: string;
  run: Run;
  cells: { id: string; columnId: string; content: React.ReactNode }[];
  colSpan: number;
  isFailed: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const router = useRouter();

  function handleRowClick() {
    if (isFailed) {
      onToggleExpand();
      return;
    }
    const isAutomation =
      run.trigger === "automation" && run.automationId;
    const href = (isAutomation
      ? `/${agentId}/automations/${run.automationId}`
      : run.sessionId
        ? `/${agentId}/home?session=${run.sessionId}`
        : `/${agentId}/home`) as Route;
    router.push(href);
  }

  return (
    <>
      <TableRow
        aria-expanded={isFailed ? isExpanded : undefined}
        onClick={handleRowClick}
        className="cursor-pointer"
      >
        {cells.map((cell) => (
          <TableCell
            key={cell.id}
            className={cn(
              "px-4 py-2.5",
              cell.columnId === "summary" && "max-w-0",
              hiddenColumn(cell.columnId),
            )}
          >
            {cell.columnId === "summary" ? (
              <div className="truncate">{cell.content}</div>
            ) : (
              cell.content
            )}
          </TableCell>
        ))}
      </TableRow>
      {isFailed && isExpanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colSpan} className="bg-muted/20 p-4">
            <AgentErrorDetail run={run} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ── Cells ── */

function ChannelCell({ run }: { run: Run }) {
  const isAutomation = run.trigger === "automation" && run.automationId;
  if (isAutomation) {
    return (
      <span className="inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
        Auto
      </span>
    );
  }
  const channel = resolveChannel(run);
  return channel ? (
    <ChannelPill channel={channel} />
  ) : (
    <TriggerBadge trigger={run.trigger} />
  );
}

/* ── Filter tab pill ── */

function FilterTab({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "bg-foreground/[0.06] text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "ml-1.5 tabular-nums",
          active
            ? "text-muted-foreground"
            : tone === "destructive" && count > 0
              ? "text-destructive"
              : "text-muted-foreground/60",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ── Helpers ── */

function summaryText(run: Run): string {
  if (run.trigger === "automation" && run.automationId) {
    return run.summary || `via ${run.automationName ?? "automation"}`;
  }
  return (
    run.summary ||
    run.sessionTitle ||
    `${capitalize(run.trigger)}-triggered run${run.status === "failed" ? " failed" : ""}`
  );
}

function modelLabel(modelId: string): string {
  if (!modelId) return "—";
  const def = MODELS.find((m) => m.id === modelId);
  if (def) return def.label;
  return modelId.split("/").pop() ?? modelId;
}

/**
 * Responsive column hiding. Each column gets a Tailwind class that
 * hides it below a given breakpoint.
 *
 *   summary, status, channel, time → always visible
 *   duration → visible on sm+
 *   model    → visible on md+
 *   tokens   → visible on lg+
 */
function hiddenColumn(columnId: string): string {
  if (columnId === "duration") return "hidden sm:table-cell";
  if (columnId === "model") return "hidden md:table-cell";
  if (columnId === "tokens") return "hidden lg:table-cell";
  return "";
}
