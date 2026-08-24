import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../../shared/contract.js";
import { buildRelationshipGraph } from "./model.js";
import {
  RelationshipGraphControls,
  RelationshipTable,
} from "./relationship-ui.js";

const project: Project = {
  id: "project",
  name: "Project",
  prefix: "TSK",
  nextTaskNumber: 4,
  color: "cornflowerblue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const task = (
  id: string,
  number: number,
  status: Task["status"],
  parentTaskId: string | null,
): Task => ({
  id,
  projectId: project.id,
  number,
  key: `TSK-${number}`,
  title: `Task ${number}`,
  description: "",
  status,
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

describe("relationship graph accessible UI", () => {
  it("renders one native table row per typed graph edge with explicit semantics", () => {
    const root = task("root", 1, "todo", null);
    const child = task("child", 2, "done", root.id);
    const graph = buildRelationshipGraph({
      root: { task: root, project },
      children: [{ task: child, project }],
      dependencies: [
        {
          taskId: root.id,
          blockedBy: [{ task: child, project }],
          blocks: [],
        },
      ],
    });
    render(<RelationshipTable graph={graph} onOpenTask={() => {}} />);

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(graph.edges.length + 1);
    expect(screen.getByText("contains subtask")).toBeTruthy();
    expect(screen.getByText("resolved dependency")).toBeTruthy();
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
  });

  it("keeps one relationship type enabled", () => {
    const onChange = vi.fn();
    render(
      <RelationshipGraphControls
        settings={{
          depth: 1,
          filters: {
            containment: true,
            dependencies: false,
            resolved: true,
          },
        }}
        onChange={onChange}
        onFit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Hierarchy/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText("At least one relationship type must remain visible."),
    ).toBeTruthy();
  });

  it("cycles through direct, two-hop, and all-blocker scopes", () => {
    const onChange = vi.fn();
    const settings = {
      depth: 2 as const,
      filters: {
        containment: true,
        dependencies: true,
        resolved: true,
      },
    };
    const view = render(
      <RelationshipGraphControls
        settings={settings}
        onChange={onChange}
        onFit={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Dependency scope: 2 hops" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      depth: "all-blockers",
    });

    view.rerender(
      <RelationshipGraphControls
        settings={{ ...settings, depth: "all-blockers" }}
        onChange={onChange}
        onFit={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Dependency scope: All blockers" }),
    ).toBeTruthy();
  });

  it("keeps invalid-data notices available when every bad edge is suppressed", () => {
    const root = task("root", 1, "todo", null);
    const graph = buildRelationshipGraph({
      root: { task: root, project },
      children: [],
      dependencies: [
        {
          taskId: root.id,
          blockedBy: [{ task: root, project }],
          blocks: [],
        },
      ],
    });

    render(<RelationshipTable graph={graph} onOpenTask={() => {}} />);

    expect(screen.getByText(/No subtasks or dependencies/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("self-dependency");
  });
});
