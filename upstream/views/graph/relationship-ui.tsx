import { useState } from "react";
import type { Task } from "../../shared/contract.js";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { STATUS_LABELS, StatusIcon } from "../detail/meta.js";
import type {
  RelationshipGraph,
  RelationshipGraphDepth,
  RelationshipGraphEdge,
  RelationshipGraphFilters,
} from "./model.js";

export interface RelationshipGraphSettings {
  depth: RelationshipGraphDepth;
  filters: RelationshipGraphFilters;
}

export function RelationshipGraphControls({
  settings,
  onChange,
  onFit,
  onExpand,
  compact = false,
  disabled = false,
}: {
  settings: RelationshipGraphSettings;
  onChange: (settings: RelationshipGraphSettings) => void;
  onFit: () => void;
  onExpand?: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [announcement, setAnnouncement] = useState("");
  const toggleType = (type: "containment" | "dependencies") => {
    const next = {
      ...settings.filters,
      [type]: !settings.filters[type],
    };
    if (!next.containment && !next.dependencies) {
      setAnnouncement("At least one relationship type must remain visible.");
      return;
    }
    setAnnouncement("");
    onChange({ ...settings, filters: next });
  };
  const controlClass = compact
    ? "h-6 gap-1 px-1.5 text-2xs"
    : "h-7 gap-1.5 px-2.5 text-xs";
  return (
    <div
      aria-label="Relationship graph controls"
      className={cn(
        "flex min-w-0 items-center gap-1.5 overflow-x-auto",
        compact && "flex-wrap overflow-visible",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-pressed={settings.filters.containment}
        className={controlClass}
        onClick={() => toggleType("containment")}
      >
        <Icon name="Layers" className="size-3" />
        Hierarchy
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-pressed={settings.filters.dependencies}
        className={controlClass}
        onClick={() => toggleType("dependencies")}
      >
        <Icon name="GitBranch" className="size-3" />
        Dependencies
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || !settings.filters.dependencies}
        aria-pressed={settings.filters.resolved}
        className={controlClass}
        onClick={() =>
          onChange({
            ...settings,
            filters: {
              ...settings.filters,
              resolved: !settings.filters.resolved,
            },
          })
        }
      >
        <Icon name="Check" className="size-3" />
        Resolved
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label={`Dependency scope: ${settings.depth === 1 ? "Direct" : settings.depth === 2 ? "2 hops" : "All blockers"}`}
        aria-pressed={settings.depth !== 1}
        className={controlClass}
        onClick={() =>
          onChange({
            ...settings,
            depth:
              settings.depth === 1
                ? 2
                : settings.depth === 2
                  ? "all-blockers"
                  : 1,
          })
        }
      >
        {settings.depth === 1
          ? "Direct"
          : settings.depth === 2
            ? "2 hops"
            : "All blockers"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label="Fit relationship graph"
        className={compact ? "size-6" : "size-7"}
        onClick={onFit}
      >
        <Icon name="Maximize2" className="size-3.5" />
      </Button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {onExpand ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(controlClass, "ml-auto")}
          onClick={onExpand}
        >
          Expand
          <Icon name="ArrowUpRight" className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

function relationshipLabel(edge: RelationshipGraphEdge): string {
  if (edge.kind === "containment") return "contains subtask";
  return edge.resolved ? "resolved dependency" : "blocks";
}

export function RelationshipLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground",
        compact ? "text-2xs" : "text-xs",
      )}
    >
      <span className="inline-flex items-center gap-1">
        <span className="w-5 border-t-2 border-dotted border-muted-foreground" />
        subtask
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-5 border-t-2 border-muted-foreground" />
        blocks →
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-5 border-t-2 border-dashed border-muted-foreground" />
        ✓ resolved →
      </span>
    </div>
  );
}

function Endpoint({
  task,
  projectName,
  onOpen,
}: {
  task: Task;
  projectName: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-1.5 text-left hover:underline"
      onClick={onOpen}
    >
      <StatusIcon status={task.status} className="size-3" />
      <span className="shrink-0 font-mono text-2xs">{task.key}</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {projectName} · {STATUS_LABELS[task.status]}
      </span>
    </button>
  );
}

export function RelationshipTable({
  graph,
  onOpenTask,
}: {
  graph: RelationshipGraph;
  onOpenTask: (taskId: string) => void;
}) {
  if (graph.edges.length === 0) {
    return (
      <div>
        <div className="flex min-h-32 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          No subtasks or dependencies in this scope.
        </div>
        {graph.warnings.length > 0 ? (
          <div
            role="status"
            className="border-t border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <span className="font-medium">Graph notices: </span>
            {graph.warnings.join(" ")}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <div className="overflow-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
          <caption className="sr-only">
            Relationships and hierarchy. {graph.edges.length} visible
            relationships.
          </caption>
          <thead>
            <tr className="border-b border-border-hairline bg-surface-recessed-soft-solid text-2xs font-semibold text-muted-foreground">
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">Relationship</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Context</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.map((edge) => {
              const source = graph.nodes.get(edge.source);
              const target = graph.nodes.get(edge.target);
              if (!source || !target) return null;
              return (
                <tr key={edge.id} className="border-b border-border-hairline">
                  <td className="px-3 py-2">
                    <Endpoint
                      task={source.task}
                      projectName={source.project.name}
                      onOpen={() => onOpenTask(source.task.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {relationshipLabel(edge)}
                  </td>
                  <td className="px-3 py-2">
                    <Endpoint
                      task={target.task}
                      projectName={target.project.name}
                      onOpen={() => onOpenTask(target.task.id)}
                    />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {edge.kind === "containment"
                      ? STATUS_LABELS[target.task.status]
                      : edge.resolved
                        ? "Resolved"
                        : "Active"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {edge.crossProject ? "Cross-project" : source.project.name}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {graph.warnings.length > 0 ? (
        <div
          role="status"
          className="border-t border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <span className="font-medium">Graph notices: </span>
          {graph.warnings.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

export function RelationshipRefreshNotice({
  error,
  graph,
  onRetry,
  className,
}: {
  error: string | null;
  graph: RelationshipGraph | undefined;
  onRetry: () => void;
  className?: string;
}) {
  if (!error || !graph) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        Showing previously loaded relationships. Refresh failed: {error}
      </span>
      <Button variant="outline" size="sm" className="h-6" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function RelationshipState({
  isLoading,
  error,
  graph,
  onRetry,
}: {
  isLoading: boolean;
  error: string | null;
  graph: RelationshipGraph | undefined;
  onRetry: () => void;
}) {
  if (isLoading && !graph) {
    return (
      <div
        role="status"
        className="flex h-full min-h-28 items-center justify-center gap-2 text-xs text-muted-foreground"
      >
        <span
          aria-hidden
          className="size-2 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
        />
        Loading task relationships…
      </div>
    );
  }
  if (error && !graph) {
    return (
      <div
        role="alert"
        className="flex h-full min-h-28 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-destructive"
      >
        <span>Could not load task relationships. {error}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  return null;
}
