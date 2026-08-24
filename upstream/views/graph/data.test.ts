import { describe, expect, it } from "vitest";
import type { DependencyTask, Project, Task } from "../../shared/contract.js";
import type { TasksRpc } from "../../shell/data.js";
import { loadRelationshipGraph } from "./loader.js";

const project: Project = {
  id: "project",
  name: "Project",
  prefix: "TSK",
  nextTaskNumber: 10,
  color: "cornflowerblue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const task = (
  id: string,
  number: number,
  parentTaskId: string | null,
): Task => ({
  id,
  projectId: project.id,
  number,
  key: `TSK-${number}`,
  title: `Task ${number}`,
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  parentTaskId,
  position: number,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  labelIds: [],
  isBlocked: false,
  unresolvedBlockerCount: 0,
});
const root = task("root", 1, null);
const child = task("child", 2, root.id);
const blocker = task("blocker", 3, null);
const frontier = task("frontier", 4, null);
const deepest = task("deepest", 5, null);
const unrelated = task("unrelated", 6, null);
const related = (value: Task): DependencyTask => ({ task: value, project });

function rpcWith(
  dependencies: Record<
    string,
    { blockedBy: DependencyTask[]; blocks: DependencyTask[] } | Error
  >,
): TasksRpc {
  const call = async (method: string, input: Record<string, unknown>) => {
    if (method === "listProjects") return { projects: [project] };
    if (method === "getTask") return { task: null };
    if (method === "listTasks") {
      return input.parentTaskId === root.id
        ? { tasks: [child], nextCursor: null }
        : { tasks: [], nextCursor: null };
    }
    if (method === "listTaskDependencies") {
      const result = dependencies[String(input.taskId)] ?? {
        blockedBy: [],
        blocks: [],
      };
      if (result instanceof Error) throw result;
      return result;
    }
    throw new Error(`Unexpected RPC ${method}`);
  };
  return { call } as unknown as TasksRpc;
}

describe("relationship graph data loader", () => {
  it("loads root and child dependencies, then expands a bounded second hop", async () => {
    const rpc = rpcWith({
      [root.id]: { blockedBy: [related(blocker)], blocks: [] },
      [child.id]: { blockedBy: [], blocks: [] },
      [blocker.id]: { blockedBy: [related(frontier)], blocks: [] },
    });

    const direct = await loadRelationshipGraph(rpc, root, {
      dependencyDepth: 1,
    });
    expect(direct.nodes.has(blocker.id)).toBe(true);
    expect(direct.nodes.has(frontier.id)).toBe(false);

    const expanded = await loadRelationshipGraph(rpc, root, {
      dependencyDepth: 2,
    });
    expect(expanded.nodes.has(frontier.id)).toBe(true);
    expect(
      expanded.edges.some(
        (edge) => edge.source === frontier.id && edge.target === blocker.id,
      ),
    ).toBe(true);
  });

  it("recursively loads every upstream blocker without unrelated downstream branches", async () => {
    const graph = await loadRelationshipGraph(
      rpcWith({
        [root.id]: {
          blockedBy: [related(blocker)],
          blocks: [related(unrelated)],
        },
        [blocker.id]: {
          blockedBy: [related(frontier)],
          blocks: [related(unrelated)],
        },
        [frontier.id]: {
          blockedBy: [related(deepest)],
          blocks: [],
        },
        [deepest.id]: { blockedBy: [], blocks: [] },
      }),
      root,
      { dependencyDepth: "all-blockers" },
    );

    expect([...graph.nodes.keys()]).toEqual(
      expect.arrayContaining([root.id, child.id, blocker.id, frontier.id, deepest.id]),
    );
    expect(graph.nodes.has(unrelated.id)).toBe(false);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: blocker.id, target: root.id }),
        expect.objectContaining({ source: frontier.id, target: blocker.id }),
        expect.objectContaining({ source: deepest.id, target: frontier.id }),
      ]),
    );
  });

  it("preserves hierarchy and successful regions after a dependency RPC error", async () => {
    const graph = await loadRelationshipGraph(
      rpcWith({
        [root.id]: { blockedBy: [related(blocker)], blocks: [] },
        [child.id]: new Error("offline"),
      }),
      root,
      { dependencyDepth: 1 },
    );

    expect(
      graph.edges.some(
        (edge) => edge.kind === "containment" && edge.target === child.id,
      ),
    ).toBe(true);
    expect(graph.nodes.has(blocker.id)).toBe(true);
    expect(graph.errors.join(" ")).toContain("TSK-2: offline");
  });

  it("preserves root dependencies when a hierarchy RPC fails", async () => {
    const rpc = {
      call: async (method: string, input: Record<string, unknown>) => {
        if (method === "listProjects") return { projects: [project] };
        if (method === "getTask") return { task: null };
        if (method === "listTasks") throw new Error("subtasks offline");
        if (method === "listTaskDependencies") {
          return String(input.taskId) === root.id
            ? { blockedBy: [related(blocker)], blocks: [] }
            : { blockedBy: [], blocks: [] };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    } as unknown as TasksRpc;

    const graph = await loadRelationshipGraph(rpc, root, {
      dependencyDepth: 1,
    });

    expect(graph.nodes.has(blocker.id)).toBe(true);
    expect(graph.errors.join(" ")).toContain("Could not load subtasks");
  });

  it("caps Atlas nodes and dependency RPCs at its explicit safety limit", async () => {
    const children = Array.from({ length: 30 }, (_, index) =>
      task(`child-${index}`, index + 10, root.id),
    );
    let dependencyRequests = 0;
    const rpc = {
      call: async (method: string) => {
        if (method === "listProjects") return { projects: [project] };
        if (method === "getTask") return { task: null };
        if (method === "listTasks") {
          return { tasks: children, nextCursor: null };
        }
        if (method === "listTaskDependencies") {
          dependencyRequests += 1;
          return { blockedBy: [], blocks: [] };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    } as unknown as TasksRpc;

    const graph = await loadRelationshipGraph(rpc, root, {
      dependencyDepth: 1,
      nodeLimit: 12,
    });

    expect(graph.nodes.size).toBe(12);
    expect(dependencyRequests).toBeLessThanOrEqual(12);
    expect(graph.omittedNodeCount).toBe(19);
  });

  it("loads every local node when no Atlas safety limit is requested", async () => {
    const children = Array.from({ length: 30 }, (_, index) =>
      task(`local-child-${index}`, index + 50, root.id),
    );
    const rpc = {
      call: async (method: string) => {
        if (method === "listProjects") return { projects: [project] };
        if (method === "getTask") return { task: null };
        if (method === "listTasks") return { tasks: children, nextCursor: null };
        if (method === "listTaskDependencies") {
          return { blockedBy: [], blocks: [] };
        }
        throw new Error(`Unexpected RPC ${method}`);
      },
    } as unknown as TasksRpc;

    const graph = await loadRelationshipGraph(rpc, root, {
      dependencyDepth: 1,
    });

    expect(graph.nodes.size).toBe(31);
    expect(graph.omittedNodeCount).toBe(0);
    expect(graph.warnings.join(" ")).not.toContain("safety limit");
  });

  it("reports exact bounded dependency omissions instead of truncating silently", async () => {
    const graph = await loadRelationshipGraph(
      rpcWith({
        [root.id]: { blockedBy: [related(blocker)], blocks: [] },
      }),
      root,
      { dependencyDepth: 1, nodeLimit: 2 },
    );

    expect(graph.nodes.has(blocker.id)).toBe(false);
    expect(graph.omittedNodeCount).toBe(1);
    expect(graph.omittedEdgeCount).toBe(1);
    expect(graph.warnings.join(" ")).toContain(
      "outside the 2-node Atlas safety limit",
    );
  });
});
