import type { DependencyTask, TaskStatus } from "../../shared/contract.js";

export interface BlockerCandidateGroup {
  key: string;
  label: string;
  candidates: DependencyTask[];
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "done" || status === "canceled";
}

/**
 * Keep all active options ahead of terminal options, then bias the selected
 * project within each band. Other projects remain distinct so cross-project
 * context is never hidden by a flat search result list.
 */
export function groupBlockerCandidates(
  candidates: readonly DependencyTask[],
  currentProjectId: string,
): BlockerCandidateGroup[] {
  const sorted = [...candidates].sort((left, right) => {
    const terminalOrder =
      Number(isTerminalStatus(left.task.status)) -
      Number(isTerminalStatus(right.task.status));
    if (terminalOrder !== 0) return terminalOrder;
    const projectOrder =
      Number(left.project.id !== currentProjectId) -
      Number(right.project.id !== currentProjectId);
    if (projectOrder !== 0) return projectOrder;
    const projectNameOrder = left.project.name.localeCompare(
      right.project.name,
    );
    if (projectNameOrder !== 0) return projectNameOrder;
    return left.task.key.localeCompare(right.task.key, undefined, {
      numeric: true,
    });
  });

  const groups = new Map<string, BlockerCandidateGroup>();
  for (const candidate of sorted) {
    const terminal = isTerminalStatus(candidate.task.status);
    const currentProject = candidate.project.id === currentProjectId;
    const key = `${terminal ? "terminal" : "active"}:${candidate.project.id}`;
    const context = currentProject
      ? `Current project · ${candidate.project.name}`
      : `Other project · ${candidate.project.name}`;
    const label = terminal ? `Done / Canceled · ${context}` : context;
    const group = groups.get(key) ?? { key, label, candidates: [] };
    group.candidates.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()];
}
