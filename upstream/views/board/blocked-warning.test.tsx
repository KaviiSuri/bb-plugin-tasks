// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../../app"));

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const taskBase = {
  projectId: PROJECT_ID,
  description: "",
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
const blocker = {
  ...taskBase,
  id: "01HZZZZZZZZZZZZZZZZZZZZZB1",
  number: 1,
  key: "TSK-1",
  title: "Direct blocker",
  status: "todo",
};
const blocked = {
  ...taskBase,
  id: "01HZZZZZZZZZZZZZZZZZZZZZT2",
  number: 2,
  key: "TSK-2",
  title: "Blocked work",
  status: "todo",
  position: 2,
  isBlocked: true,
  unresolvedBlockerCount: 1,
};
const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 3,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      const element = this as HTMLElement;
      const status = element.dataset.boardColumn;
      if (status === "todo") {
        return DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 500 });
      }
      if (status === "in_progress") {
        return DOMRect.fromRect({ x: 110, y: 0, width: 100, height: 500 });
      }
      if (element.dataset.taskKey) {
        return DOMRect.fromRect({ x: 0, y: 0, width: 90, height: 40 });
      }
      if (element.className.includes("overflow-x-auto")) {
        return DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 600 });
      }
      return DOMRect.fromRect();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("blocked board move", () => {
  it("warns before committing an In Progress drop and continues explicitly", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: `${PROJECT_ID}?view=board` },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: (input: { activeOnly?: boolean }) => ({
            tasks: input.activeOnly ? [] : [blocker, blocked],
            nextCursor: null,
          }),
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskDependencies: () => ({
            blockedBy: [{ task: blocker, project }],
            blocks: [],
          }),
          boardMove: () => ({
            ok: true,
            task: { ...blocked, status: "in_progress" },
          }),
        },
      },
    );

    const card = await slot.findByText("Blocked work");
    const cardRoot = card.closest('[data-task-key="TSK-2"]')!;
    fireEvent.pointerDown(cardRoot, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 30 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 30 });

    await slot.findByRole("dialog", { name: "Begin blocked work?" });
    expect(slot.getByText(/TSK-2 is blocked by TSK-1/)).toBeTruthy();
    expect(slot.rpcCalls.some((call) => call.method === "boardMove")).toBe(
      false,
    );

    fireEvent.click(slot.getByRole("button", { name: "Continue anyway" }));
    await waitFor(() =>
      expect(
        slot.rpcCalls.some(
          (call) =>
            call.method === "boardMove" &&
            (call.input as { status?: string }).status === "in_progress",
        ),
      ).toBe(true),
    );
  });
});
