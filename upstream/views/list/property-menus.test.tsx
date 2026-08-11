// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../shared/contract.js";
import {
  isBareKey,
  PRIORITY_MENU_ORDER,
  priorityForShortcut,
  statusForShortcut,
  TaskContextMenu,
  TaskContextMenuButton,
} from "./property-menus.js";

afterEach(cleanup);

describe("PRIORITY_MENU_ORDER", () => {
  it("lists No priority first (0) and covers every priority once", () => {
    expect(PRIORITY_MENU_ORDER[0]).toBe("none");
    expect([...PRIORITY_MENU_ORDER].sort()).toEqual(
      [...TASK_PRIORITIES].sort(),
    );
  });
});

describe("statusForShortcut", () => {
  it("maps 1-based digits to canonical status order", () => {
    expect(statusForShortcut("1")).toBe(TASK_STATUSES[0]);
    expect(statusForShortcut("3")).toBe(TASK_STATUSES[2]);
    expect(statusForShortcut("6")).toBe(TASK_STATUSES[5]);
  });

  it("rejects out-of-range and non-digit keys", () => {
    expect(statusForShortcut("0")).toBeNull();
    expect(statusForShortcut("7")).toBeNull();
    expect(statusForShortcut("s")).toBeNull();
    expect(statusForShortcut("")).toBeNull();
  });
});

describe("priorityForShortcut", () => {
  it("maps 0-based digits to the picker order", () => {
    expect(priorityForShortcut("0")).toBe("none");
    expect(priorityForShortcut("1")).toBe("urgent");
    expect(priorityForShortcut("4")).toBe("low");
  });

  it("rejects out-of-range and non-digit keys", () => {
    expect(priorityForShortcut("5")).toBeNull();
    expect(priorityForShortcut("p")).toBeNull();
  });
});

describe("dependency context actions", () => {
  it("opens from the focusable coarse-pointer affordance and invokes both actions", () => {
    const task = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
      number: 1,
      key: "TSK-1",
      title: "Task",
      description: "",
      status: "todo" as const,
      priority: "none" as const,
      dueDate: null,
      parentTaskId: null,
      position: 1,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      labelIds: [],
      isBlocked: false,
      unresolvedBlockerCount: 0,
    };
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
        <div data-task-context-trigger>
          <TaskContextMenuButton taskKey={task.key} />
        </div>
      </TaskContextMenu>,
    );

    const trigger = view.getByRole("button", {
      name: "More actions for TSK-1",
    });
    expect(trigger.className).toContain("pointer-coarse:opacity-100");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(view.getByRole("menuitem", { name: "Add blocker…" }));
    expect(onAddBlocker).toHaveBeenCalledWith(task);

    fireEvent.click(trigger);
    fireEvent.click(
      view.getByRole("menuitem", { name: "Manage dependencies…" }),
    );
    expect(onManageDependencies).toHaveBeenCalledWith(task);
  });
});

describe("isBareKey", () => {
  const base = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  };
  it("is true only with no modifier held", () => {
    expect(isBareKey(base)).toBe(true);
    expect(isBareKey({ ...base, metaKey: true })).toBe(false);
    expect(isBareKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isBareKey({ ...base, altKey: true })).toBe(false);
    expect(isBareKey({ ...base, shiftKey: true })).toBe(false);
  });
});
