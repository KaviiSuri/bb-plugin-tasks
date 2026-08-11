import { useMemo } from "react";
import { useBbNavigate } from "@bb/plugin-sdk/app";
import {
  PANEL_PATH,
  tasksRouteToSubPath,
  type TasksRoute,
} from "./route-model.js";

export * from "./route-model.js";

export interface TasksNavigation {
  go: (route: TasksRoute, options?: { replace?: boolean }) => void;
}

export function useTasksNavigation(): TasksNavigation {
  const navigate = useBbNavigate();
  return useMemo(
    () => ({
      go: (route, options) => {
        navigate.toPluginPanel(PANEL_PATH, {
          subPath: tasksRouteToSubPath(route),
          ...(options?.replace ? { replace: true } : {}),
        });
      },
    }),
    [navigate],
  );
}
