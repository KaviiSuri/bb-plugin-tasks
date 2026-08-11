import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../../shared/contract.js";
import { buildRelationshipGraph } from "./model.js";
import { LocalRelationshipGraph } from "./local-graph.js";

vi.mock("./lazy-canvas.js", () => ({
  LazyRelationshipGraphCanvas: ({ graph }: { graph: { edges: unknown[] } }) => (
    <div data-testid="canvas">{graph.edges.length} rendered edges</div>
  ),
}));

const project: Project = {
  id: "project",
  name: "Project",
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

describe("local relationship graph", () => {
  it("renders graph/list counts and executable compact controls", () => {
    const root = task("root", 1, null);
    const child = task("child", 2, root.id);
    const graph = buildRelationshipGraph({
      root: { task: root, project },
      children: [{ task: child, project }],
      dependencies: [],
    });
    const onSettingsChange = vi.fn();
    const onExpand = vi.fn();
    render(
      <LocalRelationshipGraph
        query={{
          data: graph,
          error: null,
          isLoading: false,
          refresh: () => {},
        }}
        settings={{
          depth: 1,
          filters: {
            containment: true,
            dependencies: true,
            resolved: true,
          },
        }}
        onSettingsChange={onSettingsChange}
        onOpenTask={() => {}}
        onExpand={onExpand}
      />,
    );

    expect(screen.getByText("2 tasks · 1 relationships")).toBeTruthy();
    expect(screen.getByTestId("canvas").textContent).toBe("1 rendered edges");
    fireEvent.click(screen.getByRole("button", { name: /Expand/ }));
    expect(onExpand).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Dependency depth: Direct" }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 2 }),
    );
  });

  it("shows the editable-page empty guidance instead of an empty canvas", () => {
    const root = task("root", 1, null);
    const graph = buildRelationshipGraph({
      root: { task: root, project },
      children: [],
      dependencies: [],
    });
    render(
      <LocalRelationshipGraph
        query={{
          data: graph,
          error: null,
          isLoading: false,
          refresh: () => {},
        }}
        settings={{
          depth: 1,
          filters: {
            containment: true,
            dependencies: true,
            resolved: true,
          },
        }}
        onSettingsChange={() => {}}
        onOpenTask={() => {}}
        onExpand={() => {}}
      />,
    );
    expect(screen.getByText(/No subtasks or dependencies yet/)).toBeTruthy();
  });
});
