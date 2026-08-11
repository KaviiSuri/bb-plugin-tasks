export const PANEL_PATH = "tasks";

export type TaskViewMode = "list" | "board";

export type TasksRoute =
  | { kind: "all" }
  | { kind: "active" }
  | { kind: "manage" }
  | { kind: "project"; projectId: string; view: TaskViewMode }
  | {
      kind: "graph";
      taskKey: string;
      depth: 1 | 2;
      containment: boolean;
      dependencies: boolean;
      resolved: boolean;
    }
  | { kind: "task"; taskKey: string; focus?: "dependencies" };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseTasksRoute(rawSubPath: string): TasksRoute {
  const subPath = rawSubPath.split("/").map(decodeSegment).join("/");
  const queryIndex = subPath.indexOf("?");
  const path = queryIndex === -1 ? subPath : subPath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : subPath.slice(queryIndex + 1);
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const head = segments[0];
  if (head === undefined || head === "all") return { kind: "all" };
  if (head === "active") return { kind: "active" };
  if (head === "manage") return { kind: "manage" };
  if (head === "task") {
    const taskKey = segments[1];
    if (taskKey !== undefined) {
      return new URLSearchParams(query).get("focus") === "dependencies"
        ? { kind: "task", taskKey, focus: "dependencies" }
        : { kind: "task", taskKey };
    }
    return { kind: "all" };
  }
  if (head === "graph") {
    const taskKey = segments[1];
    if (taskKey === undefined) return { kind: "all" };
    const params = new URLSearchParams(query);
    const containment = params.get("containment") !== "0";
    const dependencies = params.get("dependencies") !== "0";
    return {
      kind: "graph",
      taskKey,
      depth: params.get("depth") === "2" ? 2 : 1,
      containment: containment || !dependencies,
      dependencies: dependencies || !containment,
      resolved: params.get("resolved") !== "0",
    };
  }
  const view = new URLSearchParams(query).get("view");
  return {
    kind: "project",
    projectId: head,
    view: view === "board" ? "board" : "list",
  };
}

export function tasksRouteToSubPath(route: TasksRoute): string {
  switch (route.kind) {
    case "all":
      return "all";
    case "active":
      return "active";
    case "manage":
      return "manage";
    case "task":
      return route.focus === "dependencies"
        ? `task/${route.taskKey}?focus=dependencies`
        : `task/${route.taskKey}`;
    case "graph": {
      const params = new URLSearchParams({
        depth: String(route.depth),
        containment: route.containment ? "1" : "0",
        dependencies: route.dependencies ? "1" : "0",
        resolved: route.resolved ? "1" : "0",
      });
      return `graph/${route.taskKey}?${params.toString()}`;
    }
    case "project":
      return route.view === "board"
        ? `${route.projectId}?view=board`
        : route.projectId;
  }
}
