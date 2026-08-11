import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../shared/contract.js";
import { TaskCard } from "../board/index.js";
import { TaskRow } from "../list/row.js";

vi.mock("./badge.js", () => ({
  BlockedBadge: ({ task }: { task: Task }) =>
    task.isBlocked ? <span data-testid="blocked-badge">Blocked</span> : null,
}));
vi.mock("../../shell/data.js", () => ({
  listAllTasks: vi.fn(),
  useTasksQuery: vi.fn(),
  useTasksRpc: vi.fn(),
}));
vi.mock("../../shell/routes.js", () => ({
  useTasksNavigation: () => ({ go: vi.fn() }),
}));
vi.mock("../manage/index.js", () => ({ NewTaskDialog: () => null }));
vi.mock("../list/property-menus.js", () => ({
  isBareKey: () => false,
  PriorityEditor: () => <span data-testid="priority" />,
  StatusEditor: () => <span data-testid="status" />,
  TaskContextMenu: ({ children }: { children: ReactNode }) => children,
  TaskContextMenuButton: () => null,
}));

const task: Task = {
  id: "01J00000000000000000000001",
  projectId: "01J00000000000000000000002",
  number: 1,
  key: "BLK-1",
  title: "Blocked task",
  description: "",
  status: "todo",
  priority: "high",
  dueDate: null,
  parentTaskId: null,
  position: 1024,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
  labelIds: [],
  isBlocked: true,
  unresolvedBlockerCount: 1,
};

const meta = {
  workingThreads: [],
  attachmentCount: 0,
  subDone: 0,
  subTotal: 0,
};

describe("blocking badges on task surfaces", () => {
  it("keeps a blocked board card in its underlying status card", () => {
    const board = render(
      <TaskCard task={task} labelsById={new Map()} meta={meta} />,
    );
    expect(board.getByTestId("blocked-badge")).toBeTruthy();
    expect(board.getByText("Blocked task")).toBeTruthy();
    expect(board.getByText("BLK-1")).toBeTruthy();
    board.unmount();
  });

  it("renders the badge in a list row without replacing status controls", () => {
    const row = render(
      <TaskRow
        task={task}
        meta={undefined}
        project={undefined}
        showProject={false}
        labelsById={new Map()}
        projectLabels={[]}
        onEdit={vi.fn()}
        onOpen={vi.fn()}
        onAddBlocker={vi.fn()}
        onManageDependencies={vi.fn()}
        pending={false}
      />,
    );
    expect(row.getByTestId("blocked-badge")).toBeTruthy();
    expect(row.getByTestId("status")).toBeTruthy();
    expect(row.getByText("Blocked task")).toBeTruthy();
  });
});
