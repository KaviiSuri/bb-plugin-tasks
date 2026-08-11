import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore, registerTasksApi } from "./api/index.js";
import {
  createTasksStore,
  TaskDependencyError,
  type TasksStore,
} from "./db/index.js";
import plugin from "./server.js";
import { tasksRpcContract } from "./shared/contract.js";

function projectAndTasks(store: TasksStore) {
  const firstProject = store.createProject({
    name: "First project",
    prefix: "ONE",
    color: "blue",
  });
  const secondProject = store.createProject({
    name: "Second project",
    prefix: "TWO",
    color: "green",
  });
  const dependent = store.createTask({
    projectId: firstProject.id,
    title: "Dependent",
  });
  const blocker = store.createTask({
    projectId: secondProject.id,
    title: "Resolved blocker",
    status: "done",
  });
  const third = store.createTask({
    projectId: firstProject.id,
    title: "Third",
    status: "canceled",
  });
  return { firstProject, secondProject, dependent, blocker, third };
}

function deletionTestHarness() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = createStore(bb);
  registerTasksApi(bb, store);
  return { db: bb.storage.database(), harness, store };
}

describe("task dependency storage", () => {
  it("migrates real SQLite with reciprocal indexes and cascading endpoints", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const db = bb.storage.database();
    const store = createTasksStore(db);
    const { dependent, blocker } = projectAndTasks(store);

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM schema_version").get(),
    ).toEqual({ count: 9 });
    const indexes = db
      .prepare<[], { name: string }>("PRAGMA index_list('task_dependencies')")
      .all()
      .map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_task_dependencies_dependent",
        "idx_task_dependencies_blocker",
      ]),
    );
    store.addTaskDependencies(dependent.id, [blocker.id]);
    store.deleteTask(blocker.id);
    expect(store.listTaskDependencies(dependent.id).blockedBy).toEqual([]);
    await harness.dispose();
  });

  it("enforces atomic batches and every graph invariant, including resolved cycles", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createTasksStore(bb.storage.database());
    const { dependent, blocker, third, firstProject } = projectAndTasks(store);
    const unrelated = store.createTask({
      projectId: firstProject.id,
      title: "Unrelated",
    });

    expect(() =>
      store.addTaskDependencies(dependent.id, [dependent.id]),
    ).toThrow(
      expect.objectContaining<TaskDependencyError>({
        code: "dependency_self_link",
      }),
    );
    store.addTaskDependencies(dependent.id, [blocker.id, third.id]);
    expect(() => store.addTaskDependencies(dependent.id, [blocker.id])).toThrow(
      expect.objectContaining({ code: "dependency_duplicate" }),
    );
    expect(() =>
      store.removeTaskDependencies(dependent.id, [blocker.id, unrelated.id]),
    ).toThrow(expect.objectContaining({ code: "dependency_not_found" }));
    expect(store.listTaskDependencies(dependent.id).blockedBy).toHaveLength(2);
    expect(() =>
      store.addTaskDependencies(dependent.id, ["01J00000000000000000000000"]),
    ).toThrow(
      expect.objectContaining({ code: "dependency_endpoint_not_found" }),
    );

    store.addTaskDependencies(blocker.id, [unrelated.id]);
    expect(() =>
      store.addTaskDependencies(unrelated.id, [dependent.id]),
    ).toThrow(expect.objectContaining({ code: "dependency_cycle" }));
    expect(store.listTaskDependencies(unrelated.id).blockedBy).toEqual([]);
    await harness.dispose();
  });
});

describe("task dependency contract and RPC", () => {
  it("projects reciprocal key/id context, activity, signals, and cycle-safe candidates", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const { dependent, blocker, third, secondProject } = projectAndTasks(
      store.tasks,
    );

    const added = tasksRpcContract.addTaskDependencies.output.parse(
      await harness.callRpc("addTaskDependencies", {
        dependentTaskId: dependent.id,
        blockerTaskIds: [blocker.id],
        authorName: "Tester",
      }),
    );
    expect(added).toMatchObject({
      ok: true,
      dependencies: [
        { dependentTaskId: dependent.id, blockerTaskId: blocker.id },
      ],
    });
    const reciprocal = tasksRpcContract.listTaskDependencies.output.parse(
      await harness.callRpc("listTaskDependencies", { taskId: blocker.id }),
    );
    expect(reciprocal.blocks).toMatchObject([
      {
        task: { id: dependent.id, key: "ONE-1" },
        project: { id: dependent.projectId },
      },
    ]);
    const forward = await harness.callRpc("listTaskDependencies", {
      taskId: dependent.id,
    });
    expect(forward.blockedBy).toMatchObject([
      {
        task: { id: blocker.id, key: "TWO-1", status: "done" },
        project: { id: secondProject.id, name: "Second project" },
      },
    ]);
    expect(store.tasks.listComments(dependent.id).at(-1)?.body).toBe(
      "Blocked by TWO-1 added by Tester",
    );
    expect(store.tasks.listComments(blocker.id).at(-1)?.body).toBe(
      "Blocks ONE-1 added by Tester",
    );
    expect(harness.realtimeSignals.slice(-4)).toEqual([
      {
        channel: "tasks:changed",
        payload: { taskId: dependent.id, projectId: dependent.projectId },
      },
      { channel: "comments:changed", payload: { taskId: dependent.id } },
      {
        channel: "tasks:changed",
        payload: { taskId: blocker.id, projectId: blocker.projectId },
      },
      { channel: "comments:changed", payload: { taskId: blocker.id } },
    ]);

    await harness.callRpc("addTaskDependencies", {
      dependentTaskId: blocker.id,
      blockerTaskIds: [third.id],
    });
    const candidates =
      tasksRpcContract.listTaskDependencyCandidates.output.parse(
        await harness.callRpc("listTaskDependencyCandidates", {
          taskId: third.id,
        }),
      );
    expect(candidates.blockedBy.map(({ task }) => task.id)).not.toContain(
      dependent.id,
    );

    await expect(
      harness.callRpc("removeTaskDependencies", {
        dependentTaskId: dependent.id,
        blockerTaskIds: [blocker.id],
        authorName: "Tester",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(store.tasks.listComments(blocker.id).at(-1)?.body).toBe(
      "Blocks ONE-1 removed by Tester",
    );
    await harness.dispose();
  });
});

describe("dependency cleanup during deletion", () => {
  it("deletes every incident edge and records directional activity on task survivors", async () => {
    const { db, harness, store } = deletionTestHarness();
    const { dependent, blocker, third } = projectAndTasks(store.tasks);
    store.tasks.addTaskDependencies(dependent.id, [blocker.id]);
    store.tasks.addTaskDependencies(third.id, [dependent.id]);

    await expect(
      harness.callRpc("deleteTask", { taskId: dependent.id }),
    ).resolves.toEqual({
      deleted: true,
    });

    expect(store.tasks.getTask(dependent.id)).toBeUndefined();
    expect(store.tasks.listTaskDependencies(blocker.id).blocks).toEqual([]);
    expect(store.tasks.listTaskDependencies(third.id).blockedBy).toEqual([]);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM task_dependencies").get(),
    ).toEqual({ count: 0 });
    expect(store.tasks.listComments(blocker.id).at(-1)).toMatchObject({
      kind: "system",
      authorName: "Tasks",
      body: `Blocks ${dependent.key} removed because ${dependent.key} was deleted`,
    });
    expect(store.tasks.listComments(third.id).at(-1)?.body).toBe(
      `Blocked by ${dependent.key} removed because ${dependent.key} was deleted`,
    );
    expect(harness.realtimeSignals).toEqual([
      {
        channel: "tasks:changed",
        payload: { taskId: dependent.id, projectId: dependent.projectId },
      },
      {
        channel: "tasks:changed",
        payload: { taskId: blocker.id, projectId: blocker.projectId },
      },
      { channel: "comments:changed", payload: { taskId: blocker.id } },
      {
        channel: "tasks:changed",
        payload: { taskId: third.id, projectId: third.projectId },
      },
      { channel: "comments:changed", payload: { taskId: third.id } },
    ]);
    await harness.dispose();
  });

  it("force-deletes a project after recording only cross-project survivor activity", async () => {
    const { db, harness, store } = deletionTestHarness();
    const { firstProject, dependent, blocker, third } = projectAndTasks(
      store.tasks,
    );
    const externalDependent = store.tasks.createTask({
      projectId: blocker.projectId,
      title: "External dependent",
    });
    store.tasks.addTaskDependencies(dependent.id, [blocker.id]);
    store.tasks.addTaskDependencies(third.id, [dependent.id]);
    store.tasks.addTaskDependencies(externalDependent.id, [third.id]);
    db.exec(`
      CREATE TRIGGER reject_deleted_project_activity
      BEFORE INSERT ON comments
      WHEN NEW.task_id IN ('${dependent.id}', '${third.id}')
      BEGIN
        SELECT RAISE(ABORT, 'activity written to a cascading task');
      END;
    `);

    await expect(
      harness.callRpc("deleteProject", {
        projectId: firstProject.id,
        force: true,
      }),
    ).resolves.toEqual({ ok: true, deleted: true });

    expect(store.tasks.getProject(firstProject.id)).toBeUndefined();
    expect(store.tasks.getTask(dependent.id)).toBeUndefined();
    expect(store.tasks.getTask(third.id)).toBeUndefined();
    expect(store.tasks.listTaskDependencies(blocker.id).blocks).toEqual([]);
    expect(
      store.tasks.listTaskDependencies(externalDependent.id).blockedBy,
    ).toEqual([]);
    expect(store.tasks.listComments(blocker.id).at(-1)?.body).toBe(
      `Blocks ${dependent.key} removed because ${dependent.key} was deleted`,
    );
    expect(store.tasks.listComments(externalDependent.id).at(-1)?.body).toBe(
      `Blocked by ${third.key} removed because ${third.key} was deleted`,
    );
    expect(harness.realtimeSignals).toEqual([
      {
        channel: "tasks:changed",
        payload: { taskId: blocker.id, projectId: blocker.projectId },
      },
      { channel: "comments:changed", payload: { taskId: blocker.id } },
      {
        channel: "tasks:changed",
        payload: {
          taskId: externalDependent.id,
          projectId: externalDependent.projectId,
        },
      },
      {
        channel: "comments:changed",
        payload: { taskId: externalDependent.id },
      },
      {
        channel: "projects:changed",
        payload: { projectId: firstProject.id },
      },
    ]);
    await harness.dispose();
  });

  it.each([
    { deletionKind: "task", fileName: "task.txt" },
    { deletionKind: "forced-project", fileName: "project.txt" },
  ] as const)(
    "publishes $deletionKind and survivor invalidations when blob cleanup fails after commit",
    async ({ deletionKind, fileName }) => {
      const { harness, store } = deletionTestHarness();
      const { firstProject, dependent, blocker } = projectAndTasks(store.tasks);
      store.tasks.addTaskDependencies(dependent.id, [blocker.id]);
      store.tasks.createAttachment({
        taskId: dependent.id,
        fileName,
        mime: "text/plain",
        sizeBytes: 1,
        blobPath: `blobs/${deletionKind}/${fileName}`,
        isImage: false,
      });

      const deletion =
        deletionKind === "task"
          ? harness.callRpc("deleteTask", { taskId: dependent.id })
          : harness.callRpc("deleteProject", {
              projectId: firstProject.id,
              force: true,
            });
      await expect(deletion).rejects.toThrow("registerAttachments");

      expect(store.tasks.getTask(dependent.id)).toBeUndefined();
      const remainingProject = store.tasks.getProject(firstProject.id);
      if (deletionKind === "task") {
        expect(remainingProject).toMatchObject({ id: firstProject.id });
      } else {
        expect(remainingProject).toBeUndefined();
      }
      expect(store.tasks.listTaskDependencies(blocker.id).blocks).toEqual([]);
      expect(store.tasks.listComments(blocker.id)).toHaveLength(1);
      const survivorSignals = [
        {
          channel: "tasks:changed",
          payload: { taskId: blocker.id, projectId: blocker.projectId },
        },
        { channel: "comments:changed", payload: { taskId: blocker.id } },
      ];
      expect(harness.realtimeSignals).toEqual(
        deletionKind === "task"
          ? [
              {
                channel: "tasks:changed",
                payload: {
                  taskId: dependent.id,
                  projectId: dependent.projectId,
                },
              },
              ...survivorSignals,
            ]
          : [
              ...survivorSignals,
              {
                channel: "projects:changed",
                payload: { projectId: firstProject.id },
              },
            ],
      );
      await harness.dispose();
    },
  );

  it.each(["task", "project"] as const)(
    "rolls survivor activity and edges back when %s deletion fails",
    async (deletionKind) => {
      const { db, harness, store } = deletionTestHarness();
      const { firstProject, dependent, blocker } = projectAndTasks(store.tasks);
      store.tasks.addTaskDependencies(dependent.id, [blocker.id]);
      const table = deletionKind === "task" ? "tasks" : "projects";
      const id = deletionKind === "task" ? dependent.id : firstProject.id;
      db.exec(`
        CREATE TRIGGER reject_dependency_${deletionKind}_delete
        BEFORE DELETE ON ${table}
        WHEN OLD.id = '${id}'
        BEGIN
          SELECT RAISE(ABORT, 'injected ${deletionKind} deletion failure');
        END;
      `);

      const deletion =
        deletionKind === "task"
          ? harness.callRpc("deleteTask", { taskId: dependent.id })
          : harness.callRpc("deleteProject", {
              projectId: firstProject.id,
              force: true,
            });
      await expect(deletion).rejects.toThrow(
        `injected ${deletionKind} deletion failure`,
      );

      expect(store.tasks.getProject(firstProject.id)).toBeDefined();
      expect(store.tasks.getTask(dependent.id)).toBeDefined();
      expect(
        store.tasks.listTaskDependencies(dependent.id).blockedBy,
      ).toHaveLength(1);
      expect(store.tasks.listComments(blocker.id)).toEqual([]);
      expect(harness.realtimeSignals).toEqual([]);
      await harness.dispose();
    },
  );
});

describe("task dependency CLI", () => {
  it("adds/lists/removes with keys and ULID ids through the canonical harness", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    const store = createStore(bb);
    const { dependent, blocker } = projectAndTasks(store.tasks);

    await expect(
      harness.runCli([
        "dependency",
        "add",
        "one-1",
        "--blocked-by",
        blocker.id,
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: "Added 1 blocker for ONE-1",
    });
    const listed = await harness.runCli([
      "dependency",
      "list",
      dependent.id,
      "--json",
    ]);
    expect(JSON.parse(listed.stdout).blockedBy).toMatchObject([
      {
        task: { id: blocker.id, key: "TWO-1" },
        project: { name: "Second project" },
      },
    ]);
    await expect(
      harness.runCli([
        "dependency",
        "remove",
        dependent.id,
        "--blocked-by",
        "TWO-1",
      ]),
    ).resolves.toMatchObject({ exitCode: 0 });
    await harness.dispose();
  });
});
