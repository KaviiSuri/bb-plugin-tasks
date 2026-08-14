import type { Project, Task } from "../../shared/contract.js";
import type { TasksRpc } from "../../shell/data.js";
import { TASKS_PAGE_MAX_LIMIT } from "../../shared/pagination.js";
import {
  ATLAS_GRAPH_NODE_LIMIT,
  buildRelationshipGraph,
  type DependencySnapshot,
  type RelationshipGraph,
  type RelationshipGraphNode,
} from "./model.js";

const DEPENDENCY_FETCH_CONCURRENCY = 8;

async function listChildren(
  rpc: TasksRpc,
  parentTaskId: string,
): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;
  do {
    const page = await rpc.call("listTasks", {
      parentTaskId,
      limit: TASKS_PAGE_MAX_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    tasks.push(...page.tasks);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return tasks;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      const value = values[index];
      if (value === undefined) continue;
      try {
        results[index] = { status: "fulfilled", value: await mapper(value) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return results;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function requireProject(
  projects: ReadonlyMap<string, Project>,
  task: Task,
): Project {
  const project = projects.get(task.projectId);
  if (!project) throw new Error(`Project not found for ${task.key}`);
  return project;
}

export interface LoadRelationshipGraphOptions {
  dependencyDepth: 1 | 2;
  nodeLimit?: number;
}

/** Read hierarchy and dependency RPCs into the shared in-memory projection. */
export async function loadRelationshipGraph(
  rpc: TasksRpc,
  root: Task,
  options: LoadRelationshipGraphOptions,
): Promise<RelationshipGraph> {
  const projectsResult = await rpc.call("listProjects", {});
  const projects = new Map<string, Project>(
    projectsResult.projects.map((entry: Project) => [entry.id, entry]),
  );
  const rootNode: RelationshipGraphNode = {
    task: root,
    project: requireProject(projects, root),
  };
  const [parentResult, childrenResult] = await Promise.allSettled([
    root.parentTaskId
      ? rpc.call("getTask", { taskId: root.parentTaskId })
      : Promise.resolve({ task: null }),
    listChildren(rpc, root.id),
  ]);
  const errors: string[] = [];
  if (parentResult.status === "rejected") {
    errors.push(`Could not load parent task: ${message(parentResult.reason)}`);
  }
  if (childrenResult.status === "rejected") {
    errors.push(`Could not load subtasks: ${message(childrenResult.reason)}`);
  }
  const nodeLimit = Math.max(1, options.nodeLimit ?? ATLAS_GRAPH_NODE_LIMIT);
  const allChildren =
    childrenResult.status === "fulfilled" ? childrenResult.value : [];
  const parentTask =
    parentResult.status === "fulfilled" ? parentResult.value.task : null;
  const known = new Map<string, RelationshipGraphNode>([[root.id, rootNode]]);
  let omittedHierarchyNodeCount = 0;
  let omittedHierarchyEdgeCount = 0;
  const toNode = (entry: Task): RelationshipGraphNode => ({
    task: entry,
    project: requireProject(projects, entry),
  });
  let parentNode: RelationshipGraphNode | null = parentTask
    ? toNode(parentTask)
    : null;
  if (parentNode) {
    if (known.size < nodeLimit) known.set(parentNode.task.id, parentNode);
    else {
      omittedHierarchyNodeCount += 1;
      omittedHierarchyEdgeCount += 1;
      parentNode = null;
    }
  }
  const childNodes: RelationshipGraphNode[] = [];
  for (const child of allChildren) {
    if (known.size >= nodeLimit) {
      omittedHierarchyNodeCount += 1;
      omittedHierarchyEdgeCount += 1;
      continue;
    }
    const childNode = toNode(child);
    known.set(child.id, childNode);
    childNodes.push(childNode);
  }
  // A parent gives containment context for an open subtask, but its unrelated
  // dependency neighborhood is not part of that subtask's direct scope.
  let frontier = [rootNode, ...childNodes];
  const fetched = new Set<string>();
  const dependencies: DependencySnapshot[] = [];
  const omittedDependencyNodeIds = new Set<string>();
  const omittedDependencyEdgeIds = new Set<string>();

  for (let depth = 0; depth < options.dependencyDepth; depth += 1) {
    const batch = frontier
      .filter((entry) => !fetched.has(entry.task.id))
      .slice(0, Math.max(0, nodeLimit - fetched.size));
    frontier = [];
    for (const entry of batch) fetched.add(entry.task.id);
    const results = await mapConcurrent(
      batch,
      DEPENDENCY_FETCH_CONCURRENCY,
      async (entry) => ({
        entry,
        dependencies: await rpc.call("listTaskDependencies", {
          taskId: entry.task.id,
        }),
      }),
    );
    results.forEach((result, index) => {
      const entry = batch[index];
      if (!entry) return;
      if (result.status === "rejected") {
        errors.push(
          `Could not load relationships for ${entry.task.key}: ${message(result.reason)}`,
        );
        return;
      }
      dependencies.push({
        taskId: entry.task.id,
        blockedBy: result.value.dependencies.blockedBy,
        blocks: result.value.dependencies.blocks,
      });
      for (const related of result.value.dependencies.blockedBy) {
        if (known.has(related.task.id)) continue;
        if (known.size >= nodeLimit) {
          omittedDependencyNodeIds.add(related.task.id);
          omittedDependencyEdgeIds.add(
            `dependency:${related.task.id}:${entry.task.id}`,
          );
          continue;
        }
        const relatedNode = { task: related.task, project: related.project };
        known.set(related.task.id, relatedNode);
        frontier.push(relatedNode);
      }
      for (const related of result.value.dependencies.blocks) {
        if (known.has(related.task.id)) continue;
        if (known.size >= nodeLimit) {
          omittedDependencyNodeIds.add(related.task.id);
          omittedDependencyEdgeIds.add(
            `dependency:${entry.task.id}:${related.task.id}`,
          );
          continue;
        }
        const relatedNode = { task: related.task, project: related.project };
        known.set(related.task.id, relatedNode);
        frontier.push(relatedNode);
      }
    });
  }

  const boundedDependencies = dependencies.map((snapshot) => ({
    ...snapshot,
    blockedBy: snapshot.blockedBy.filter((entry) => known.has(entry.task.id)),
    blocks: snapshot.blocks.filter((entry) => known.has(entry.task.id)),
  }));
  const graph = buildRelationshipGraph({
    root: rootNode,
    parent: parentNode,
    children: childNodes,
    dependencies: boundedDependencies,
    errors,
    omittedNodeCount: omittedHierarchyNodeCount + omittedDependencyNodeIds.size,
    omittedEdgeCount: omittedHierarchyEdgeCount + omittedDependencyEdgeIds.size,
  });
  if (graph.omittedNodeCount > 0) {
    graph.warnings.push(
      `${graph.omittedNodeCount} tasks and ${graph.omittedEdgeCount} relationships are outside the ${nodeLimit}-node graph budget.`,
    );
  }
  return graph;
}
