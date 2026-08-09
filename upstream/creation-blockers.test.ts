import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createStore, registerHandlers } from "./api/index.js";
import { createTasksStore } from "./db/index.js";
import { tasksRpcContract } from "./shared/contract.js";
import { groupBlockerCandidates } from "./views/manage/blocker-picker-model.js";

function database() {
  return new Database(":memory:");
}

function fakeBb(db: Database.Database) {
  const realtimeSignals: Array<{ channel: string; payload: unknown }> = [];
  const bb = {
    storage: { database: () => db },
    realtime: {
      publish(channel: string, payload: unknown) {
        realtimeSignals.push({ channel, payload });
      },
    },
    sdk: {},
  } as any;
  return { bb, realtimeSignals };
}

function fixture(store: ReturnType<typeof createTasksStore>) {
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
  const currentActive = store.createTask({
    projectId: currentProject.id,
    title: "Current active",
    status: "todo",
  });
  const otherActive = store.createTask({
    projectId: otherProject.id,
    title: "Other active",
    status: "in_progress",
  });
  const currentDone = store.createTask({
    projectId: currentProject.id,
    title: "Current resolved",
    status: "done",
  });
  const otherCanceled = store.createTask({
    projectId: otherProject.id,
    title: "Other canceled",
    status: "canceled",
  });
  return {
    currentProject,
    otherProject,
    currentActive,
    otherActive,
    currentDone,
    otherCanceled,
  };
}

function asDependencyTask(
  store: ReturnType<typeof createTasksStore>,
  task: ReturnType<typeof store.createTask>,
) {
  return {
    task: { ...task, labelIds: [] },
    project: store.getProject(task.projectId)!,
  };
}

describe("creation blocker contract and picker", () => {
  it("defaults creation blockers and validates candidate-search options", () => {
    expect(
      tasksRpcContract.createTask.input.parse({
        projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
        title: "Task",
      }),
    ).toMatchObject({ blockerTaskIds: [], authorName: "You" });
    expect(
      tasksRpcContract.searchBlockerCandidates.input.parse({
        projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
      }),
    ).toEqual({
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
      query: "",
      dependentTaskId: null,
      selectedTaskIds: [],
      limit: 50,
    });
  });

  it("keeps label and blocker ID-array contracts independently named but uniquely constrained", () => {
    const projectId = "01HZZZZZZZZZZZZZZZZZZZZZP1";
    const taskId = "01HZZZZZZZZZZZZZZZZZZZZZT1";
    expect(
      tasksRpcContract.createTask.input.safeParse({
        projectId,
        title: "Duplicate labels",
        labelIds: [taskId, taskId],
      }).success,
    ).toBe(false);
    expect(
      tasksRpcContract.createTask.input.safeParse({
        projectId,
        title: "Duplicate blockers",
        blockerTaskIds: [taskId, taskId],
      }).success,
    ).toBe(false);
    expect(
      tasksRpcContract.searchBlockerCandidates.input.safeParse({
        projectId,
        selectedTaskIds: [taskId, taskId],
      }).success,
    ).toBe(false);
    expect(
      tasksRpcContract.addTaskDependencies.input.safeParse({
        dependentTaskId: taskId,
        blockerTaskIds: [],
      }).success,
    ).toBe(false);
  });

  it("searches keys/titles across projects with project bias and terminal ordering", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const data = fixture(store);
    const descriptionOnly = store.createTask({
      projectId: data.currentProject.id,
      title: "Unrelated title",
      description: "needle only in description",
    });

    const all = store.searchBlockerCandidates({
      projectId: data.currentProject.id,
    });
    expect(all.candidates.map((task) => task.id)).toEqual([
      data.currentActive.id,
      descriptionOnly.id,
      data.otherActive.id,
      data.currentDone.id,
      data.otherCanceled.id,
    ]);
    expect(
      store
        .searchBlockerCandidates({
          projectId: data.currentProject.id,
          query: "OTH-1",
        })
        .candidates.map((task) => task.id),
    ).toEqual([data.otherActive.id]);
    expect(
      store.searchBlockerCandidates({
        projectId: data.currentProject.id,
        query: "needle",
      }).candidates,
    ).toEqual([]);
    db.close();
  });

  it("reconciles controlled selections against durable task state", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const data = fixture(store);

    expect(
      store
        .searchBlockerCandidates({
          projectId: data.currentProject.id,
          selectedTaskIds: [data.otherActive.id],
        })
        .selected.map((task) => task.id),
    ).toEqual([data.otherActive.id]);
    store.deleteTask(data.otherActive.id);
    expect(
      store.searchBlockerCandidates({
        projectId: data.currentProject.id,
        selectedTaskIds: [data.otherActive.id],
      }).selected,
    ).toEqual([]);
    db.close();
  });

  it("excludes self, selected/existing duplicates, and transitive cycle candidates", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const data = fixture(store);
    const dependent = store.createTask({
      projectId: data.currentProject.id,
      title: "Prospective dependent",
    });
    const downstream = store.createTask({
      projectId: data.otherProject.id,
      title: "Depends on prospective dependent",
    });
    const transitiveDownstream = store.createTask({
      projectId: data.otherProject.id,
      title: "Transitively depends on it",
    });
    store.addTaskDependencies(dependent.id, [data.currentActive.id]);
    store.addTaskDependencies(downstream.id, [dependent.id]);
    store.addTaskDependencies(transitiveDownstream.id, [downstream.id]);

    const result = store.searchBlockerCandidates({
      projectId: data.currentProject.id,
      dependentTaskId: dependent.id,
      selectedTaskIds: [data.otherActive.id],
    });
    const ids = result.candidates.map((task) => task.id);
    expect(ids).not.toContain(dependent.id);
    expect(ids).not.toContain(data.currentActive.id);
    expect(ids).not.toContain(data.otherActive.id);
    expect(result.selected.map((task) => task.id)).toEqual([
      data.otherActive.id,
    ]);
    expect(ids).not.toContain(downstream.id);
    expect(ids).not.toContain(transitiveDownstream.id);
    expect(ids).toContain(data.currentDone.id);
    db.close();
  });

  it("groups active options before clearly labeled Done/Canceled project groups", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const data = fixture(store);
    const groups = groupBlockerCandidates(
      [
        asDependencyTask(store, data.otherCanceled),
        asDependencyTask(store, data.currentDone),
        asDependencyTask(store, data.otherActive),
        asDependencyTask(store, data.currentActive),
      ],
      data.currentProject.id,
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Current project · Current project",
      "Other project · Other project",
      "Done / Canceled · Current project · Current project",
      "Done / Canceled · Other project · Other project",
    ]);
    expect(
      groups.flatMap((group) =>
        group.candidates.map((item) => item.task.status),
      ),
    ).toEqual(["todo", "in_progress", "done", "canceled"]);
    db.close();
  });
});

describe("atomic task plus initial dependency creation", () => {
  it("commits the task, labels, cross-project resolved edges, activity, and refreshes together", async () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const data = fixture(store.tasks);
    const label = store.tasks.createLabel({
      projectId: data.currentProject.id,
      name: "Backend",
      color: "purple",
    });
    const handlers = registerHandlers(fake.bb, store);
    const input = tasksRpcContract.createTask.input.parse({
      projectId: data.currentProject.id,
      title: "Created with blockers",
      labelIds: [label.id],
      blockerTaskIds: [data.otherActive.id, data.otherCanceled.id],
      authorName: "Tester",
    });

    const result = await Promise.resolve(handlers.createTask(input));
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
    expect(fake.realtimeSignals).toEqual([
      {
        channel: "tasks:changed",
        payload: { taskId: result.task.id, projectId: data.currentProject.id },
      },
      { channel: "comments:changed", payload: { taskId: result.task.id } },
      {
        channel: "tasks:changed",
        payload: {
          taskId: data.otherActive.id,
          projectId: data.otherProject.id,
        },
      },
      { channel: "comments:changed", payload: { taskId: data.otherActive.id } },
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
    db.close();
  });

  it("rolls back task, label links, numbering, and every edge after candidate invalidation", async () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const data = fixture(store.tasks);
    const label = store.tasks.createLabel({
      projectId: data.currentProject.id,
      name: "Atomic",
      color: "purple",
    });
    const handlers = registerHandlers(fake.bb, store);
    const candidates = await Promise.resolve(
      handlers.searchBlockerCandidates(
        tasksRpcContract.searchBlockerCandidates.input.parse({
          projectId: data.currentProject.id,
          query: data.otherCanceled.key,
        }),
      ),
    );
    expect(candidates.candidates.map((item) => item.task.id)).toEqual([
      data.otherCanceled.id,
    ]);
    const nextNumber = store.tasks.getProject(
      data.currentProject.id,
    )!.nextTaskNumber;
    store.tasks.deleteTask(data.otherCanceled.id);

    const result = await Promise.resolve(
      handlers.createTask(
        tasksRpcContract.createTask.input.parse({
          projectId: data.currentProject.id,
          title: "Must roll back",
          labelIds: [label.id],
          blockerTaskIds: [data.otherActive.id, data.otherCanceled.id],
        }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "dependency_endpoint_not_found",
        message: `Blocker task not found: ${data.otherCanceled.id}`,
      },
    });
    expect(
      store.tasks.listTasks().find((task) => task.title === "Must roll back"),
    ).toBeUndefined();
    expect(store.tasks.getProject(data.currentProject.id)?.nextTaskNumber).toBe(
      nextNumber,
    );
    expect(
      store.tasks.listTaskDependencies(data.otherActive.id).blocks,
    ).toEqual([]);
    expect(fake.realtimeSignals).toEqual([]);
    db.close();
  });
});
