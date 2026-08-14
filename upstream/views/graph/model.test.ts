import { describe, expect, it } from "vitest";
import type { DependencyTask, Project, Task } from "../../shared/contract.js";
import {
  ATLAS_GRAPH_NODE_LIMIT,
  buildRelationshipGraph,
  connectedTaskIds,
  filterRelationshipGraph,
  limitRelationshipGraph,
  type RelationshipGraphNode,
} from "./model.js";

const project = (id: string, prefix: string): Project => ({
  id,
  name: `${prefix} project`,
  prefix,
  nextTaskNumber: 100,
  color: "cornflowerblue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const task = (
  id: string,
  key: string,
  projectId: string,
  status: Task["status"] = "todo",
  parentTaskId: string | null = null,
): Task => ({
  id,
  projectId,
  number: Number(key.split("-")[1] ?? 1),
  key,
  title: key,
  description: "",
  status,
  priority: "none",
  dueDate: null,
  parentTaskId,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  labelIds: [],
  isBlocked: false,
  unresolvedBlockerCount: 0,
});

const localProject = project("project-local", "TSK");
const externalProject = project("project-external", "API");
const node = (
  value: Task,
  valueProject = localProject,
): RelationshipGraphNode => ({
  task: value,
  project: valueProject,
});
const dependencyTask = (
  value: Task,
  valueProject = localProject,
): DependencyTask => ({ task: value, project: valueProject });

function representativeGraph() {
  const root = task("root", "TSK-1", localProject.id);
  const child = task("child", "TSK-2", localProject.id, "in_progress", root.id);
  const doneChild = task(
    "done-child",
    "TSK-3",
    localProject.id,
    "done",
    root.id,
  );
  const external = task("external", "API-4", externalProject.id, "in_progress");
  const downstream = task("downstream", "TSK-5", localProject.id);
  return {
    root,
    child,
    doneChild,
    external,
    downstream,
    graph: buildRelationshipGraph({
      root: node(root),
      children: [node(child), node(doneChild)],
      dependencies: [
        {
          taskId: root.id,
          blockedBy: [],
          blocks: [dependencyTask(downstream)],
        },
        {
          taskId: child.id,
          blockedBy: [dependencyTask(external, externalProject)],
          blocks: [dependencyTask(downstream)],
        },
      ],
    }),
  };
}

describe("relationship graph model", () => {
  it("deduplicates task nodes while retaining containment and dependency edges", () => {
    const { graph, root, child, downstream } = representativeGraph();

    expect(graph.nodes.size).toBe(5);
    expect(graph.nodes.get(child.id)?.task).toBe(child);
    expect(
      graph.edges.find(
        (edge) =>
          edge.kind === "containment" &&
          edge.source === root.id &&
          edge.target === child.id,
      ),
    ).toBeDefined();
    expect(
      graph.edges.find(
        (edge) =>
          edge.kind === "dependency" &&
          edge.source === child.id &&
          edge.target === downstream.id,
      ),
    ).toBeDefined();
  });

  it("keeps completed subtasks but marks dependencies resolved from blocker status", () => {
    const root = task("root", "TSK-1", localProject.id);
    const done = task("done", "TSK-2", localProject.id, "done", root.id);
    const graph = buildRelationshipGraph({
      root: node(root),
      children: [node(done)],
      dependencies: [
        {
          taskId: root.id,
          blockedBy: [dependencyTask(done)],
          blocks: [],
        },
      ],
    });

    expect(
      graph.edges.find((edge) => edge.kind === "containment")?.resolved,
    ).toBe(false);
    expect(
      graph.edges.find((edge) => edge.kind === "dependency")?.resolved,
    ).toBe(true);
  });

  it("labels dependency project boundaries while hierarchy remains local", () => {
    const { graph, external } = representativeGraph();
    expect(
      graph.edges.find(
        (edge) => edge.kind === "dependency" && edge.source === external.id,
      )?.crossProject,
    ).toBe(true);
    expect(
      graph.edges
        .filter((edge) => edge.kind === "containment")
        .every((edge) => !edge.crossProject),
    ).toBe(true);
  });

  it("filters each relationship type with exact endpoint pruning", () => {
    const { graph, doneChild } = representativeGraph();
    const dependenciesOnly = filterRelationshipGraph(graph, {
      containment: false,
      dependencies: true,
      resolved: true,
    });
    expect(
      dependenciesOnly.edges.every((edge) => edge.kind === "dependency"),
    ).toBe(true);
    expect(dependenciesOnly.nodes.has(doneChild.id)).toBe(false);

    const hierarchyOnly = filterRelationshipGraph(graph, {
      containment: true,
      dependencies: false,
      resolved: true,
    });
    expect(
      hierarchyOnly.edges.every((edge) => edge.kind === "containment"),
    ).toBe(true);
    expect(hierarchyOnly.nodes.size).toBe(3);
  });

  it("suppresses malformed self and cyclic dependency records safely", () => {
    const root = task("root", "TSK-1", localProject.id);
    const other = task("other", "TSK-2", localProject.id);
    const graph = buildRelationshipGraph({
      root: node(root),
      children: [],
      dependencies: [
        {
          taskId: root.id,
          blockedBy: [dependencyTask(root), dependencyTask(other)],
          blocks: [],
        },
        {
          taskId: other.id,
          blockedBy: [dependencyTask(root)],
          blocks: [],
        },
      ],
    });

    expect(
      graph.edges.filter((edge) => edge.kind === "dependency"),
    ).toHaveLength(1);
    expect(graph.warnings.join(" ")).toContain("self-dependency");
    expect(graph.warnings.join(" ")).toContain("cyclic dependency");
  });

  it("suppresses cyclic and cross-project containment without relaxing hierarchy invariants", () => {
    const root = task("root", "TSK-1", localProject.id);
    const parent = task("parent", "TSK-2", localProject.id, "todo", root.id);
    const externalChild = task(
      "external-child",
      "API-3",
      externalProject.id,
      "todo",
      root.id,
    );
    const graph = buildRelationshipGraph({
      root: node(root),
      parent: node(parent),
      children: [node(parent), node(externalChild, externalProject)],
      dependencies: [],
    });

    expect(
      graph.edges.filter((edge) => edge.kind === "containment"),
    ).toHaveLength(1);
    expect(graph.warnings.join(" ")).toContain("cyclic containment");
    expect(graph.warnings.join(" ")).toContain("cross-project containment");
  });

  it("limits by root distance and reports omitted graph content", () => {
    const root = task("root", "TSK-1", localProject.id);
    const children = Array.from(
      { length: ATLAS_GRAPH_NODE_LIMIT + 10 },
      (_, index) =>
        node(
          task(
            `child-${index}`,
            `TSK-${index + 2}`,
            localProject.id,
            "todo",
            root.id,
          ),
        ),
    );
    const graph = buildRelationshipGraph({
      root: node(root),
      children,
      dependencies: [],
    });
    const limited = limitRelationshipGraph(graph, ATLAS_GRAPH_NODE_LIMIT);

    expect(limited.graph.nodes.size).toBe(ATLAS_GRAPH_NODE_LIMIT);
    expect(limited.graph.nodes.has(root.id)).toBe(true);
    expect(limited.omittedNodeCount).toBe(11);
    expect(limited.omittedEdgeCount).toBe(11);
  });

  it("preserves upstream omission counts when applying a smaller viewport budget", () => {
    const { graph } = representativeGraph();
    graph.omittedNodeCount = 4;
    graph.omittedEdgeCount = 6;

    const limited = limitRelationshipGraph(graph, 2);

    expect(limited.omittedNodeCount).toBe(7);
    expect(limited.omittedEdgeCount).toBeGreaterThanOrEqual(8);
  });

  it("returns only immediate connected context for focus muting", () => {
    const { graph, child, external, downstream } = representativeGraph();
    expect(connectedTaskIds(graph, child.id)).toEqual(
      new Set([child.id, graph.rootId, external.id, downstream.id]),
    );
  });
});
