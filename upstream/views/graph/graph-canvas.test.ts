import { describe, expect, it } from "vitest";
import type { Project, Task } from "../../shared/contract.js";
import { relationshipNodeAriaLabel } from "./graph-canvas.js";
import { buildRelationshipGraph } from "./model.js";

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
  status: Task["status"] = "todo",
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
  parentTaskId: null,
  position: number,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  labelIds: [],
  isBlocked: false,
  unresolvedBlockerCount: 0,
});

describe("relationship graph node accessibility", () => {
  it("names hierarchy and resolved dependency relationships to the root", () => {
    const root = task("root", 1);
    const child = { ...task("child", 2), parentTaskId: root.id };
    const blocker = task("blocker", 3, "done");
    const graph = buildRelationshipGraph({
      root: { task: root, project },
      children: [{ task: child, project }],
      dependencies: [
        {
          taskId: root.id,
          blockedBy: [{ task: blocker, project }],
          blocks: [],
        },
      ],
    });

    expect(relationshipNodeAriaLabel(graph, child.id)).toContain(
      "Subtask of TSK-1",
    );
    expect(relationshipNodeAriaLabel(graph, blocker.id)).toContain(
      "resolved dependency; blocks TSK-1",
    );
    expect(relationshipNodeAriaLabel(graph, root.id)).toContain("Root task");
  });
});
