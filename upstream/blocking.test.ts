import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createStore, registerHandlers } from "./api/index.js";
import { createTasksStore, TasksPageCursorError } from "./db/index.js";
import { tasksRpcContract } from "./shared/contract.js";

function database() {
  return new Database(":memory:");
}

function fixtures(store: ReturnType<typeof createTasksStore>) {
  const project = store.createProject({
    name: "Blocking",
    prefix: "BLK",
    color: "orange",
  });
  const dependent = store.createTask({
    projectId: project.id,
    title: "Dependent",
    status: "todo",
    priority: "high",
  });
  const first = store.createTask({
    projectId: project.id,
    title: "First blocker",
    status: "in_progress",
    priority: "high",
  });
  const second = store.createTask({
    projectId: project.id,
    title: "Second blocker",
    status: "done",
    priority: "high",
  });
  return { project, dependent, first, second };
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

function transitionBodies(store: ReturnType<typeof createTasksStore>, taskId: string) {
  return store
    .listComments(taskId)
    .map((comment) => comment.body)
    .filter((body) => body.startsWith("Blocking state changed "));
}

describe("derived blocking storage", () => {
  it("derives counts without persisted task columns and honors terminal endpoints", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const { dependent, first, second } = fixtures(store);

    store.addTaskDependencies(dependent.id, [first.id, second.id]);
    expect(store.getTaskBlockingSummary(dependent.id)).toEqual({
      isBlocked: true,
      unresolvedBlockerCount: 1,
    });

    store.updateTask(dependent.id, { status: "done" });
    expect(store.getTaskBlockingSummary(dependent.id)).toEqual({
      isBlocked: false,
      unresolvedBlockerCount: 0,
    });
    store.updateTask(dependent.id, { status: "todo" });
    expect(store.getTaskBlockingSummary(dependent.id).isBlocked).toBe(true);

    store.updateTask(first.id, { status: "canceled" });
    expect(store.getTaskBlockingSummary(dependent.id).isBlocked).toBe(false);
    store.updateTask(first.id, { status: "in_progress" });
    expect(store.getTaskBlockingSummary(dependent.id).isBlocked).toBe(true);

    const taskColumns = db
      .prepare("PRAGMA table_info('tasks')")
      .all()
      .map((column: any) => column.name);
    expect(taskColumns).not.toContain("is_blocked");
    expect(taskColumns).not.toContain("unresolved_blocker_count");
    db.close();
  });

  it("composes blocking with other SQL filters and stable pagination", () => {
    const db = database();
    const store = createTasksStore(db as any);
    const { project, dependent, first } = fixtures(store);
    const other = store.createTask({
      projectId: project.id,
      title: "Other matching task",
      status: "todo",
      priority: "high",
    });
    const secondBlocked = store.createTask({
      projectId: project.id,
      title: "Second blocked task",
      status: "todo",
      priority: "low",
    });
    store.addTaskDependencies(dependent.id, [first.id]);
    store.addTaskDependencies(secondBlocked.id, [first.id]);

    expect(
      store.listTasks({
        projectId: project.id,
        statuses: ["todo"],
        priorities: ["high"],
        blocking: "blocked",
      }).map((task) => task.id),
    ).toEqual([dependent.id]);
    expect(
      store.listTasks({
        projectId: project.id,
        statuses: ["todo"],
        priorities: ["high"],
        blocking: "not_blocked",
      }).map((task) => task.id),
    ).toEqual([other.id]);

    const pagedBlocked: string[] = [];
    let pageCursor: string | undefined;
    do {
      const page = store.listTasksPage({
        projectId: project.id,
        blocking: "blocked",
        limit: 1,
        ...(pageCursor === undefined ? {} : { cursor: pageCursor }),
      });
      pagedBlocked.push(...page.tasks.map((task) => task.id));
      pageCursor = page.nextCursor ?? undefined;
    } while (pageCursor !== undefined);
    expect(pagedBlocked).toEqual([dependent.id, secondBlocked.id]);

    const cursor = store.listTasksPage({
      projectId: project.id,
      blocking: "all",
      limit: 1,
    }).nextCursor;
    if (cursor === null) throw new Error("expected a cursor");
    expect(() =>
      store.listTasksPage({
        projectId: project.id,
        blocking: "blocked",
        limit: 1,
        cursor,
      }),
    ).toThrow("does not match the current filters");

    const blockedCursor = store.listTasksPage({
      projectId: project.id,
      blocking: "blocked",
      limit: 1,
    }).nextCursor;
    if (blockedCursor === null) throw new Error("expected a blocked cursor");
    store.addTaskDependencies(other.id, [first.id]);
    try {
      store.listTasksPage({
        projectId: project.id,
        blocking: "blocked",
        limit: 1,
        cursor: blockedCursor,
      });
      throw new Error("expected a stale cursor");
    } catch (error) {
      expect(error).toBeInstanceOf(TasksPageCursorError);
      expect((error as TasksPageCursorError).code).toBe("stale_cursor");
    }

    const statusCursor = store.listTasksPage({
      projectId: project.id,
      blocking: "blocked",
      limit: 1,
    }).nextCursor;
    if (statusCursor === null) throw new Error("expected a status cursor");
    store.updateTask(first.id, { status: "done" });
    expect(() =>
      store.listTasksPage({
        projectId: project.id,
        blocking: "blocked",
        limit: 1,
        cursor: statusCursor,
      }),
    ).toThrow("task-list data changed");
    db.close();
  });
});

describe("blocking RPC lifecycle and reconnect", () => {
  it("returns summaries, records only effective transitions, and invalidates dependents", () => {
    const db = database();
    const fake = fakeBb(db);
    const store = createStore(fake.bb);
    const { dependent, first, second } = fixtures(store.tasks);
    const handlers = registerHandlers(fake.bb, store);

    handlers.addTaskDependencies({
      dependentTaskId: dependent.id,
      blockerTaskIds: [first.id],
      authorName: "Tester",
    });
    expect(transitionBodies(store.tasks, dependent.id)).toEqual([
      "Blocking state changed to Blocked by Tester",
    ]);

    handlers.addTaskDependencies({
      dependentTaskId: dependent.id,
      blockerTaskIds: [second.id],
      authorName: "Tester",
    });
    expect(transitionBodies(store.tasks, dependent.id)).toHaveLength(1);

    const summary = tasksRpcContract.getTask.output.parse(
      handlers.getTask({ taskId: dependent.id }),
    ).task;
    expect(summary).toMatchObject({
      isBlocked: true,
      unresolvedBlockerCount: 1,
    });

    handlers.updateTask({
      taskId: first.id,
      status: "done",
      authorName: "Tester",
    });
    expect(transitionBodies(store.tasks, dependent.id)).toEqual([
      "Blocking state changed to Blocked by Tester",
      "Blocking state changed to Not blocked by Tester",
    ]);

    handlers.updateTask({
      taskId: second.id,
      status: "todo",
      authorName: "Tester",
    });
    expect(transitionBodies(store.tasks, dependent.id)).toEqual([
      "Blocking state changed to Blocked by Tester",
      "Blocking state changed to Not blocked by Tester",
      "Blocking state changed to Blocked by Tester",
    ]);

    handlers.boardMove({
      taskId: dependent.id,
      status: "canceled",
      authorName: "Tester",
    });
    expect(handlers.getTask({ taskId: dependent.id }).task).toMatchObject({
      isBlocked: false,
      unresolvedBlockerCount: 0,
    });
    handlers.boardMove({
      taskId: dependent.id,
      status: "todo",
      authorName: "Tester",
    });
    expect(handlers.getTask({ taskId: dependent.id }).task).toMatchObject({
      isBlocked: true,
      unresolvedBlockerCount: 1,
    });

    expect(fake.realtimeSignals).toEqual(
      expect.arrayContaining([
        {
          channel: "tasks:changed",
          payload: { taskId: dependent.id, projectId: dependent.projectId },
        },
        {
          channel: "comments:changed",
          payload: { taskId: dependent.id },
        },
      ]),
    );

    // A fresh store instance derives the same state from preserved edges and
    // endpoint statuses; no cached or persisted blocked flag is required.
    const reconnected = createTasksStore(db as any);
    expect(reconnected.getTaskBlockingSummary(dependent.id)).toEqual({
      isBlocked: true,
      unresolvedBlockerCount: 1,
    });
    db.close();
  });
});
