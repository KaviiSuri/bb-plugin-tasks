// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}
    observe(_target: Element, _options?: ResizeObserverOptions) {}
    unobserve(_target: Element) {}
    disconnect() {}
  };
}

const app = await loadPluginApp(() => import("../../app"));
afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const OTHER_PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP2";
const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: PROJECT_ID,
  number: 1,
  key: "ONE-1",
  title: "Dependent",
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  parentTaskId: null,
  position: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  labelIds: [],
};
const project = {
  id: PROJECT_ID,
  name: "First project",
  prefix: "ONE",
  nextTaskNumber: 2,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};
const otherProject = {
  ...project,
  id: OTHER_PROJECT_ID,
  name: "Other project",
  prefix: "TWO",
};
const related = {
  task: {
    ...task,
    id: "01HZZZZZZZZZZZZZZZZZZZZZT2",
    projectId: OTHER_PROJECT_ID,
    key: "TWO-1",
    title: "Finished blocker",
    status: "done",
  },
  project: otherProject,
};
const eligible = {
  task: {
    ...task,
    id: "01HZZZZZZZZZZZZZZZZZZZZZT3",
    key: "ONE-2",
    number: 2,
    title: "Eligible blocker",
  },
  project,
};
const cycleProducing = {
  task: {
    ...task,
    id: "01HZZZZZZZZZZZZZZZZZZZZZT4",
    key: "ONE-3",
    number: 3,
    title: "Would create cycle",
  },
  project,
};

function rpc(
  mutations: Array<{ method: string; input: unknown }>,
  reads?: Map<string, number>,
) {
  const read = (name: string) => reads?.set(name, (reads.get(name) ?? 0) + 1);
  return {
    listProjects: () => ({ projects: [project, otherProject] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listTasks: (input: { parentTaskId?: string } | null) => ({
      tasks: input?.parentTaskId
        ? []
        : [task, related.task, eligible.task, cycleProducing.task],
    }),
    getTaskByKey: () => {
      read("detail");
      return { task };
    },
    listLabels: () => ({ labels: [] }),
    listAttachments: () => ({ attachments: [] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    listTaskPullRequests: () => ({
      pullRequests: [],
      unavailableThreadIds: [],
    }),
    listComments: () => {
      read("activity");
      return { comments: [] };
    },
    listBbProjects: () => ({ bbProjects: [] }),
    listTaskDependencies: () => {
      read("dependencies");
      return { blockedBy: [related], blocks: [] };
    },
    // Server-authorized picker candidates deliberately omit cycleProducing.
    listTaskDependencyCandidates: () => ({ blockedBy: [eligible], blocks: [] }),
    addTaskDependencies: (input: unknown) => {
      mutations.push({ method: "add", input });
      return { ok: true, dependencies: [] };
    },
    removeTaskDependencies: (input: unknown) => {
      mutations.push({ method: "remove", input });
      return { ok: true, dependencies: [] };
    },
  };
}

describe("task detail dependencies", () => {
  it("reveals and focuses the dependency section from the canonical focused route", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/ONE-1?focus=dependencies" },
      { rpc: rpc([]) },
    );
    const section = await slot.findByRole("region", { name: "Dependencies" });
    await waitFor(() => expect(document.activeElement).toBe(section));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("refreshes detail, dependencies, and activity from dependency realtime signals", async () => {
    const reads = new Map<string, number>();
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/ONE-1" },
      { rpc: rpc([], reads) },
    );
    await slot.findByRole("region", { name: "Dependencies" });
    await slot.findByText("Activity");
    const before = new Map(reads);

    await slot.emitRealtime("tasks:changed", {
      taskId: task.id,
      projectId: PROJECT_ID,
    });
    await slot.emitRealtime("comments:changed", { taskId: task.id });

    await waitFor(() => {
      expect(reads.get("detail")).toBeGreaterThan(before.get("detail") ?? 0);
      expect(reads.get("dependencies")).toBeGreaterThan(
        before.get("dependencies") ?? 0,
      );
      expect(reads.get("activity")).toBeGreaterThan(
        before.get("activity") ?? 0,
      );
    });
  });

  it("mounts the responsive authoritative section, presents context, filters cycles, mutates, and navigates", async () => {
    const mutations: Array<{ method: string; input: unknown }> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/ONE-1" },
      { rpc: rpc(mutations) },
    );
    const section = await slot.findByRole("region", { name: "Dependencies" });
    expect(within(section).getByText("Blocked by")).toBeTruthy();
    expect(within(section).getByText("Blocks")).toBeTruthy();
    expect(
      await within(section).findByText("Other project · Done"),
    ).toBeTruthy();
    expect(within(section).getByText("Finished blocker").className).toContain(
      "line-through",
    );

    const addSubtask = slot.getByRole("button", { name: "Add sub-task" });
    const activity = await slot.findByText("Activity");
    expect(
      addSubtask.compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      section.compareDocumentPosition(activity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(
      within(section).getByRole("button", { name: "Add blocker" }),
    );
    expect(await slot.findByText("Eligible blocker")).toBeTruthy();
    expect(slot.queryByText("Would create cycle")).toBeNull();
    fireEvent.click(slot.getByText("Eligible blocker"));
    await waitFor(() =>
      expect(mutations[0]).toEqual({
        method: "add",
        input: { dependentTaskId: task.id, blockerTaskIds: [eligible.task.id] },
      }),
    );

    fireEvent.click(within(section).getByText("TWO-1"));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "task/TWO-1" },
    });
    fireEvent.click(
      within(section).getByRole("button", { name: "Remove blocked by TWO-1" }),
    );
    await waitFor(() =>
      expect(mutations.at(-1)).toEqual({
        method: "remove",
        input: { dependentTaskId: task.id, blockerTaskIds: [related.task.id] },
      }),
    );
  });
});
