import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../../shared/contract.js";
import { buildRelationshipGraph } from "./model.js";

const go = vi.fn();
const refresh = vi.fn();
const project: Project = {
  id: "project",
  name: "Tasks",
  prefix: "TSK",
  nextTaskNumber: 3,
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
const graph = buildRelationshipGraph({
  root: { task: root, project },
  children: [{ task: child, project }],
  dependencies: [
    {
      taskId: root.id,
      blockedBy: [],
      blocks: [{ task: child, project }],
    },
  ],
});

vi.mock("../../shell/routes.js", () => ({
  useTasksNavigation: () => ({ go }),
}));
vi.mock("../../shell/data.js", () => ({
  useTasksQuery: vi.fn(),
}));
let graphQuery = {
  data: graph,
  error: null as string | null,
  isLoading: false,
  refresh,
};
vi.mock("./data.js", () => ({
  useRelationshipGraph: () => graphQuery,
}));
vi.mock("./lazy-canvas.js", () => ({
  LazyRelationshipGraphCanvas: ({
    graph: visible,
  }: {
    graph: { edges: unknown[] };
  }) => (
    <div data-testid="atlas-canvas">{visible.edges.length} rendered edges</div>
  ),
}));

const { AtlasContent } = await import("./atlas.js");

afterEach(cleanup);
beforeEach(() => {
  graphQuery = {
    data: graph,
    error: null,
    isLoading: false,
    refresh,
  };
  go.mockClear();
  refresh.mockClear();
});

describe("relationship Atlas", () => {
  it("keeps graph/table parity and writes filter depth into replaceable route state", () => {
    render(
      <AtlasContent
        root={root}
        initialSettings={{
          depth: 1,
          filters: {
            containment: true,
            dependencies: true,
            resolved: true,
          },
        }}
      />,
    );

    expect(screen.getByTestId("atlas-canvas").textContent).toBe(
      `${graph.edges.length} rendered edges`,
    );
    const relationshipsTab = screen.getByRole("tab", {
      name: "Relationships / Hierarchy",
    });
    fireEvent.mouseDown(relationshipsTab, { button: 0, ctrlKey: false });
    fireEvent.click(relationshipsTab);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      graph.edges.length + 1,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Dependency scope: Direct" }),
    );
    expect(go).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "graph", taskKey: root.key, depth: 2 }),
      { replace: true },
    );
  });

  it("exposes a retryable refresh failure without hiding stale Atlas data", () => {
    graphQuery = { ...graphQuery, error: "refresh offline" };
    render(
      <AtlasContent
        root={root}
        initialSettings={{
          depth: 1,
          filters: {
            containment: true,
            dependencies: true,
            resolved: true,
          },
        }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Showing previously loaded relationships",
    );
    expect(screen.getByTestId("atlas-canvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
  });
});
