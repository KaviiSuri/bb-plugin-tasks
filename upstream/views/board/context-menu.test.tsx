// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../shared/contract.js";
import {
  TaskContextMenu,
  TaskContextMenuButton,
} from "../list/property-menus.js";
import { TaskCard } from "./index.js";

vi.mock("../../shell/data.js", () => ({
  listAllTasks: vi.fn(),
  useTasksQuery: vi.fn(),
  useTasksRpc: vi.fn(),
}));
vi.mock("../../shell/routes.js", () => ({
  useTasksNavigation: () => ({ go: vi.fn() }),
}));
vi.mock("../manage/index.js", () => ({ NewTaskDialog: () => null }));
vi.mock("../manage/quick-add-blocker-dialog.js", () => ({
  QuickAddBlockerDialog: () => null,
}));
vi.mock("../blocking/badge.js", () => ({ BlockedBadge: () => null }));

const task: Task = {
  id: "01J00000000000000000000001",
  projectId: "01J00000000000000000000002",
  number: 1,
  key: "TSK-1",
  title: "Board task",
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  parentTaskId: null,
  position: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
  isBlocked: false,
  unresolvedBlockerCount: 0,
};
const meta = {
  workingThreads: [],
  attachmentCount: 0,
  subDone: 0,
  subTotal: 0,
};

afterEach(cleanup);

describe("board card context menu trigger seam", () => {
  it("forwards Radix trigger props for right-click and the explicit action button", () => {
    const onAddBlocker = vi.fn();
    const onManageDependencies = vi.fn();
    const view = render(
      <TaskContextMenu
        task={task}
        onEdit={vi.fn()}
        projectLabels={[]}
        onAddBlocker={onAddBlocker}
        onManageDependencies={onManageDependencies}
      >
        <TaskCard
          task={task}
          labelsById={new Map()}
          meta={meta}
          contextMenuButton={<TaskContextMenuButton taskKey={task.key} />}
        />
      </TaskContextMenu>,
    );

    const card = view.getByText("Board task").closest("[data-task-key]");
    expect(card).toBeTruthy();
    fireEvent.contextMenu(card!);
    fireEvent.click(view.getByRole("menuitem", { name: "Add blocker…" }));
    expect(onAddBlocker).toHaveBeenCalledWith(task);

    fireEvent.click(
      view.getByRole("button", { name: "More actions for TSK-1" }),
    );
    fireEvent.click(
      view.getByRole("menuitem", { name: "Manage dependencies…" }),
    );
    expect(onManageDependencies).toHaveBeenCalledWith(task);
  });
});
