import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../shared/contract.js";

const mocks = vi.hoisted(() => ({
  fetcher: undefined as ((rpc: unknown) => Promise<unknown>) | undefined,
  load: vi.fn(async () => ({ nodes: new Map(), edges: [] })),
}));

vi.mock("../../shell/data.js", () => ({
  useTasksQuery: (
    fetcher: (rpc: unknown) => Promise<unknown>,
    _channels: unknown,
    _deps: unknown,
  ) => {
    mocks.fetcher = fetcher;
    return {
      data: undefined,
      error: null,
      isLoading: true,
      refresh: () => {},
    };
  },
}));
vi.mock("./loader.js", () => ({
  loadRelationshipGraph: mocks.load,
}));

const { useLocalRelationshipGraph } = await import("./data.js");

const root: Task = {
  id: "root",
  projectId: "project",
  number: 1,
  key: "TSK-1",
  title: "Root",
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  parentTaskId: null,
  position: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  labelIds: [],
  isBlocked: false,
  unresolvedBlockerCount: 0,
};

describe("Local Graph data query", () => {
  it("cannot invoke the loader without the 12-node budget", async () => {
    useLocalRelationshipGraph(root, 2);
    const rpc = { call: vi.fn() };
    await mocks.fetcher?.(rpc);

    expect(mocks.load).toHaveBeenCalledWith(rpc, root, {
      dependencyDepth: 2,
      nodeLimit: 12,
    });
  });
});
