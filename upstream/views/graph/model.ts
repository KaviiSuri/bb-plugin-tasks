import type { DependencyTask, Project, Task } from "../../shared/contract.js";

export type RelationshipKind = "containment" | "dependency";

export interface RelationshipGraphNode {
  task: Task;
  project: Project;
}

export interface RelationshipGraphEdge {
  id: string;
  kind: RelationshipKind;
  source: string;
  target: string;
  resolved: boolean;
  crossProject: boolean;
}

export interface RelationshipGraph {
  rootId: string;
  nodes: Map<string, RelationshipGraphNode>;
  edges: RelationshipGraphEdge[];
  warnings: string[];
  errors: string[];
  /** Nodes/edges known to exist beyond the bounded RPC projection. */
  omittedNodeCount: number;
  omittedEdgeCount: number;
}

export interface DependencySnapshot {
  taskId: string;
  blockedBy: DependencyTask[];
  blocks: DependencyTask[];
}

export interface BuildRelationshipGraphInput {
  root: RelationshipGraphNode;
  parent?: RelationshipGraphNode | null;
  children: RelationshipGraphNode[];
  dependencies: DependencySnapshot[];
  errors?: string[];
  omittedNodeCount?: number;
  omittedEdgeCount?: number;
}

export interface RelationshipGraphFilters {
  containment: boolean;
  dependencies: boolean;
  resolved: boolean;
}

export interface LimitedRelationshipGraph {
  graph: RelationshipGraph;
  omittedNodeCount: number;
  omittedEdgeCount: number;
}

export const DEFAULT_GRAPH_FILTERS: RelationshipGraphFilters = {
  containment: true,
  dependencies: true,
  resolved: true,
};

export const LOCAL_GRAPH_NODE_LIMIT = 12;
export const ATLAS_GRAPH_WARNING_LIMIT = 75;
export const ATLAS_GRAPH_NODE_LIMIT = 150;

function terminal(task: Task): boolean {
  return task.status === "done" || task.status === "canceled";
}

function dependencyEdgeId(source: string, target: string): string {
  return `dependency:${source}:${target}`;
}

function containmentEdgeId(source: string, target: string): string {
  return `containment:${source}:${target}`;
}

function hasPath(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
  wanted: string,
): boolean {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current === wanted) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return false;
}

/**
 * Merge hierarchy and dependency RPC data into one ephemeral projection.
 * Task ids are the sole node identity; separately typed edges remain distinct.
 */
export function buildRelationshipGraph(
  input: BuildRelationshipGraphInput,
): RelationshipGraph {
  const nodes = new Map<string, RelationshipGraphNode>([
    [input.root.task.id, input.root],
  ]);
  const warnings: string[] = [];
  const errors = [...(input.errors ?? [])];
  const edges: RelationshipGraphEdge[] = [];
  const edgeIds = new Set<string>();
  const containmentAdjacency = new Map<string, Set<string>>();

  const addNode = (node: RelationshipGraphNode) =>
    nodes.set(node.task.id, node);
  const addContainment = (
    parent: RelationshipGraphNode,
    child: RelationshipGraphNode,
  ) => {
    addNode(parent);
    addNode(child);
    if (parent.task.id === child.task.id) {
      warnings.push(`Ignored self-containment for ${parent.task.key}.`);
      return;
    }
    if (parent.task.projectId !== child.task.projectId) {
      warnings.push(
        `Ignored invalid cross-project containment ${parent.task.key} → ${child.task.key}.`,
      );
      return;
    }
    const id = containmentEdgeId(parent.task.id, child.task.id);
    if (edgeIds.has(id)) return;
    if (hasPath(containmentAdjacency, child.task.id, parent.task.id)) {
      warnings.push(
        `Ignored invalid cyclic containment ${parent.task.key} → ${child.task.key}.`,
      );
      return;
    }
    const outgoing = containmentAdjacency.get(parent.task.id) ?? new Set();
    outgoing.add(child.task.id);
    containmentAdjacency.set(parent.task.id, outgoing);
    edgeIds.add(id);
    edges.push({
      id,
      kind: "containment",
      source: parent.task.id,
      target: child.task.id,
      resolved: false,
      crossProject: false,
    });
  };

  if (input.parent) addContainment(input.parent, input.root);
  for (const child of input.children) addContainment(input.root, child);

  const dependencyAdjacency = new Map<string, Set<string>>();
  const addDependency = (
    blocker: RelationshipGraphNode,
    dependent: RelationshipGraphNode,
  ) => {
    addNode(blocker);
    addNode(dependent);
    if (blocker.task.id === dependent.task.id) {
      warnings.push(`Ignored self-dependency for ${blocker.task.key}.`);
      return;
    }
    const id = dependencyEdgeId(blocker.task.id, dependent.task.id);
    if (edgeIds.has(id)) return;
    if (hasPath(dependencyAdjacency, dependent.task.id, blocker.task.id)) {
      warnings.push(
        `Ignored invalid cyclic dependency ${blocker.task.key} → ${dependent.task.key}.`,
      );
      return;
    }
    const outgoing = dependencyAdjacency.get(blocker.task.id) ?? new Set();
    outgoing.add(dependent.task.id);
    dependencyAdjacency.set(blocker.task.id, outgoing);
    edgeIds.add(id);
    edges.push({
      id,
      kind: "dependency",
      source: blocker.task.id,
      target: dependent.task.id,
      resolved: terminal(blocker.task),
      crossProject: blocker.task.projectId !== dependent.task.projectId,
    });
  };

  for (const snapshot of input.dependencies) {
    const current = nodes.get(snapshot.taskId);
    if (!current) {
      warnings.push(
        `Ignored dependencies for missing task ${snapshot.taskId}.`,
      );
      continue;
    }
    for (const blocker of snapshot.blockedBy) {
      addDependency({ task: blocker.task, project: blocker.project }, current);
    }
    for (const dependent of snapshot.blocks) {
      addDependency(current, {
        task: dependent.task,
        project: dependent.project,
      });
    }
  }

  return {
    rootId: input.root.task.id,
    nodes,
    edges,
    warnings,
    errors,
    omittedNodeCount: input.omittedNodeCount ?? 0,
    omittedEdgeCount: input.omittedEdgeCount ?? 0,
  };
}

export function filterRelationshipGraph(
  graph: RelationshipGraph,
  filters: RelationshipGraphFilters,
): RelationshipGraph {
  const edges = graph.edges.filter((edge) => {
    if (edge.kind === "containment") return filters.containment;
    return filters.dependencies && (filters.resolved || !edge.resolved);
  });
  const nodeIds = new Set([graph.rootId]);
  for (const edge of edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return {
    ...graph,
    nodes: new Map([...graph.nodes].filter(([taskId]) => nodeIds.has(taskId))),
    edges,
  };
}

function distancesFromRoot(graph: RelationshipGraph): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const source = adjacency.get(edge.source) ?? new Set<string>();
    source.add(edge.target);
    adjacency.set(edge.source, source);
    const target = adjacency.get(edge.target) ?? new Set<string>();
    target.add(edge.source);
    adjacency.set(edge.target, target);
  }
  const distances = new Map([[graph.rootId, 0]]);
  const pending = [graph.rootId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    const distance = distances.get(current) ?? 0;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distance + 1);
      pending.push(neighbor);
    }
  }
  return distances;
}

/** Keep the root and nearest task nodes, with deterministic key tie-breaking. */
export function limitRelationshipGraph(
  graph: RelationshipGraph,
  maxNodes: number,
): LimitedRelationshipGraph {
  if (graph.nodes.size <= maxNodes) {
    return {
      graph,
      omittedNodeCount: graph.omittedNodeCount,
      omittedEdgeCount: graph.omittedEdgeCount,
    };
  }
  const distances = distancesFromRoot(graph);
  const keptIds = new Set(
    [...graph.nodes]
      .sort(([, a], [, b]) => {
        const distance =
          (distances.get(a.task.id) ?? Number.MAX_SAFE_INTEGER) -
          (distances.get(b.task.id) ?? Number.MAX_SAFE_INTEGER);
        return distance || a.task.key.localeCompare(b.task.key);
      })
      .slice(0, maxNodes)
      .map(([taskId]) => taskId),
  );
  keptIds.add(graph.rootId);
  const edges = graph.edges.filter(
    (edge) => keptIds.has(edge.source) && keptIds.has(edge.target),
  );
  return {
    graph: {
      ...graph,
      nodes: new Map(
        [...graph.nodes].filter(([taskId]) => keptIds.has(taskId)),
      ),
      edges,
    },
    omittedNodeCount: graph.omittedNodeCount + graph.nodes.size - keptIds.size,
    omittedEdgeCount:
      graph.omittedEdgeCount + graph.edges.length - edges.length,
  };
}

export function connectedTaskIds(
  graph: RelationshipGraph,
  selectedTaskId: string,
): Set<string> {
  const connected = new Set([selectedTaskId]);
  for (const edge of graph.edges) {
    if (edge.source === selectedTaskId) connected.add(edge.target);
    if (edge.target === selectedTaskId) connected.add(edge.source);
  }
  return connected;
}
