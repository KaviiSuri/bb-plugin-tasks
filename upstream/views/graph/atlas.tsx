import { Suspense, useEffect, useMemo, useState } from "react";
import type { Task } from "../../shared/contract.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { useTasksQuery } from "../../shell/data.js";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bb/shared-ui/tabs";
import { useRelationshipGraph } from "./data.js";
import { LazyRelationshipGraphCanvas } from "./lazy-canvas.js";
import {
  ATLAS_GRAPH_NODE_LIMIT,
  ATLAS_GRAPH_WARNING_LIMIT,
  filterRelationshipGraph,
  limitRelationshipGraph,
} from "./model.js";
import {
  RelationshipGraphControls,
  RelationshipLegend,
  RelationshipRefreshNotice,
  RelationshipState,
  RelationshipTable,
  type RelationshipGraphSettings,
} from "./relationship-ui.js";
import { StatusIcon, STATUS_LABELS } from "../detail/meta.js";

export function AtlasContent({
  root,
  initialSettings,
}: {
  root: Task;
  initialSettings: RelationshipGraphSettings;
}) {
  const navigation = useTasksNavigation();
  const [settings, setSettings] = useState(initialSettings);
  const [selectedTaskId, setSelectedTaskId] = useState(root.id);
  const [fitRequest, setFitRequest] = useState(0);
  const [representation, setRepresentation] = useState<
    "graph" | "relationships"
  >("graph");
  const query = useRelationshipGraph(
    root,
    settings.depth,
    ATLAS_GRAPH_NODE_LIMIT,
  );
  useEffect(() => {
    setSettings(initialSettings);
    setSelectedTaskId(root.id);
  }, [
    initialSettings.depth,
    initialSettings.filters.containment,
    initialSettings.filters.dependencies,
    initialSettings.filters.resolved,
    root.id,
  ]);
  const limited = useMemo(() => {
    if (!query.data) return null;
    return limitRelationshipGraph(
      filterRelationshipGraph(query.data, settings.filters),
      ATLAS_GRAPH_NODE_LIMIT,
    );
  }, [query.data, settings.filters]);
  const selected = limited?.graph.nodes.get(selectedTaskId);
  const openTask = (taskId: string) => {
    const entry =
      limited?.graph.nodes.get(taskId) ?? query.data?.nodes.get(taskId);
    if (entry) navigation.go({ kind: "task", taskKey: entry.task.key });
  };
  const changeSettings = (next: RelationshipGraphSettings) => {
    setSettings(next);
    navigation.go(
      {
        kind: "graph",
        taskKey: root.key,
        depth: next.depth,
        containment: next.filters.containment,
        dependencies: next.filters.dependencies,
        resolved: next.filters.resolved,
      },
      { replace: true },
    );
  };

  return (
    <div className="@container flex min-h-full flex-col bg-surface-recessed-solid p-3">
      <Tabs
        value={representation}
        onValueChange={(value) =>
          setRepresentation(value as "graph" | "relationships")
        }
        className="flex min-h-[42rem] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xs"
      >
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border-hairline px-3.5 py-2">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              Task relationship Atlas
            </h1>
            <p className="truncate text-2xs text-muted-foreground">
              {root.key} · subtasks + blocker → dependent relationships
            </p>
          </div>
          <span
            aria-live="polite"
            className="ml-auto text-xs tabular-nums text-muted-foreground"
          >
            {limited
              ? `${limited.graph.nodes.size} tasks · ${limited.graph.edges.length} relationships`
              : ""}
          </span>
          <TabsList className="h-7 rounded-md p-0.5">
            <TabsTrigger value="graph" className="h-6 px-2 text-xs">
              Graph
            </TabsTrigger>
            <TabsTrigger value="relationships" className="h-6 px-2 text-xs">
              Relationships / Hierarchy
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="flex min-h-10 items-center gap-2 border-b border-border-hairline px-3.5 py-1.5">
          <RelationshipGraphControls
            settings={settings}
            onChange={changeSettings}
            onFit={() => setFitRequest((value) => value + 1)}
            disabled={query.isLoading && !query.data}
          />
          {settings.depth === 1 ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 gap-1 text-xs"
              onClick={() => changeSettings({ ...settings, depth: 2 })}
            >
              <Icon name="Plus" className="size-3" />
              Expand one hop
            </Button>
          ) : null}
        </div>
        <RelationshipRefreshNotice
          error={query.error}
          graph={query.data}
          onRetry={query.refresh}
        />
        {query.data?.nodes.size &&
        query.data.nodes.size >= ATLAS_GRAPH_WARNING_LIMIT ? (
          <p className="border-b border-warning/30 bg-warning/10 px-3.5 py-2 text-xs text-warning">
            {query.data.nodes.size} tasks loaded. Refine the relationship scope
            before expanding further; this view renders at most{" "}
            {ATLAS_GRAPH_NODE_LIMIT}.
          </p>
        ) : null}
        {query.data?.errors.length ? (
          <p
            role="status"
            className="border-b border-warning/30 bg-warning/10 px-3.5 py-2 text-xs text-warning"
          >
            Partial graph: {query.data.errors.join(" ")}
            <Button
              variant="ghost"
              size="sm"
              className="ml-2 h-6 px-2 text-xs"
              onClick={query.refresh}
            >
              Retry
            </Button>
          </p>
        ) : null}
        {query.data?.warnings.length ? (
          <p
            role="status"
            className="border-b border-warning/30 bg-warning/10 px-3.5 py-2 text-xs text-warning"
          >
            {query.data.warnings.join(" ")}
          </p>
        ) : null}
        <RelationshipState
          isLoading={query.isLoading}
          error={query.error}
          graph={query.data}
          onRetry={query.refresh}
        />
        {limited ? (
          <div className="flex min-h-0 flex-1 flex-col @[48rem]:flex-row">
            <TabsContent
              value="graph"
              aria-label="Relationship graph"
              className="m-0 min-h-[28rem] min-w-0 flex-1"
            >
              {limited.graph.edges.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  No subtasks or dependencies in this scope.
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div
                      role="status"
                      className="flex h-full items-center justify-center text-sm text-muted-foreground"
                    >
                      Preparing relationship graph…
                    </div>
                  }
                >
                  <LazyRelationshipGraphCanvas
                    graph={limited.graph}
                    compact={false}
                    selectedTaskId={selectedTaskId}
                    onSelect={setSelectedTaskId}
                    onOpenTask={openTask}
                    fitRequest={fitRequest}
                    interactive
                    omittedNodeCount={limited.omittedNodeCount}
                    omittedEdgeCount={limited.omittedEdgeCount}
                  />
                </Suspense>
              )}
            </TabsContent>
            <TabsContent
              value="relationships"
              aria-label="Relationships and hierarchy"
              className="m-0 min-h-[28rem] min-w-0 flex-1"
            >
              <RelationshipTable graph={limited.graph} onOpenTask={openTask} />
            </TabsContent>
            <aside className="w-full shrink-0 border-t border-border-seam p-3 @[48rem]:w-60 @[48rem]:border-l @[48rem]:border-t-0">
              <h2 className="mb-3 text-xs font-semibold text-muted-foreground">
                Selected task
              </h2>
              {selected ? (
                <>
                  <div className="flex items-center gap-2">
                    <StatusIcon status={selected.task.status} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {selected.task.key}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold">
                    {selected.task.title}
                  </h3>
                  <dl className="mt-4 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>{STATUS_LABELS[selected.task.status]}</dd>
                    <dt className="text-muted-foreground">Project</dt>
                    <dd className="truncate">{selected.project.name}</dd>
                    <dt className="text-muted-foreground">Blocking</dt>
                    <dd>
                      {selected.task.isBlocked
                        ? `${selected.task.unresolvedBlockerCount} unresolved`
                        : "Not blocked"}
                    </dd>
                  </dl>
                  <Button
                    size="sm"
                    className="mt-5 w-full"
                    onClick={() => openTask(selected.task.id)}
                  >
                    Open task detail
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => {
                      const next = selected.task;
                      navigation.go({
                        kind: "graph",
                        taskKey: next.key,
                        depth: settings.depth,
                        containment: settings.filters.containment,
                        dependencies: settings.filters.dependencies,
                        resolved: settings.filters.resolved,
                      });
                    }}
                  >
                    Re-root graph
                  </Button>
                </>
              ) : null}
              <div className="mt-5 border-t border-border-hairline pt-3">
                <RelationshipLegend />
              </div>
            </aside>
          </div>
        ) : null}
      </Tabs>
    </div>
  );
}

export function RelationshipAtlasView({
  taskKey,
  initialSettings,
}: {
  taskKey: string;
  initialSettings: RelationshipGraphSettings;
}) {
  const root = useTasksQuery(
    async (rpc) => (await rpc.call("getTaskByKey", { taskKey })).task,
    ["tasks:changed"],
    [taskKey],
  );
  if (root.data === undefined) {
    return root.error ? (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-destructive"
      >
        <span>
          Could not load {taskKey}: {root.error}
        </span>
        <Button variant="outline" size="sm" onClick={root.refresh}>
          Retry
        </Button>
      </div>
    ) : (
      <div
        role="status"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        Loading task…
      </div>
    );
  }
  if (root.data === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Task {taskKey} was not found.
      </div>
    );
  }
  return <AtlasContent root={root.data} initialSettings={initialSettings} />;
}
