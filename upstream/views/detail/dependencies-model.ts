import type {
  DependencyCandidates,
  DependencyDirection,
} from "../../shared/contract.js";

export type { DependencyDirection } from "../../shared/contract.js";

/** Select the server-filtered candidates for one reciprocal presentation. */
export function dependencyCandidates(
  candidates: DependencyCandidates,
  direction: DependencyDirection,
) {
  return candidates[direction];
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
