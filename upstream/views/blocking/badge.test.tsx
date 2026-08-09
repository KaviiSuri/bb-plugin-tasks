import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../shared/contract.js";
import { BlockedBadge } from "./badge.js";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  go: vi.fn(),
  invalidate: null as null | (() => void),
}));

vi.mock("../../shell/data.js", () => ({
  useTasksRpc: () => ({ call: mocks.call }),
  useInvalidation: (
    _channels: readonly string[],
    invalidate: () => void,
  ) => {
    mocks.invalidate = invalidate;
  },
}));
vi.mock("../../shell/routes.js", () => ({
  useTasksNavigation: () => ({ go: mocks.go }),
}));

const task: Task = {
  id: "01J00000000000000000000001",
  projectId: "01J00000000000000000000002",
  number: 2,
  key: "BLK-2",
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

afterEach(() => {
  cleanup();
  mocks.call.mockReset();
  mocks.go.mockReset();
  mocks.invalidate = null;
});

const blocker = {
  task: {
    ...task,
    id: "01J00000000000000000000003",
    number: 1,
    key: "DEP-1",
    title: "Ship dependency",
    isBlocked: true,
    unresolvedBlockerCount: 1,
  },
  project: {
    id: task.projectId,
    name: "Dependencies",
    prefix: "DEP",
    nextTaskNumber: 3,
    color: "blue",
    folderId: null,
    linkedBbProjectId: null,
    createdAt: "2026-08-08T00:00:00.000Z",
  },
};

const resolvedBlocker = {
  ...blocker,
  task: {
    ...blocker.task,
    id: "01J00000000000000000000004",
    key: "DEP-2",
    title: "Resolved dependency",
    status: "done" as const,
    isBlocked: false,
    unresolvedBlockerCount: 0,
  },
};

describe("BlockedBadge accessibility", () => {
  it("opens on hover and keyboard focus, then navigates direct unresolved blockers", async () => {
    mocks.call.mockResolvedValue({
      blockedBy: [blocker, resolvedBlocker],
      blocks: [],
    });
    render(<BlockedBadge task={task} />);

    const trigger = screen.getByRole("button", {
      name: "Blocked: 1 unresolved blocker",
    });
    fireEvent.mouseEnter(trigger);

    const card = await screen.findByRole("dialog", {
      name: "Unresolved blockers for BLK-2",
    });
    expect(card).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Direct unresolved blockers" }),
    ).toBeTruthy();
    expect(screen.queryByText("Resolved dependency")).toBeNull();
    expect(screen.getByLabelText("DEP-1 is also blocked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /DEP-1/ }));
    expect(mocks.go).toHaveBeenCalledWith({ kind: "task", taskKey: "DEP-1" });

    fireEvent.focus(trigger);
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("true"),
    );
  });

  it("opens the blocker card when clicked", async () => {
    mocks.call.mockResolvedValue({ blockedBy: [blocker], blocks: [] });
    render(<BlockedBadge task={task} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Blocked: 1 unresolved blocker" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Unresolved blockers for BLK-2",
      }),
    ).toBeTruthy();
  });

  it("refreshes cached blocker details after task or project invalidation", async () => {
    mocks.call
      .mockResolvedValueOnce({ blockedBy: [blocker], blocks: [] })
      .mockResolvedValueOnce({
        blockedBy: [
          {
            ...blocker,
            task: {
              ...blocker.task,
              title: "Renamed dependency",
              isBlocked: false,
              unresolvedBlockerCount: 0,
            },
            project: { ...blocker.project, name: "Renamed project" },
          },
        ],
        blocks: [],
      });
    render(<BlockedBadge task={task} />);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Blocked: 1 unresolved blocker" }),
    );
    await screen.findByText("Ship dependency");

    act(() => mocks.invalidate?.());

    expect(await screen.findByText("Renamed dependency")).toBeTruthy();
    expect(screen.getByText("Renamed project")).toBeTruthy();
    expect(screen.queryByLabelText("DEP-1 is also blocked")).toBeNull();
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });

  it("does not render for terminal or unblocked summaries", () => {
    const { container } = render(
      <BlockedBadge
        task={{ ...task, isBlocked: false, unresolvedBlockerCount: 0 }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
