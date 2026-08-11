import { TERMINAL_TASK_STATUSES } from "../shared/blocker-candidates.js";

const terminalValues = TERMINAL_TASK_STATUSES.map(
  (status) => `'${status}'`,
).join(", ");
const terminalPredicate = `CASE WHEN t.status IN (${terminalValues}) THEN 1 ELSE 0 END`;

const commonWhere = `
  (@query = '' OR (
    t.title LIKE @search ESCAPE '\\'
    OR (p.prefix || '-' || t.number) LIKE @search ESCAPE '\\'
  ))
  AND NOT EXISTS (
    SELECT 1 FROM downstream d WHERE d.task_id = t.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies existing
    WHERE existing.dependent_task_id = @dependentTaskId
      AND existing.blocker_task_id = t.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM selected s WHERE s.task_id = t.id
  )`;

function currentProjectPhase(
  name: string,
  phase: number,
  terminal: boolean,
): string {
  return `${name} AS (
    SELECT
      t.*,
      p.prefix AS project_prefix,
      ${phase} AS candidate_phase,
      p.name AS candidate_project_name,
      p.id AS candidate_project_id,
      t.number AS candidate_number,
      t.id AS candidate_id
    FROM tasks t INDEXED BY idx_tasks_blocker_project
    JOIN projects p ON p.id = t.project_id
    WHERE t.project_id = @currentProjectId
      AND ${terminalPredicate} = ${terminal ? 1 : 0}
      AND ${commonWhere}
    ORDER BY t.number, t.id
    LIMIT @candidateLimit
  )`;
}

function otherProjectsPhase(
  name: string,
  phase: number,
  terminal: boolean,
): string {
  return `${name} AS (
    SELECT
      t.*,
      p.prefix AS project_prefix,
      ${phase} AS candidate_phase,
      p.name AS candidate_project_name,
      p.id AS candidate_project_id,
      t.number AS candidate_number,
      t.id AS candidate_id
    FROM projects p INDEXED BY idx_projects_blocker_candidates
    CROSS JOIN tasks t INDEXED BY idx_tasks_blocker_project
    WHERE t.project_id = p.id
      AND p.id <> @currentProjectId
      AND ${terminalPredicate} = ${terminal ? 1 : 0}
      AND ${commonWhere}
    -- The forced task index supplies number/id order within each project. The
    -- bounded outer merge restates the complete order for the returned rows.
    ORDER BY p.name COLLATE NOCASE, p.id
    LIMIT @candidateLimit
  )`;
}

/**
 * Four independently limited phases keep the expensive cross-project merge
 * bounded to at most 4 × candidateLimit rows. Current-project phases walk the
 * task project/status/order index; other-project phases walk projects by name
 * and use indexed task lookups. Recursive graph exclusions stay in SQLite and
 * selected IDs arrive through one JSON parameter rather than N bind slots.
 */
export const SELECTED_BLOCKER_QUERY = `
  WITH RECURSIVE downstream(task_id) AS (
    SELECT @dependentTaskId WHERE @dependentTaskId IS NOT NULL
    UNION
    SELECT dependency.dependent_task_id
    FROM task_dependencies dependency
    JOIN downstream d ON dependency.blocker_task_id = d.task_id
  )
  SELECT t.*, p.prefix AS project_prefix
  FROM json_each(@selectedTaskIdsJson) requested
  JOIN tasks t ON t.id = requested.value
  JOIN projects p ON p.id = t.project_id
  WHERE NOT EXISTS (
    SELECT 1 FROM downstream d WHERE d.task_id = t.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies existing
    WHERE existing.dependent_task_id = @dependentTaskId
      AND existing.blocker_task_id = t.id
  )
  ORDER BY CAST(requested.key AS INTEGER)
`;

export const BLOCKER_CANDIDATE_QUERY = `
  WITH RECURSIVE
  downstream(task_id) AS (
    SELECT @dependentTaskId WHERE @dependentTaskId IS NOT NULL
    UNION
    SELECT dependency.dependent_task_id
    FROM task_dependencies dependency
    JOIN downstream d ON dependency.blocker_task_id = d.task_id
  ),
  selected(task_id) AS (
    SELECT value FROM json_each(@selectedTaskIdsJson)
  ),
  ${currentProjectPhase("current_active", 0, false)},
  ${otherProjectsPhase("other_active", 1, false)},
  ${currentProjectPhase("current_terminal", 2, true)},
  ${otherProjectsPhase("other_terminal", 3, true)}
  SELECT * FROM (
    SELECT * FROM current_active
    UNION ALL
    SELECT * FROM other_active
    UNION ALL
    SELECT * FROM current_terminal
    UNION ALL
    SELECT * FROM other_terminal
  )
  ORDER BY
    candidate_phase,
    candidate_project_name COLLATE NOCASE,
    candidate_project_id,
    candidate_number,
    candidate_id
  LIMIT @candidateLimit
`;

export interface SelectedBlockerQueryParameters {
  dependentTaskId: string | null;
  selectedTaskIdsJson: string;
}

export interface BlockerCandidateQueryParameters
  extends SelectedBlockerQueryParameters {
  currentProjectId: string;
  query: string;
  search: string;
  candidateLimit: number;
}
