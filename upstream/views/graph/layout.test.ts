import { describe, expect, it } from "vitest";
import type { Project, Task } from "../../shared/contract.js";
import { layoutRelationshipGraph } from "./layout.js";
import { buildRelationshipGraph } from "./model.js";

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

describe("ELK relationship layout", () => {
  it("lays out a compound subtask group with finite task positions", async () => {
    const root = task("root", 1, null);
    const child = task("child", 2, root.id);
    const blocker = task("blocker", 3, null);
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

    const layout = await layoutRelationshipGraph(graph);

    expect(layout.group).not.toBeNull();
    expect(layout.group?.width).toBeGreaterThan(0);
    for (const id of [root.id, child.id, blocker.id]) {
      expect(layout.positions.get(id)).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
      expect(Number.isFinite(layout.positions.get(id)?.x)).toBe(true);
      expect(Number.isFinite(layout.positions.get(id)?.y)).toBe(true);
    }
  });
});
