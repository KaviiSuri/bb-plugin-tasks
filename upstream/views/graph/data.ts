import type { Task } from "../../shared/contract.js";
import { useTasksQuery, type TasksQuery } from "../../shell/data.js";
import type { RelationshipGraph } from "./model.js";
import { loadRelationshipGraph } from "./loader.js";

export { loadRelationshipGraph } from "./loader.js";

export function useRelationshipGraph(
  root: Task,
  dependencyDepth: 1 | 2,
): TasksQuery<RelationshipGraph> {
  return useTasksQuery(
    (rpc) => loadRelationshipGraph(rpc, root, { dependencyDepth }),
    ["tasks:changed", "projects:changed"],
    [root.id, dependencyDepth],
  );
}
