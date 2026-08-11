import type { Task } from "../../shared/contract.js";
import { useTasksQuery, type TasksQuery } from "../../shell/data.js";
import { LOCAL_GRAPH_NODE_LIMIT, type RelationshipGraph } from "./model.js";
import { loadRelationshipGraph } from "./loader.js";

export { loadRelationshipGraph } from "./loader.js";

export function useRelationshipGraph(
  root: Task,
  dependencyDepth: 1 | 2,
  nodeLimit?: number,
): TasksQuery<RelationshipGraph> {
  return useTasksQuery(
    (rpc) => loadRelationshipGraph(rpc, root, { dependencyDepth, nodeLimit }),
    ["tasks:changed", "projects:changed"],
    [root.id, dependencyDepth, nodeLimit],
  );
}

/** Task detail always loads the approved bounded Local Graph projection. */
export function useLocalRelationshipGraph(
  root: Task,
  dependencyDepth: 1 | 2,
): TasksQuery<RelationshipGraph> {
  return useRelationshipGraph(root, dependencyDepth, LOCAL_GRAPH_NODE_LIMIT);
}
