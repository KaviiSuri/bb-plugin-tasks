export const TASK_BLOCKING_FILTERS = ["all", "blocked", "not_blocked"] as const;

export type TaskBlockingFilter = (typeof TASK_BLOCKING_FILTERS)[number];

export interface BlockerTaskRef {
  task: { key: string; status: string };
}

export function isUnresolvedBlockerStatus(status: string): boolean {
  return status !== "done" && status !== "canceled";
}

/** Direct unresolved blocker keys, derived from dependency endpoint statuses. */
export function unresolvedBlockerKeys(
  blockedBy: readonly BlockerTaskRef[],
): string[] {
  return blockedBy
    .filter(({ task }) => isUnresolvedBlockerStatus(task.status))
    .map(({ task }) => task.key);
}

export function blockedWorkMessage(
  taskKey: string,
  blockerKeys: readonly string[],
): string {
  const noun = blockerKeys.length === 1 ? "task" : "tasks";
  return `Task ${taskKey} is blocked by unresolved ${noun} ${blockerKeys.join(", ")}`;
}
