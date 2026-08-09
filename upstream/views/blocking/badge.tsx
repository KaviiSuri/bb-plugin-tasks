import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyTask, Task } from "../../shared/contract.js";
import { useInvalidation, useTasksRpc } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

function isUnresolved(item: DependencyTask): boolean {
  return item.task.status !== "done" && item.task.status !== "canceled";
}

export function BlockedBadge({
  task,
  compact = false,
  className,
}: {
  task: Task;
  compact?: boolean;
  className?: string;
}) {
  const rpc = useTasksRpc();
  const navigation = useTasksNavigation();
  const [open, setOpen] = useState(false);
  const [blockers, setBlockers] = useState<DependencyTask[] | undefined>();
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateDetails = useCallback(() => {
    setBlockers(undefined);
    setError(null);
  }, []);
  useInvalidation(
    ["tasks:changed", "projects:changed"],
    invalidateDetails,
  );

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    invalidateDetails();
  }, [invalidateDetails, task.id, task.unresolvedBlockerCount]);

  useEffect(() => {
    if (!open || blockers !== undefined || error !== null) return;
    let active = true;
    void rpc.call("listTaskDependencies", { taskId: task.id }).then(
      (result) => {
        if (active) setBlockers(result.blockedBy.filter(isUnresolved));
      },
      (reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [blockers, error, open, rpc, task.id]);

  useEffect(() => () => cancelClose(), []);

  if (!task.isBlocked) return null;
  const blockerLabel = `${task.unresolvedBlockerCount} unresolved ${
    task.unresolvedBlockerCount === 1 ? "blocker" : "blockers"
  }`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Blocked: ${blockerLabel}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onMouseEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onMouseLeave={scheduleClose}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-px text-xs font-medium text-warning hover:border-warning/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <Icon name="Lock" className="size-3 shrink-0" />
          {compact ? task.unresolvedBlockerCount : "Blocked"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        role="dialog"
        aria-label={`Unresolved blockers for ${task.key}`}
        className="w-[min(22rem,var(--radix-popover-content-available-width))] p-2"
        mobileTitle={`Blocked · ${task.key}`}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="px-1 pb-1.5 text-xs font-semibold">
          {blockerLabel}
        </div>
        {error !== null ? (
          <p role="alert" className="px-1 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : blockers === undefined ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ul aria-label="Direct unresolved blockers" className="space-y-0.5">
            {blockers.map((blocker) => (
              <li key={blocker.task.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    navigation.go({
                      kind: "task",
                      taskKey: blocker.task.key,
                    });
                  }}
                >
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {blocker.task.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {blocker.task.title}
                  </span>
                  {blocker.task.isBlocked ? (
                    <span
                      aria-label={`${blocker.task.key} is also blocked`}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-warning/40 bg-warning/10 px-1 text-2xs font-medium text-warning"
                    >
                      <Icon name="Lock" className="size-2.5" />
                      Blocked
                    </span>
                  ) : null}
                  <span className="max-w-24 truncate text-2xs text-muted-foreground">
                    {blocker.project.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
