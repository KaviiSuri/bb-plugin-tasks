import { Suspense, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TasksQuery } from "../../shell/data.js";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  filterRelationshipGraph,
  limitRelationshipGraph,
  LOCAL_GRAPH_NODE_LIMIT,
  type RelationshipGraph,
} from "./model.js";
import { LazyRelationshipGraphCanvas } from "./lazy-canvas.js";
import {
  RelationshipGraphControls,
  RelationshipLegend,
  RelationshipRefreshNotice,
  RelationshipState,
  type RelationshipGraphSettings,
} from "./relationship-ui.js";

export interface LocalRelationshipGraphProps {
  query: TasksQuery<RelationshipGraph>;
  settings: RelationshipGraphSettings;
  onSettingsChange: (settings: RelationshipGraphSettings) => void;
  onOpenTask: (taskId: string) => void;
  onExpand: () => void;
  className?: string;
}

export function LocalRelationshipGraph({
  query,
  settings,
  onSettingsChange,
  onOpenTask,
  onExpand,
  className,
}: LocalRelationshipGraphProps) {
  const [fitRequest, setFitRequest] = useState(0);
  const limited = useMemo(() => {
    if (!query.data) return null;
    return limitRelationshipGraph(
      filterRelationshipGraph(query.data, settings.filters),
      LOCAL_GRAPH_NODE_LIMIT,
    );
  }, [query.data, settings.filters]);

  return (
    <section
      aria-label="Local task relationship graph"
      className={cn("mt-5 border-t border-border-hairline pt-4", className)}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-semibold">Task relationships</h2>
        <span
          aria-live="polite"
          className="ml-auto text-2xs tabular-nums text-muted-foreground"
        >
          {limited
            ? `${limited.graph.nodes.size} tasks · ${limited.graph.edges.length} relationships`
            : ""}
        </span>
      </div>
      <RelationshipGraphControls
        compact
        settings={settings}
        onChange={onSettingsChange}
        onFit={() => setFitRequest((value) => value + 1)}
        onExpand={onExpand}
        disabled={query.isLoading && !query.data}
      />
      <RelationshipRefreshNotice
        error={query.error}
        graph={query.data}
        onRetry={query.refresh}
        className="mt-2 rounded-md"
      />
      <div className="mt-2 h-56 overflow-hidden rounded-md border border-border-hairline bg-surface-recessed-soft-solid">
        <RelationshipState
          isLoading={query.isLoading}
          error={query.error}
          graph={query.data}
          onRetry={query.refresh}
        />
        {limited ? (
          limited.graph.edges.length === 0 ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
              No subtasks or dependencies yet. Use the lists on this page to add
              relationships.
            </div>
          ) : (
            <Suspense
              fallback={
                <div
                  role="status"
                  className="flex h-full items-center justify-center text-xs text-muted-foreground"
                >
                  Preparing relationship graph…
                </div>
              }
            >
              <LazyRelationshipGraphCanvas
                graph={limited.graph}
                compact
                selectedTaskId={limited.graph.rootId}
                onSelect={onOpenTask}
                onOpenTask={onOpenTask}
                fitRequest={fitRequest}
                interactive
                omittedNodeCount={limited.omittedNodeCount}
                omittedEdgeCount={limited.omittedEdgeCount}
              />
            </Suspense>
          )
        ) : null}
      </div>
      <div className="mt-2">
        <RelationshipLegend compact />
      </div>
      {query.data?.errors.length ? (
        <p role="status" className="mt-2 text-2xs text-warning">
          Partial graph: {query.data.errors.join(" ")}
        </p>
      ) : null}
      {query.data?.warnings.length ? (
        <p role="status" className="mt-2 text-2xs text-warning">
          {query.data.warnings.join(" ")}
        </p>
      ) : null}
    </section>
  );
}

/** Keep exactly one Local Graph mounted while its responsive host moves. */
export function LocalRelationshipGraphPortal({
  host,
  ...props
}: LocalRelationshipGraphProps & { host: HTMLElement | null }) {
  return host
    ? createPortal(<LocalRelationshipGraph {...props} />, host)
    : null;
}
