import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore, registerTasksApi } from "./api/index.js";
import type { TasksStore } from "./db/index.js";
import { tasksRpcContract } from "./shared/contract.js";

function fixture(store: TasksStore) {
  const currentProject = store.createProject({
    name: "Current project",
    prefix: "CUR",
    color: "blue",
  });
  const otherProject = store.createProject({
    name: "Other project",
    prefix: "OTH",
    color: "green",
  });
  const otherActive = store.createTask({
    projectId: otherProject.id,
    title: "Other active",
    status: "in_progress",
  });
  const otherCanceled = store.createTask({
    projectId: otherProject.id,
    title: "Other canceled",
    status: "canceled",
  });
  return { currentProject, otherProject, otherActive, otherCanceled };
}

describe("atomic task plus initial dependency creation", () => {
  it("commits task, labels, cross-project resolved edges, activity, and refreshes together", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const data = fixture(store.tasks);
    const label = store.tasks.createLabel({
      projectId: data.currentProject.id,
      name: "Backend",
      color: "purple",
    });

    try {
      const result = tasksRpcContract.createTask.output.parse(
        await harness.callRpc("createTask", {
          projectId: data.currentProject.id,
          title: "Created with blockers",
          labelIds: [label.id],
          blockerTaskIds: [data.otherActive.id, data.otherCanceled.id],
          authorName: "Tester",
        }),
      );
      expect(result).toMatchObject({
        ok: true,
        task: { title: "Created with blockers", labelIds: [label.id] },
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(
        store.tasks
          .listTaskDependencies(result.task.id)
          .blockedBy.map((edge) => edge.blockerTaskId),
      ).toEqual([data.otherActive.id, data.otherCanceled.id]);
      expect(
        store.tasks.listComments(result.task.id).map((comment) => comment.body),
      ).toEqual([
        `Blocked by ${data.otherActive.key} added by Tester`,
        `Blocked by ${data.otherCanceled.key} added by Tester`,
      ]);
      expect(store.tasks.listComments(data.otherCanceled.id).at(-1)?.body).toBe(
        `Blocks ${result.task.key} added by Tester`,
      );
      expect(harness.realtimeSignals).toEqual([
        {
          channel: "tasks:changed",
          payload: {
            taskId: result.task.id,
            projectId: data.currentProject.id,
          },
        },
        { channel: "comments:changed", payload: { taskId: result.task.id } },
        {
          channel: "tasks:changed",
          payload: {
            taskId: data.otherActive.id,
            projectId: data.otherProject.id,
          },
        },
        {
          channel: "comments:changed",
          payload: { taskId: data.otherActive.id },
        },
        {
          channel: "tasks:changed",
          payload: {
            taskId: data.otherCanceled.id,
            projectId: data.otherProject.id,
          },
        },
        {
          channel: "comments:changed",
          payload: { taskId: data.otherCanceled.id },
        },
      ]);
    } finally {
      await harness.dispose();
    }
  });

  it("rolls back task, labels, numbering, and every edge after candidate invalidation", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const data = fixture(store.tasks);
    const label = store.tasks.createLabel({
      projectId: data.currentProject.id,
      name: "Atomic",
      color: "purple",
    });

    try {
      const candidates = tasksRpcContract.searchBlockerCandidates.output.parse(
        await harness.callRpc("searchBlockerCandidates", {
          projectId: data.currentProject.id,
          query: data.otherCanceled.key,
        }),
      );
      expect(candidates.candidates.map((item) => item.task.id)).toEqual([
        data.otherCanceled.id,
      ]);
      const nextNumber = store.tasks.getProject(
        data.currentProject.id,
      )!.nextTaskNumber;
      store.tasks.deleteTask(data.otherCanceled.id);

      await expect(
        harness.callRpc("createTask", {
          projectId: data.currentProject.id,
          title: "Must roll back",
          labelIds: [label.id],
          blockerTaskIds: [data.otherActive.id, data.otherCanceled.id],
        }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: "dependency_endpoint_not_found",
          message: `Blocker task not found: ${data.otherCanceled.id}`,
        },
      });
      expect(
        store.tasks.listTasks().find((task) => task.title === "Must roll back"),
      ).toBeUndefined();
      expect(
        store.tasks.getProject(data.currentProject.id)?.nextTaskNumber,
      ).toBe(nextNumber);
      expect(
        store.tasks.listTaskDependencies(data.otherActive.id).blocks,
      ).toEqual([]);
      expect(harness.realtimeSignals).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });
});
