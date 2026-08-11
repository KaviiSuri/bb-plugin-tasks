// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const app = await loadPluginApp(() => import("../../app"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: PROJECT_ID,
  number: 1,
  key: "TSK-1",
  title: "Dependent task",
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
const project = {
  id: PROJECT_ID,
  name: "Tasks",
  prefix: "TSK",
  nextTaskNumber: 4,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};
const otherProject = {
  ...project,
  id: "01HZZZZZZZZZZZZZZZZZZZZZP2",
  name: "External",
  prefix: "EXT",
  color: "purple",
};
const candidate = {
  task: {
    ...task,
    id: "01HZZZZZZZZZZZZZZZZZZZZZT2",
    projectId: otherProject.id,
    number: 2,
    key: "EXT-2",
    title: "Eligible cross-project blocker",
  },
  project: otherProject,
};
const existing = {
  ...task,
  id: "01HZZZZZZZZZZZZZZZZZZZZZT3",
  key: "TSK-3",
  title: "Existing blocker",
};
const cycleProducing = {
  ...task,
  id: "01HZZZZZZZZZZZZZZZZZZZZZT4",
  key: "TSK-4",
  title: "Cycle-producing blocker",
};

function rpc(calls: Array<{ method: string; input: unknown }>) {
  return {
    listProjects: () => ({ projects: [project, otherProject] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listTasks: (input: unknown) => {
      calls.push({ method: "list", input });
      return { tasks: [task] };
    },
    listLabels: () => ({ labels: [] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    listAttachments: () => ({ attachments: [] }),
    searchBlockerCandidates: (input: { dependentTaskId?: string | null }) => {
      calls.push({ method: "candidates", input });
      // Mirror the canonical endpoint's authorization boundary: self plus
      // existing and cycle-producing edges never reach the reused picker.
      const excluded = new Set([
        input.dependentTaskId,
        existing.id,
        cycleProducing.id,
      ]);
      const candidates = [
        { task, project },
        { task: existing, project },
        { task: cycleProducing, project },
        candidate,
      ].filter((entry) => !excluded.has(entry.task.id));
      return { candidates, selected: [] };
    },
    addTaskDependencies: (input: unknown) => {
      calls.push({ method: "add", input });
      return { ok: true, dependencies: [] };
    },
    updateTask: () => ({ ok: true, task }),
  };
}

async function openTaskMenu(slot: ReturnType<typeof renderSlot>) {
  fireEvent.click(
    await slot.findByRole("button", { name: "More actions for TSK-1" }),
  );
  await slot.findByRole("menuitem", { name: "Add blocker…" });
}

describe("dependency quick actions", () => {
  it("opens the reused blocker picker from a list row and submits through the canonical mutation", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      { rpc: rpc(calls) },
    );

    await openTaskMenu(slot);
    fireEvent.click(slot.getByRole("menuitem", { name: "Add blocker…" }));
    expect(
      await slot.findByRole("dialog", { name: "Add blocker…" }),
    ).toBeTruthy();
    expect(
      await slot.findByText("Eligible cross-project blocker"),
    ).toBeTruthy();
    expect(await slot.findByText("Other project · External")).toBeTruthy();
    expect(slot.queryByText("Existing blocker")).toBeNull();
    expect(slot.queryByText("Cycle-producing blocker")).toBeNull();
    expect(
      calls.find(({ method }) => method === "candidates")?.input,
    ).toMatchObject({
      projectId: PROJECT_ID,
      dependentTaskId: task.id,
      selectedTaskIds: [],
    });

    fireEvent.click(slot.getByText("Eligible cross-project blocker"));
    await waitFor(() =>
      expect(calls.find(({ method }) => method === "add")?.input).toEqual({
        dependentTaskId: task.id,
        blockerTaskIds: [candidate.task.id],
      }),
    );
    await waitFor(() =>
      expect(slot.queryByRole("dialog", { name: "Add blocker…" })).toBeNull(),
    );

    const listCalls = calls.filter(({ method }) => method === "list").length;
    await slot.emitRealtime("tasks:changed", {
      taskId: task.id,
      projectId: PROJECT_ID,
    });
    await waitFor(() =>
      expect(
        calls.filter(({ method }) => method === "list").length,
      ).toBeGreaterThan(listCalls),
    );
  });

  it("exposes both actions on board cards and navigates to the focused dependency route", async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: `${PROJECT_ID}?view=board` },
      { rpc: rpc(calls) },
    );

    await slot.findByText("Dependent task");
    const boardListCalls = calls.filter(
      ({ method }) => method === "list",
    ).length;
    await slot.emitRealtime("tasks:changed", {
      taskId: task.id,
      projectId: PROJECT_ID,
    });
    await waitFor(() =>
      expect(
        calls.filter(({ method }) => method === "list").length,
      ).toBeGreaterThan(boardListCalls),
    );

    await openTaskMenu(slot);
    const manage = slot.getByRole("menuitem", {
      name: "Manage dependencies…",
    });
    fireEvent.keyDown(manage, { key: "Enter" });
    fireEvent.click(manage);
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "task/TSK-1?focus=dependencies" },
    });
  });

  it("keeps an explicit focusable menu trigger for keyboard and coarse-pointer use", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      { rpc: rpc([]) },
    );
    const trigger = await slot.findByRole("button", {
      name: "More actions for TSK-1",
    });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.className).toContain("pointer-coarse:opacity-100");
    fireEvent.click(trigger);
    expect(
      await slot.findByRole("menuitem", { name: "Add blocker…" }),
    ).toBeTruthy();
  });
});
