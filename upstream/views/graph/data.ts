import type { Task } from "../../shared/contract.js";
import { useTasksQuery, type TasksQuery } from "../../shell/data.js";
import type {
  RelationshipGraph,
  RelationshipGraphDepth,
} from "./model.js";
import { loadRelationshipGraph } from "./loader.js";

export { loadRelationshipGraph } from "./loader.js";

export function useRelationshipGraph(
  root: Task,
  dependencyDepth: RelationshipGraphDepth,
  nodeLimit?: number,
): TasksQuery<RelationshipGraph> {
  return useTasksQuery(
    (rpc) => loadRelationshipGraph(rpc, root, { dependencyDepth, nodeLimit }),
    ["tasks:changed", "projects:changed"],
    [root.id, dependencyDepth, nodeLimit],
  );
}

/** Task detail loads its complete local relationship scope. */
export function useLocalRelationshipGraph(
  root: Task,
  dependencyDepth: RelationshipGraphDepth,
): TasksQuery<RelationshipGraph> {
  return useRelationshipGraph(root, dependencyDepth);
}
