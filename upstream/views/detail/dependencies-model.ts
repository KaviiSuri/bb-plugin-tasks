import type { DependencyTask, Task } from "../../shared/contract.js";

export type DependencyDirection = "blockedBy" | "blocks";

export function dependencyCandidates(
  task: Task,
  allTasks: readonly DependencyTask[],
  blockedBy: readonly DependencyTask[],
  blocks: readonly DependencyTask[],
  direction: DependencyDirection,
): DependencyTask[] {
  const related = new Set(
    (direction === "blockedBy" ? blockedBy : blocks).map((item) => item.task.id),
  );
  return allTasks.filter(
    (candidate) => candidate.task.id !== task.id && !related.has(candidate.task.id),
  );
}

export function dependencyMutationEndpoints(
  taskId: string,
  direction: DependencyDirection,
  candidateTaskId: string,
): { dependentTaskId: string; blockerTaskIds: [string] } {
  return direction === "blockedBy"
    ? { dependentTaskId: taskId, blockerTaskIds: [candidateTaskId] }
    : { dependentTaskId: candidateTaskId, blockerTaskIds: [taskId] };
}
