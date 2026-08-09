import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createStore, registerHandlers } from "./api/index.js";
import { registerTasksCli } from "./cli/index.js";
import { createTasksStore, TaskDependencyError } from "./db/index.js";
import { tasksRpcContract } from "./shared/contract.js";
import {
  dependencyCandidates,
  dependencyMutationEndpoints,
} from "./views/detail/dependencies-model.js";

function database() {
  return new Database(":memory:");
}

function projectAndTasks(store: ReturnType<typeof createTasksStore>) {
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

function fakeBb(db: Database.Database) {
  const realtimeSignals: Array<{ channel: string; payload: unknown }> = [];
  let cliRegistration: any;
  const bb = {
    storage: { database: () => db },
    realtime: {
      publish(channel: string, payload: unknown) {
        realtimeSignals.push({ channel, payload });
      },
    },
    cli: {
      register(registration: unknown) {
        cliRegistration = registration;
      },
    },
    sdk: {},
  } as any;
  return { bb, realtimeSignals, getCli: () => cliRegistration };
}

describe("task dependency storage", () => {
  it("migrates directed storage with reciprocal indexes and cascading endpoints", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const { dependent, blocker } = projectAndTasks(store);

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM schema_version").get(),
    ).toEqual({ count: 6 });
    const indexes = db
      .prepare("PRAGMA index_list('task_dependencies')")
      .all()
      .map((row: any) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_task_dependencies_dependent",
        "idx_task_dependencies_blocker",
      ]),
    );

    store.addTaskDependencies(dependent.id, [blocker.id]);
    store.deleteTask(blocker.id);
    expect(store.listTaskDependencies(dependent.id).blockedBy).toEqual([]);
    db.close();
  });

  it("adds and removes multi-edge requests atomically", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const { dependent, blocker, third, firstProject } = projectAndTasks(store);
    const unrelated = store.createTask({
      projectId: firstProject.id,
      title: "Unrelated",
    });

    store.addTaskDependencies(dependent.id, [blocker.id, third.id]);
    expect(store.listTaskDependencies(dependent.id).blockedBy).toHaveLength(2);
    expect(() =>
      store.removeTaskDependencies(dependent.id, [blocker.id, unrelated.id]),
    ).toThrow(expect.objectContaining({ code: "dependency_not_found" }));
    expect(store.listTaskDependencies(dependent.id).blockedBy).toHaveLength(2);
    store.removeTaskDependencies(dependent.id, [blocker.id, third.id]);
    expect(store.listTaskDependencies(dependent.id).blockedBy).toEqual([]);
    db.close();
  });

  it("rejects self-links, duplicates, missing endpoints, and cycles atomically, including resolved edges", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const { dependent, blocker, third } = projectAndTasks(store);

    expect(() =>
      store.addTaskDependencies(dependent.id, [dependent.id]),
    ).toThrow(
      expect.objectContaining<TaskDependencyError>({
        code: "dependency_self_link",
      }),
    );
    store.addTaskDependencies(dependent.id, [blocker.id]);
    expect(() => store.addTaskDependencies(dependent.id, [blocker.id])).toThrow(
      expect.objectContaining<TaskDependencyError>({
        code: "dependency_duplicate",
      }),
    );
    expect(() =>
      store.addTaskDependencies(dependent.id, [third.id, blocker.id]),
    ).toThrow(expect.objectContaining({ code: "dependency_duplicate" }));
    expect(
      store
        .listTaskDependencies(dependent.id)
        .blockedBy.map((edge) => edge.blockerTaskId),
    ).toEqual([blocker.id]);
    expect(() =>
      store.addTaskDependencies(dependent.id, ["01J00000000000000000000000"]),
    ).toThrow(
      expect.objectContaining({ code: "dependency_endpoint_not_found" }),
    );

    store.addTaskDependencies(blocker.id, [third.id]);
    expect(() => store.addTaskDependencies(third.id, [dependent.id])).toThrow(
      expect.objectContaining({ code: "dependency_cycle" }),
    );
    expect(store.listTaskDependencies(third.id).blockedBy).toEqual([]);
    db.close();
  });
});

describe("task dependency RPC and activity", () => {
  it("projects one cross-project edge reciprocally and refreshes both activity streams", () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const { dependent, blocker, secondProject } = projectAndTasks(store.tasks);
    const handlers = registerHandlers(fake.bb, store);

    const added = tasksRpcContract.addTaskDependencies.output.parse(
      handlers.addTaskDependencies({
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
      handlers.listTaskDependencies({ taskId: blocker.id }),
    );
    expect(reciprocal.blocks).toMatchObject([
      { task: { id: dependent.id }, project: { id: dependent.projectId } },
    ]);
    const forward = handlers.listTaskDependencies({ taskId: dependent.id });
    expect(forward.blockedBy).toMatchObject([
      {
        task: { id: blocker.id, status: "done" },
        project: { id: secondProject.id, name: "Second project" },
      },
    ]);
    expect(store.tasks.listComments(dependent.id).at(-1)?.body).toBe(
      "Blocked by TWO-1 added by Tester",
    );
    expect(store.tasks.listComments(blocker.id).at(-1)?.body).toBe(
      "Blocks ONE-1 added by Tester",
    );
    expect(fake.realtimeSignals).toEqual([
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

    const removed = handlers.removeTaskDependencies({
      dependentTaskId: dependent.id,
      blockerTaskIds: [blocker.id],
      authorName: "Tester",
    });
    expect(removed.ok).toBe(true);
    expect(
      handlers.listTaskDependencies({ taskId: dependent.id }).blockedBy,
    ).toEqual([]);
    expect(store.tasks.listComments(blocker.id).at(-1)?.body).toBe(
      "Blocks ONE-1 removed by Tester",
    );
    db.close();
  });
});

describe("dependency cleanup during deletion", () => {
  it("deletes every incident edge and records directional activity on task survivors", async () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const { dependent, blocker, third } = projectAndTasks(store.tasks);
    const handlers = registerHandlers(fake.bb, store);
    store.tasks.addTaskDependencies(dependent.id, [blocker.id]);
    store.tasks.addTaskDependencies(third.id, [dependent.id]);

    await expect(
      handlers.deleteTask({ taskId: dependent.id }),
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
    expect(fake.realtimeSignals).toEqual([
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
    db.close();
  });

  it("force-deletes a project after recording only cross-project survivor activity", async () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const { firstProject, dependent, blocker, third } = projectAndTasks(
      store.tasks,
    );
    const externalDependent = store.tasks.createTask({
      projectId: blocker.projectId,
      title: "External dependent",
    });
    const handlers = registerHandlers(fake.bb, store);
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
      handlers.deleteProject({ projectId: firstProject.id, force: true }),
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
    expect(fake.realtimeSignals).toEqual([
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
    db.close();
  });

  it("rolls survivor activity and edges back when task deletion fails", async () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const { dependent, blocker } = projectAndTasks(store.tasks);
    const handlers = registerHandlers(fake.bb, store);
    store.tasks.addTaskDependencies(dependent.id, [blocker.id]);
    db.exec(`
      CREATE TRIGGER reject_dependency_task_delete
      BEFORE DELETE ON tasks
      WHEN OLD.id = '${dependent.id}'
      BEGIN
        SELECT RAISE(ABORT, 'injected deletion failure');
      END;
    `);

    await expect(handlers.deleteTask({ taskId: dependent.id })).rejects.toThrow(
      "injected deletion failure",
    );

    expect(store.tasks.getTask(dependent.id)).toBeDefined();
    expect(
      store.tasks.listTaskDependencies(dependent.id).blockedBy,
    ).toHaveLength(1);
    expect(store.tasks.listComments(blocker.id)).toEqual([]);
    expect(fake.realtimeSignals).toEqual([]);
    db.close();
  });

  it("rolls cross-project activity and edges back when project deletion fails", async () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const { firstProject, dependent, blocker } = projectAndTasks(store.tasks);
    const handlers = registerHandlers(fake.bb, store);
    store.tasks.addTaskDependencies(dependent.id, [blocker.id]);
    db.exec(`
      CREATE TRIGGER reject_dependency_project_delete
      BEFORE DELETE ON projects
      WHEN OLD.id = '${firstProject.id}'
      BEGIN
        SELECT RAISE(ABORT, 'injected project deletion failure');
      END;
    `);

    await expect(
      handlers.deleteProject({ projectId: firstProject.id, force: true }),
    ).rejects.toThrow("injected project deletion failure");

    expect(store.tasks.getProject(firstProject.id)).toBeDefined();
    expect(store.tasks.getTask(dependent.id)).toBeDefined();
    expect(
      store.tasks.listTaskDependencies(dependent.id).blockedBy,
    ).toHaveLength(1);
    expect(store.tasks.listComments(blocker.id)).toEqual([]);
    expect(fake.realtimeSignals).toEqual([]);
    db.close();
  });
});

describe("task dependency CLI and detail model", () => {
  it("adds, lists, and removes dependencies using case-insensitive keys", async () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    projectAndTasks(store.tasks);
    registerTasksCli(fake.bb, store, { name: "Tasks", version: "test" });
    const cli = fake.getCli();

    const add = await cli.run(
      ["dependency", "add", "one-1", "--blocked-by", "two-1"],
      {},
    );
    expect(add).toMatchObject({ exitCode: 0 });
    expect(add.stdout).toContain("Added 1 blocker for ONE-1");

    const list = await cli.run(["dependency", "list", "ONE-1", "--json"], {});
    const listed = JSON.parse(list.stdout);
    expect(listed.blockedBy).toMatchObject([
      {
        task: { key: "TWO-1", status: "done" },
        project: { name: "Second project" },
      },
    ]);

    const remove = await cli.run(
      ["dependency", "remove", "ONE-1", "--blocked-by", "TWO-1"],
      {},
    );
    expect(remove).toMatchObject({ exitCode: 0 });
    db.close();
  });

  it("keeps reciprocal selector semantics without deriving blocked state", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const { dependent, blocker, third, firstProject, secondProject } =
      projectAndTasks(store);
    const wrap = (task: typeof dependent) => ({
      task: { ...task, labelIds: [] },
      project:
        task.projectId === firstProject.id ? firstProject : secondProject,
    });
    const all = [wrap(dependent), wrap(blocker), wrap(third)];
    expect(
      dependencyCandidates(
        dependent as any,
        all,
        [wrap(blocker)],
        [],
        "blockedBy",
      ).map((item) => item.task.id),
    ).toEqual([third.id]);
    expect(
      dependencyMutationEndpoints(dependent.id, "blockedBy", blocker.id),
    ).toEqual({
      dependentTaskId: dependent.id,
      blockerTaskIds: [blocker.id],
    });
    expect(
      dependencyMutationEndpoints(dependent.id, "blocks", third.id),
    ).toEqual({
      dependentTaskId: third.id,
      blockerTaskIds: [dependent.id],
    });
    db.close();
  });
});
