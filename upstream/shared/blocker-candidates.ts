import type { TaskStatus } from "./contract.js";

export interface BlockerCandidateSortFacts {
  status: TaskStatus;
  projectId: string;
  projectName: string;
  key: string;
}

export const TERMINAL_TASK_STATUSES = ["done", "canceled"] as const;

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.some((terminal) => terminal === status);
}

/** Active tasks always lead terminal tasks; the selected project is favored
 * inside each band, followed by stable project/key ordering. */
export function compareBlockerCandidateFacts(
  left: BlockerCandidateSortFacts,
  right: BlockerCandidateSortFacts,
  currentProjectId: string,
): number {
  const terminalOrder =
    Number(isTerminalTaskStatus(left.status)) -
    Number(isTerminalTaskStatus(right.status));
  if (terminalOrder !== 0) return terminalOrder;
  const projectOrder =
    Number(left.projectId !== currentProjectId) -
    Number(right.projectId !== currentProjectId);
  if (projectOrder !== 0) return projectOrder;
  const projectNameOrder = left.projectName.localeCompare(right.projectName);
  if (projectNameOrder !== 0) return projectNameOrder;
  return left.key.localeCompare(right.key, undefined, { numeric: true });
}
