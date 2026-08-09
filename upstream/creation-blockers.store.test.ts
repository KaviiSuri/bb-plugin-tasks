import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createTasksStore } from "./db/index.js";
import { tasksRpcContract } from "./shared/contract.js";
import { groupBlockerCandidates } from "./views/manage/blocker-picker-model.js";

type Store = ReturnType<typeof createTasksStore>;

function setup() {
  const db = new Database(":memory:");
  return { db, store: createTasksStore(db) };
}

function fixture(store: Store) {
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

function asDependencyTask(store: Store, task: ReturnType<Store["createTask"]>) {
  return {
    task: { ...task, labelIds: [] },
    project: store.getProject(task.projectId)!,
  };
}

describe("creation blocker contract and store search", () => {
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

  it("keeps label and blocker ID arrays independently constrained", () => {
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

  it("filters before applying limit and preserves active/current-project ordering", () => {
    const { db, store } = setup();
    const data = fixture(store);
    const currentSecond = store.createTask({
      projectId: data.currentProject.id,
      title: "Current second active",
    });
    for (let index = 0; index < 25; index += 1) {
      store.createTask({
        projectId: data.otherProject.id,
        title: `Unrelated ${index}`,
      });
    }
    const otherMatch = store.createTask({
      projectId: data.otherProject.id,
      title: "Needle across projects",
    });

    expect(
      store
        .searchBlockerCandidates({
          projectId: data.currentProject.id,
          limit: 2,
        })
        .candidates.map((task) => task.id),
    ).toEqual([data.currentActive.id, currentSecond.id]);
    expect(
      store
        .searchBlockerCandidates({
          projectId: data.currentProject.id,
          query: "needle",
          selectedTaskIds: [data.currentActive.id],
          limit: 1,
        })
        .candidates.map((task) => task.id),
    ).toEqual([otherMatch.id]);
    expect(
      db
        .prepare("PRAGMA index_list('tasks')")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toContain("idx_tasks_blocker_candidates");
    db.close();
  });

  it("searches key/title only and leaves terminal tasks selectable last", () => {
    const { db, store } = setup();
    const data = fixture(store);
    store.createTask({
      projectId: data.currentProject.id,
      title: "Unrelated title",
      description: "needle only in description",
    });

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
    expect(
      store
        .searchBlockerCandidates({ projectId: data.currentProject.id })
        .candidates.map((task) => task.status),
    ).toEqual(["todo", "backlog", "in_progress", "done", "canceled"]);
    db.close();
  });

  it("reconciles selected IDs against durable task state", () => {
    const { db, store } = setup();
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

  it("excludes self, existing edges, selections, and transitive cycles", () => {
    const { db, store } = setup();
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
    expect(ids).not.toContain(downstream.id);
    expect(ids).not.toContain(transitiveDownstream.id);
    expect(result.selected.map((task) => task.id)).toEqual([
      data.otherActive.id,
    ]);
    expect(ids).toContain(data.currentDone.id);
    db.close();
  });

  it("groups active options before labeled terminal project groups", () => {
    const { db, store } = setup();
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
