import type { DependencyTask } from "../../shared/contract.js";
import {
  compareBlockerCandidateFacts,
  isTerminalTaskStatus,
} from "../../shared/blocker-candidates.js";

export interface BlockerCandidateGroup {
  key: string;
  label: string;
  candidates: DependencyTask[];
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
  const sorted = [...candidates].sort((left, right) =>
    compareBlockerCandidateFacts(
      {
        status: left.task.status,
        projectId: left.project.id,
        projectName: left.project.name,
        key: left.task.key,
      },
      {
        status: right.task.status,
        projectId: right.project.id,
        projectName: right.project.name,
        key: right.task.key,
      },
      currentProjectId,
    ),
  );

  const groups = new Map<string, BlockerCandidateGroup>();
  for (const candidate of sorted) {
    const terminal = isTerminalTaskStatus(candidate.task.status);
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
