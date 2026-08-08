import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { SmilePlusIcon } from "@hugeicons/core-free-icons";
import type { DependencyTask, Task } from "../../shared/contract.js";
import { useBbNavigate } from "@bb/plugin-sdk/app";
import {
  listAllTasks,
  useMentionItems,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { TasksEditor } from "../../editor/tasks-editor.js";
import { TaskActivity } from "../activity/index.js";
import { AttachmentsGrid, uploadAttachment } from "./attachments.js";
import { BoardView } from "../board/index.js";
import {
  createDescriptionSaver,
  type DescriptionSaver,
} from "./description-save.js";
import { STATUS_LABELS, StatusIcon } from "./meta.js";
import {
  InlineProperties,
  PropertiesRail,
  type TaskPropertyUpdate,
} from "./rail.js";
import { ThreadsSection } from "./threads.js";
import {
  dependencyMutationEndpoints,
  type DependencyDirection,
} from "./dependencies-model.js";
import { DetailToasts, useDetailToasts } from "./toast.js";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";

export interface DetailViewProps {
  /** Task key like TSK-4 (not the ULID). */
  taskKey: string;
}

const DESCRIPTION_SAVE_DELAY_MS = 800;
/** Poll cadence for PR state while any attached PR is still open or draft. */
const ACTIVE_PULL_REQUEST_REFRESH_MS = 60_000;

function SubTaskDonut({
  subtasks,
  onClick,
}: {
  subtasks: Task[];
  onClick: () => void;
}) {
  if (subtasks.length === 0) return null;
  const done = subtasks.filter((subtask) => subtask.status === "done").length;
  const degrees = (done / subtasks.length) * 360;
  return (
    <button
      type="button"
      title="Sub-tasks completed"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground shadow-2xs hover:border-input hover:text-foreground"
    >
      <span
        aria-hidden
        className="inline-block size-3 rounded-full"
        style={{
          background: `conic-gradient(var(--primary) ${degrees}deg, var(--muted) 0)`,
        }}
      />
      {done}/{subtasks.length} sub-tasks
    </button>
  );
}

function EditableTitle({
  task,
  onSave,
}: {
  task: Task;
  onSave: (title: string) => void;
}) {
  return (
    <h1
      // Remount when another client renames the task; while focused the vdom
      // children stay constant so React never clobbers in-progress edits.
      key={`${task.id}:${task.title}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Task title"
      className="mb-2.5 mt-1 text-2xl font-semibold leading-tight outline-none"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.textContent?.trim() ?? "";
        if (!next) {
          event.currentTarget.textContent = task.title;
          return;
        }
        if (next !== task.title) onSave(next);
      }}
    >
      {task.title}
    </h1>
  );
}

/** Persisted per parent task so each task remembers how you last viewed it. */
const SUBTASK_VIEW_STORAGE_KEY = "bb-tasks:subtask-view";

function loadSubtaskView(taskId: string): "list" | "board" {
  try {
    const raw = window.localStorage.getItem(SUBTASK_VIEW_STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return "list";
    return (parsed as Record<string, unknown>)[taskId] === "board"
      ? "board"
      : "list";
  } catch {
    // Unreadable or overwritten storage falls back to upstream's list view.
    return "list";
  }
}

function storeSubtaskView(taskId: string, view: "list" | "board"): void {
  try {
    const raw = window.localStorage.getItem(SUBTASK_VIEW_STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const next =
      parsed !== null && typeof parsed === "object"
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    next[taskId] = view;
    window.localStorage.setItem(SUBTASK_VIEW_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the choice just does not survive a reload.
  }
}

function SubTasksSection({
  ref,
  task,
  subtasks,
  onCreate,
}: {
  ref: React.Ref<HTMLElement>;
  task: Task;
  subtasks: Task[];
  onCreate: (title: string) => Promise<boolean>;
}) {
  const navigation = useTasksNavigation();
  const [view, setViewState] = useState<"list" | "board">(() =>
    loadSubtaskView(task.id),
  );
  useEffect(() => {
    setViewState(loadSubtaskView(task.id));
  }, [task.id]);
  const setView = (next: "list" | "board") => {
    setViewState(next);
    storeSubtaskView(task.id, next);
  };
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const created = await onCreate(trimmed);
    setBusy(false);
    if (created) setTitle("");
  };

  return (
    <section ref={ref} className="mt-5">
      {/* The switch only earns its space once there is something to arrange. */}
      {subtasks.length > 0 ? (
        <div className="mb-1.5 flex items-center justify-end gap-1">
          {(["list", "board"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              title={mode === "list" ? "List" : "Board"}
              onClick={() => setView(mode)}
              className={cn(
                "flex h-6 items-center gap-1 rounded-md border px-2 text-xs capitalize",
                view === mode
                  ? "border-input bg-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                name={mode === "list" ? "ListView" : "Layers"}
                className="size-3"
              />
              {mode}
            </button>
          ))}
        </div>
      ) : null}
      {view === "board" && subtasks.length > 0 ? (
        // Bounded height: the board scrolls its columns internally rather than
        // stretching the detail page to the tallest column.
        <div className="h-[26rem] rounded-md border border-border-hairline">
          <BoardView projectId={task.projectId} parentTaskId={task.id} />
        </div>
      ) : null}
      {view === "list"
        ? subtasks.map((subtask) => (
        <button
          key={subtask.id}
          type="button"
          className="flex h-8 w-full items-center gap-2 border-b border-border-hairline px-0.5 text-left text-sm hover:bg-state-hover"
          title={STATUS_LABELS[subtask.status]}
          onClick={() => navigation.go({ kind: "task", taskKey: subtask.key })}
        >
          <StatusIcon status={subtask.status} />
          <span className="shrink-0 text-xs text-muted-foreground">
            {subtask.key}
          </span>
          <span className="min-w-0 truncate">{subtask.title}</span>
        </button>
          ))
        : null}
      {adding ? (
        <div className="flex h-8 items-center gap-2 border-b border-border-hairline px-0.5">
          <StatusIcon status="todo" className="opacity-60" />
          <input
            autoFocus
            value={title}
            placeholder={`Sub-task of ${task.key}…`}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
              if (event.key === "Escape") {
                setAdding(false);
                setTitle("");
              }
            }}
            onBlur={() => {
              if (!title.trim()) setAdding(false);
            }}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="flex items-center gap-1.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setAdding(true)}
      >
        <Icon name="Plus" className="size-3" />
        Add sub-task
      </button>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-12">
      <Skeleton className="mb-4 h-7 w-2/3" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-2 h-4 w-5/6" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const rpc = useTasksRpc();
  const navigation = useTasksNavigation();
  const { toasts, push, dismiss } = useDetailToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const subtasksRef = useRef<HTMLElement>(null);

  // Local description draft: while the user types, the server still holds the
  // previous markdown, so passing the server value straight through would
  // reset the editor on every unrelated realtime refresh.
  const [draft, setDraft] = useState<{ taskId: string; markdown: string }>();
  const [dependencyBusy, setDependencyBusy] = useState(false);
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const pushRef = useRef(push);
  pushRef.current = push;
  const saverRef = useRef<DescriptionSaver | null>(null);
  saverRef.current ??= createDescriptionSaver({
    save: async (taskId, markdown) => {
      const result = await rpcRef.current.call("updateTask", {
        taskId,
        description: markdown,
      });
      return result.ok
        ? { ok: true }
        : { ok: false, errorMessage: result.error.message };
    },
    onError: (message) => pushRef.current("error", message),
    delayMs: DESCRIPTION_SAVE_DELAY_MS,
  });

  const projects = useTasksQuery(
    async (query) => (await query.call("listProjects", {})).projects,
    ["projects:changed"],
  );
  const project = projects.data?.find((entry) => entry.id === task.projectId);
  const allTaskOptions = useTasksQuery<DependencyTask[]>(
    async (query) => {
      const [tasks, allProjects] = await Promise.all([
        listAllTasks(query),
        query.call("listProjects", {}),
      ]);
      const projectsById = new Map(
        allProjects.projects.map((entry) => [entry.id, entry]),
      );
      return tasks.flatMap((entry) => {
        const entryProject = projectsById.get(entry.projectId);
        return entryProject ? [{ task: entry, project: entryProject }] : [];
      });
    },
    ["tasks:changed", "projects:changed"],
  );
  const dependencies = useTasksQuery(
    async (query) => query.call("listTaskDependencies", { taskId: task.id }),
    ["tasks:changed"],
    [task.id],
  );

  const parent = useTasksQuery(
    async (query) =>
      task.parentTaskId
        ? (await query.call("getTask", { taskId: task.parentTaskId })).task
        : null,
    ["tasks:changed"],
    [task.parentTaskId],
  );
  const subtasks = useTasksQuery(
    async (query) => listAllTasks(query, { parentTaskId: task.id }),
    ["tasks:changed"],
    [task.id],
  );
  const labels = useTasksQuery(
    async (query) =>
      (await query.call("listLabels", { projectId: task.projectId })).labels,
    ["projects:changed"],
    [task.projectId],
  );
  const attachments = useTasksQuery(
    async (query) =>
      (await query.call("listAttachments", { taskId: task.id })).attachments,
    ["tasks:changed"],
    [task.id],
  );
  const threads = useTasksQuery(
    async (query) =>
      (await query.call("listTaskThreads", { taskId: task.id })).taskThreads,
    ["threads:changed"],
    [task.id],
  );
  const presets = useTasksQuery(
    async (query) => (await query.call("listPresets")).presets,
    ["projects:changed"],
  );
  // Quiet by design: while loading (or if the lookup errors) thread cards
  // simply render without PR pills.
  const pullRequests = useTasksQuery(
    async (query) => query.call("listTaskPullRequests", { taskId: task.id }),
    ["threads:changed"],
    [task.id],
  );
  // GitHub-side transitions (draft→open→merged) never emit a Tasks realtime
  // event, so revalidate the way the main app's PR query does: always on
  // window focus, plus a slow poll while any PR is still active. The poll
  // stays bounded — each round costs one gh lookup per distinct environment.
  const refreshPullRequests = pullRequests.refresh;
  const hasActivePullRequest = (pullRequests.data?.pullRequests ?? []).some(
    (pullRequest) =>
      pullRequest.state === "open" || pullRequest.state === "draft",
  );
  useEffect(() => {
    window.addEventListener("focus", refreshPullRequests);
    return () => window.removeEventListener("focus", refreshPullRequests);
  }, [refreshPullRequests]);
  useEffect(() => {
    if (!hasActivePullRequest) return;
    const timer = window.setInterval(
      refreshPullRequests,
      ACTIVE_PULL_REQUEST_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [hasActivePullRequest, refreshPullRequests]);

  const updateTask = async (
    input: TaskPropertyUpdate & { title?: string; description?: string },
  ) => {
    try {
      const result = await rpc.call("updateTask", {
        taskId: task.id,
        ...input,
      });
      if (!result.ok) push("error", result.error.message);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  const onDescriptionChange = (markdown: string) => {
    setDraft({ taskId: task.id, markdown });
    saverRef.current?.onChange(task.id, markdown);
  };

  // Flush a pending description save when leaving the page or switching task.
  useEffect(() => {
    return () => saverRef.current?.flush(task.id);
  }, [task.id]);

  const uploadForTask = async (file: File) => {
    const result = await uploadAttachment(file, { taskId: task.id });
    attachments.refresh();
    return result;
  };

  const onPickFiles = async (files: FileList | null) => {
    for (const file of files ?? []) {
      try {
        await uploadAttachment(file, { taskId: task.id });
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      }
    }
    attachments.refresh();
  };

  const createSubtask = async (title: string): Promise<boolean> => {
    try {
      const result = await rpc.call("createTask", {
        projectId: task.projectId,
        title,
        parentTaskId: task.id,
        status: "todo",
      });
      if (!result.ok) {
        push("error", result.error.message);
        return false;
      }
      subtasks.refresh();
      return true;
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const mutateDependency = async (
    action: "add" | "remove",
    direction: DependencyDirection,
    candidate: DependencyTask,
  ) => {
    if (dependencyBusy) return;
    setDependencyBusy(true);
    try {
      const { dependentTaskId, blockerTaskIds } = dependencyMutationEndpoints(
        task.id,
        direction,
        candidate.task.id,
      );
      const result =
        action === "add"
          ? await rpc.call("addTaskDependencies", {
              dependentTaskId,
              blockerTaskIds,
            })
          : await rpc.call("removeTaskDependencies", {
              dependentTaskId,
              blockerTaskIds,
            });
      if (!result.ok) push("error", result.error.message);
      else dependencies.refresh();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setDependencyBusy(false);
    }
  };

  const mentionItems = useMentionItems();
  const navigate = useBbNavigate();

  const descriptionValue =
    draft && draft.taskId === task.id ? draft.markdown : task.description;
  const parentTask = parent.data ?? null;

  return (
    <div className="@container flex min-h-full flex-col bg-surface-recessed-solid p-3">
      <div className="flex flex-1 items-stretch rounded-lg border border-border bg-card shadow-2xs">
        <div className="mx-auto w-full min-w-0 max-w-[55rem] flex-1 px-7 pb-16 pt-8 @3xl:px-13 @3xl:pt-11">
          {parentTask || subtasks.data?.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {parentTask ? (
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground shadow-2xs hover:border-input"
                  onClick={() =>
                    navigation.go({ kind: "task", taskKey: parentTask.key })
                  }
                >
                  Sub-task of
                  <StatusIcon status={parentTask.status} className="size-3" />
                  <span className="font-medium text-foreground">
                    {parentTask.key}
                  </span>
                  <span className="min-w-0 truncate">{parentTask.title}</span>
                </button>
              ) : null}
              <SubTaskDonut
                subtasks={subtasks.data ?? []}
                onClick={() =>
                  subtasksRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
                }
              />
            </div>
          ) : null}

          <EditableTitle
            task={task}
            onSave={(title) => void updateTask({ title })}
          />

          <InlineProperties
            task={task}
            labels={labels.data}
            presets={presets.data}
            onUpdate={(update) => void updateTask(update)}
            onError={(message) => push("error", message)}
            className="mb-4 @[45rem]:hidden"
          />

          <TasksEditor
            value={descriptionValue}
            onChange={onDescriptionChange}
            variant="doc"
            className="min-h-24"
            placeholder="Add a description… rich text: headings, lists, code, checkboxes, @mentions"
            onUploadImage={uploadForTask}
            mentionItems={mentionItems}
            onOpenThread={(threadId) => navigate.toThread(threadId)}
          />

          <div className="mb-1 mt-3 flex items-center gap-1">
            <button
              type="button"
              title="Reactions coming soon"
              aria-label="Add reaction"
              disabled
              className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground opacity-50"
            >
              <HugeiconsIcon icon={SmilePlusIcon} className="size-4" />
            </button>
            <button
              type="button"
              title="Attach file"
              aria-label="Attach file"
              className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="Paperclip" className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void onPickFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <AttachmentsGrid
            attachments={attachments.data ?? []}
            onRemove={async (attachment) => {
              const result = await rpc.call("deleteAttachment", {
                attachmentId: attachment.id,
                removeDescriptionReferences: true,
              });
              if (!result.ok) throw new Error(result.error.message);
              attachments.refresh();
            }}
            onError={(message) => push("error", message)}
          />

          <SubTasksSection
            ref={subtasksRef}
            task={task}
            subtasks={subtasks.data ?? []}
            onCreate={createSubtask}
          />

          {/* With no attached threads the section disappears entirely; the
              rail's Dispatch button is the entry point. */}
          {(threads.data ?? []).length > 0 ? (
            <div className="mt-6">
              <ThreadsSection
                threads={threads.data ?? []}
                pullRequests={pullRequests.data?.pullRequests}
                unavailableThreadIds={
                  pullRequests.data?.unavailableThreadIds ?? []
                }
              />
            </div>
          ) : null}

          {/* TaskActivity draws its own top hairline; adding one here would
              stack two dividers above the Activity header. */}
          <div className="mt-1">
            <TaskActivity taskId={task.id} taskKey={task.key} />
          </div>
        </div>

        <PropertiesRail
          task={task}
          project={project}
          labels={labels.data}
          threads={threads.data ?? []}
          presets={presets.data}
          blockedBy={dependencies.data?.blockedBy ?? []}
          blocks={dependencies.data?.blocks ?? []}
          allTasks={allTaskOptions.data ?? []}
          dependencyBusy={dependencyBusy}
          onUpdate={(update) => void updateTask(update)}
          onError={(message) => push("error", message)}
          onDependencyAdd={(direction, candidate) =>
            void mutateDependency("add", direction, candidate)
          }
          onDependencyRemove={(direction, candidate) =>
            void mutateDependency("remove", direction, candidate)
          }
          className="hidden @[45rem]:block"
        />
      </div>
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export function DetailView({ taskKey }: DetailViewProps) {
  const query = useTasksQuery(
    async (rpc) => (await rpc.call("getTaskByKey", { taskKey })).task,
    ["tasks:changed"],
    [taskKey],
  );

  if (query.data === undefined) {
    return query.error ? (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        {query.error}
      </div>
    ) : (
      <DetailSkeleton />
    );
  }
  if (query.data === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Icon name="FileQuestion" className="size-5" />
        Task {taskKey} was not found.
      </div>
    );
  }
  return <TaskDetail task={query.data} />;
}
