import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@bb/shared-ui/lib/utils";
import { StatusIcon, STATUS_LABELS } from "../detail/meta.js";
import { layoutRelationshipGraph } from "./layout.js";
import {
  connectedTaskIds,
  type RelationshipGraph,
  type RelationshipGraphEdge,
  type RelationshipGraphNode,
} from "./model.js";

interface TaskNodeData extends Record<string, unknown> {
  entry: RelationshipGraphNode;
  root: boolean;
  dimmed: boolean;
  compact: boolean;
}

type TaskFlowNode = Node<TaskNodeData, "task">;
type GroupFlowNode = Node<{ label: string }, "subtasksGroup">;
type SummaryFlowNode = Node<
  { omittedNodeCount: number; omittedEdgeCount: number },
  "omittedSummary"
>;
type FlowNode = TaskFlowNode | GroupFlowNode | SummaryFlowNode;

interface RelationshipEdgeData extends Record<string, unknown> {
  relationship: RelationshipGraphEdge;
  compact?: boolean;
}

type RelationshipFlowEdge = Edge<RelationshipEdgeData, "relationship">;

function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const { task, project } = data.entry;
  const terminal = task.status === "done" || task.status === "canceled";
  if (data.compact) {
    return (
      <div
        data-task-graph-node={task.id}
        tabIndex={-1}
        title={`${task.key} · ${task.title} · ${project.name}`}
        className={cn(
          "flex w-24 items-center gap-1 rounded border border-border bg-card px-1.5 py-px shadow-2xs transition-opacity motion-reduce:transition-none",
          selected || data.root
            ? "border-input bg-surface-selected ring-1 ring-ring"
            : "hover:border-input hover:bg-state-hover",
          data.dimmed && "opacity-35",
        )}
      >
        <Handle type="target" position={Position.Left} className="opacity-0" />
        <StatusIcon status={task.status} className="size-2" />
        <span className="truncate font-mono text-2xs">{task.key}</span>
        <Handle type="source" position={Position.Right} className="opacity-0" />
      </div>
    );
  }
  return (
    <div
      data-task-graph-node={task.id}
      tabIndex={-1}
      className={cn(
        "w-40 rounded-lg border border-border bg-card px-2.5 py-2 text-left shadow-2xs transition-opacity motion-reduce:transition-none",
        selected || data.root
          ? "border-input bg-surface-selected ring-1 ring-ring"
          : "hover:border-input hover:bg-state-hover",
        data.dimmed && "opacity-35",
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex items-center gap-1.5">
        <StatusIcon status={task.status} className="size-3" />
        <span className="font-mono text-2xs text-subtle-foreground">
          {task.key}
        </span>
        {task.parentTaskId !== null ? (
          <span className="rounded border border-border px-1 text-2xs text-muted-foreground">
            Subtask
          </span>
        ) : null}
        {task.isBlocked ? (
          <span className="ml-auto rounded border border-warning/40 bg-warning/10 px-1 text-2xs text-warning">
            Blocked · {task.unresolvedBlockerCount}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 truncate text-xs font-medium",
          terminal && "text-muted-foreground line-through",
        )}
      >
        {task.title}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-sm"
          style={{ backgroundColor: project.color }}
        />
        <span className="min-w-0 truncate">{project.name}</span>
        <span aria-hidden>·</span>
        <span>{STATUS_LABELS[task.status]}</span>
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

function SubtasksGroup({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div className="size-full rounded-lg border border-dotted border-border bg-surface-recessed/45">
      <div className="px-3 py-2 text-2xs font-semibold text-muted-foreground">
        {data.label}
      </div>
    </div>
  );
}

function OmittedSummary({ data }: NodeProps<SummaryFlowNode>) {
  return (
    <div className="w-36 rounded-lg border border-dashed border-input bg-card px-3 py-2 text-center text-2xs text-muted-foreground shadow-2xs">
      <strong className="block text-xs text-foreground">
        +{data.omittedNodeCount} tasks
      </strong>
      {data.omittedEdgeCount > 0
        ? `${data.omittedEdgeCount} relationships outside this view`
        : "outside this view"}
    </div>
  );
}

function RelationshipEdge(props: EdgeProps<RelationshipFlowEdge>) {
  const relationship = props.data?.relationship;
  const compact = props.data?.compact ?? false;
  const [path, labelX, labelY] = getBezierPath(props);
  if (!relationship) return <BaseEdge {...props} path={path} />;
  const containment = relationship.kind === "containment";
  const label = containment
    ? "subtask"
    : relationship.resolved
      ? "✓ resolved"
      : "blocks";
  const context = relationship.crossProject ? " · cross-project" : "";
  return (
    <>
      <BaseEdge
        {...props}
        path={path}
        className={cn(
          containment
            ? "[stroke-dasharray:2_5]"
            : relationship.resolved
              ? "[stroke-dasharray:8_6]"
              : undefined,
        )}
        style={{
          stroke: "var(--muted-foreground)",
          strokeWidth: containment ? 1.5 : 2,
          ...props.style,
        }}
      />
      {!compact && (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute rounded border border-border-hairline bg-card px-1 py-px text-2xs font-medium text-muted-foreground shadow-2xs"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {label}
            {context}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = {
  task: TaskNode,
  subtasksGroup: SubtasksGroup,
  omittedSummary: OmittedSummary,
};
const edgeTypes = { relationship: RelationshipEdge };

export function relationshipNodeAriaLabel(
  graph: RelationshipGraph,
  taskId: string,
): string {
  const entry = graph.nodes.get(taskId);
  if (!entry) return "Task relationship";
  const relationships: string[] = [];
  if (taskId === graph.rootId) relationships.push("Root task");
  for (const edge of graph.edges) {
    if (edge.source !== taskId && edge.target !== taskId) continue;
    const source = graph.nodes.get(edge.source)?.task.key ?? "unknown task";
    const target = graph.nodes.get(edge.target)?.task.key ?? "unknown task";
    if (edge.kind === "containment") {
      relationships.push(
        edge.source === taskId ? `Parent of ${target}` : `Subtask of ${source}`,
      );
      continue;
    }
    const state = edge.resolved ? "resolved dependency" : "active dependency";
    relationships.push(
      edge.source === taskId
        ? `${state}; blocks ${target}`
        : `${state}; blocked by ${source}`,
    );
  }
  return `${entry.task.key}: ${entry.task.title}. ${STATUS_LABELS[entry.task.status]}. ${entry.project.name}. ${relationships.join(". ") || "Visible relationship endpoint"}.`;
}

function chooseDirectionalNeighbor(
  selectedTaskId: string,
  key: string,
  graph: RelationshipGraph,
  flowNodes: FlowNode[],
): string | null {
  const selected = flowNodes.find((node) => node.id === selectedTaskId);
  if (!selected) return null;
  const neighbors = connectedTaskIds(graph, selectedTaskId);
  neighbors.delete(selectedTaskId);
  const direction =
    key === "ArrowLeft"
      ? { x: -1, y: 0 }
      : key === "ArrowRight"
        ? { x: 1, y: 0 }
        : key === "ArrowUp"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  return (
    flowNodes
      .filter((node) => neighbors.has(node.id))
      .map((node) => {
        const dx = node.position.x - selected.position.x;
        const dy = node.position.y - selected.position.y;
        const forward = dx * direction.x + dy * direction.y;
        const cross = Math.abs(dx * direction.y - dy * direction.x);
        return { id: node.id, forward, cross };
      })
      .filter((entry) => entry.forward > 0)
      .sort((a, b) => a.cross - b.cross || a.forward - b.forward)[0]?.id ?? null
  );
}

function useBbColorMode(): "dark" | "light" {
  return useSyncExternalStore(
    (callback) => {
      const observer = new MutationObserver(callback);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      return () => observer.disconnect();
    },
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light",
  );
}

function GraphCanvasInner({
  graph,
  compact,
  selectedTaskId,
  onSelect,
  onOpenTask,
  fitRequest,
  interactive,
  omittedNodeCount,
  omittedEdgeCount,
}: RelationshipGraphCanvasProps) {
  const colorMode = useBbColorMode();
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<RelationshipFlowEdge[]>([]);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow<FlowNode, RelationshipFlowEdge>();
  const activeTaskId = focusedTaskId || selectedTaskId;
  const connected = useMemo(
    () => connectedTaskIds(graph, activeTaskId),
    [activeTaskId, graph],
  );

  useEffect(() => {
    setFocusedTaskId((current) => (graph.nodes.has(current) ? current : ""));
  }, [graph]);

  useEffect(() => {
    let active = true;
    setLayoutError(null);
    void layoutRelationshipGraph(graph, { compact }).then(
      (layout) => {
        if (!active) return;
        const nextNodes: FlowNode[] = [];
        if (layout.group) {
          nextNodes.push({
            id: layout.group.id,
            type: "subtasksGroup",
            position: layout.group.position,
            data: { label: "Subtasks" },
            style: {
              width: layout.group.width,
              height: layout.group.height,
              zIndex: -1,
            },
            selectable: false,
            focusable: false,
            draggable: false,
          });
        }
        for (const [taskId, entry] of graph.nodes) {
          nextNodes.push({
            id: taskId,
            type: "task",
            position: layout.positions.get(taskId) ?? { x: 0, y: 0 },
            data: {
              entry,
              root: taskId === graph.rootId,
              dimmed: activeTaskId !== "" && !connected.has(taskId),
              compact,
            },
            draggable: false,
            connectable: false,
            selected: taskId === activeTaskId,
            focusable: true,
            selectable: true,
            ariaLabel: relationshipNodeAriaLabel(graph, taskId),
          });
        }
        if (omittedNodeCount > 0) {
          nextNodes.push({
            id: "relationship-graph-omitted-summary",
            type: "omittedSummary",
            position: {
              x: layout.width + (compact ? 12 : 28),
              y: Math.max(0, layout.height / 2 - 24),
            },
            data: { omittedNodeCount, omittedEdgeCount },
            draggable: false,
            connectable: false,
            selectable: false,
            focusable: true,
            ariaLabel: `${omittedNodeCount} tasks and ${omittedEdgeCount} relationships are outside this bounded graph view.`,
          });
        }
        const nextEdges: RelationshipFlowEdge[] = graph.edges.map(
          (relationship) => ({
            id: relationship.id,
            source: relationship.source,
            target: relationship.target,
            type: "relationship",
            data: { relationship, compact },
            markerEnd:
              relationship.kind === "dependency"
                ? {
                    type: MarkerType.ArrowClosed,
                    color: "var(--muted-foreground)",
                    width: 14,
                    height: 14,
                  }
                : undefined,
            focusable: false,
            selectable: false,
            style: {
              opacity:
                activeTaskId !== "" &&
                relationship.source !== activeTaskId &&
                relationship.target !== activeTaskId
                  ? 0.3
                  : 1,
            },
          }),
        );
        setNodes(nextNodes);
        setEdges(nextEdges);
        requestAnimationFrame(() => {
          if (compact) {
            void fitView({
              nodes: nextNodes,
              padding: 0.02,
              minZoom: 0.6,
              maxZoom: 1.2,
              duration: 0,
            });
          } else {
            const focusNodes = nextNodes.filter(
              (node) =>
                node.type === "omittedSummary" ||
                (node.type === "task" && connected.has(node.id)),
            );
            void fitView({
              nodes: focusNodes,
              padding: 0.18,
              duration: 0,
            });
          }
        });
      },
      (reason: unknown) => {
        if (!active) return;
        setLayoutError(
          reason instanceof Error ? reason.message : String(reason),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [compact, fitView, graph, omittedEdgeCount, omittedNodeCount]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) =>
        node.type === "task"
          ? {
              ...node,
              data: {
                ...node.data,
                root: node.id === graph.rootId,
                dimmed: activeTaskId !== "" && !connected.has(node.id),
              },
              selected: node.id === activeTaskId,
            }
          : node,
      ),
    );
    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        style: {
          ...edge.style,
          opacity:
            activeTaskId !== "" &&
            edge.source !== activeTaskId &&
            edge.target !== activeTaskId
              ? 0.3
              : 1,
        },
      })),
    );
  }, [activeTaskId, connected, graph.rootId]);

  useEffect(() => {
    if (fitRequest === 0 || nodes.length === 0) return;
    void fitView({ padding: compact ? 0.08 : 0.15, duration: 0 });
  }, [compact, fitRequest, fitView, nodes.length]);

  const taskIdForTarget = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const taskElement = target.closest<HTMLElement>(
      "[data-task-graph-node], .react-flow__node[data-id]",
    );
    const taskId =
      taskElement?.dataset.taskGraphNode ?? taskElement?.dataset.id;
    return taskId && graph.nodes.has(taskId) ? taskId : null;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const focusedTaskId = taskIdForTarget(event.target);
    if (event.key === "0") {
      event.preventDefault();
      void fitView({ padding: compact ? 0.08 : 0.15, duration: 0 });
      return;
    }
    if ((event.key === "o" || event.key === "O") && focusedTaskId) {
      event.preventDefault();
      onOpenTask(focusedTaskId);
      return;
    }
    if (event.key === "Enter" && focusedTaskId) {
      event.preventDefault();
      if (compact) onOpenTask(focusedTaskId);
      else onSelect(focusedTaskId);
      return;
    }
    if (!event.key.startsWith("Arrow") || !focusedTaskId) return;
    const neighbor = chooseDirectionalNeighbor(
      focusedTaskId,
      event.key,
      graph,
      nodes,
    );
    if (!neighbor) return;
    event.preventDefault();
    onSelect(neighbor);
    requestAnimationFrame(() => {
      canvasRef.current
        ?.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${neighbor}"], [data-task-graph-node="${neighbor}"]`,
        )
        ?.focus();
    });
  };

  if (layoutError) {
    return (
      <div
        role="alert"
        className="flex h-full items-center justify-center p-4 text-center text-xs text-destructive"
      >
        The graph layout could not be displayed. {layoutError}
      </div>
    );
  }
  return (
    <div
      ref={canvasRef}
      data-relationship-graph-canvas
      className="relative size-full"
      onFocusCapture={(event) => {
        const taskId = taskIdForTarget(event.target);
        if (!taskId) return;
        setFocusedTaskId(taskId);
        if (!compact && taskId !== selectedTaskId) onSelect(taskId);
      }}
      onKeyDown={onKeyDown}
    >
      <ReactFlow<FlowNode, RelationshipFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={compact ? 0.25 : 0.15}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={false}
        preventScrolling={interactive}
        onNodeClick={(_, node) => {
          if (node.type !== "task") return;
          if (compact) onOpenTask(node.id);
          else onSelect(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === "task") onOpenTask(node.id);
        }}
        proOptions={{ hideAttribution: true }}
        colorMode={colorMode}
        className="bg-surface-recessed-soft-solid"
      />
    </div>
  );
}

export interface RelationshipGraphCanvasProps {
  graph: RelationshipGraph;
  compact: boolean;
  selectedTaskId: string;
  onSelect: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  fitRequest: number;
  interactive: boolean;
  omittedNodeCount: number;
  omittedEdgeCount: number;
}

export function RelationshipGraphCanvas(props: RelationshipGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
