import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type GraphData,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import { cn } from "@bb/shared-ui/lib/utils";
import { StatusIcon, STATUS_LABELS } from "../detail/meta.js";
import {
  connectedTaskIds,
  type RelationshipGraph,
  type RelationshipGraphEdge,
  type RelationshipGraphNode,
} from "./model.js";

interface ForceNode {
  id: string;
  entry: RelationshipGraphNode;
  root: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface ForceLink {
  id: string;
  relationship: RelationshipGraphEdge;
  source: string | ForceNode;
  target: string | ForceNode;
}

type GraphNode = NodeObject<ForceNode>;
type GraphLink = LinkObject<ForceNode, ForceLink>;
type GraphMethods = ForceGraphMethods<ForceNode, ForceLink>;

interface CanvasTheme {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  border: string;
  warning: string;
  success: string;
}

const FALLBACK_THEME: CanvasTheme = {
  background: "#171816",
  card: "#252722",
  foreground: "#eceee9",
  muted: "#92978d",
  border: "#565a52",
  warning: "#e9b949",
  success: "#4bd18b",
};

function cssColor(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback;
}

function readCanvasTheme(): CanvasTheme {
  if (typeof document === "undefined") return FALLBACK_THEME;
  const style = getComputedStyle(document.documentElement);
  return {
    background: cssColor(style, "--surface-recessed-soft-solid", FALLBACK_THEME.background),
    card: cssColor(style, "--card", FALLBACK_THEME.card),
    foreground: cssColor(style, "--foreground", FALLBACK_THEME.foreground),
    muted: cssColor(style, "--muted-foreground", FALLBACK_THEME.muted),
    border: cssColor(style, "--border", FALLBACK_THEME.border),
    warning: cssColor(style, "--warning", FALLBACK_THEME.warning),
    success: cssColor(style, "--success", FALLBACK_THEME.success),
  };
}

function useCanvasTheme(): CanvasTheme {
  const signature = useSyncExternalStore(
    (callback) => {
      const observer = new MutationObserver(callback);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      return () => observer.disconnect();
    },
    () =>
      `${document.documentElement.className}|${document.documentElement.getAttribute("style") ?? ""}`,
    () => "server",
  );
  return useMemo(readCanvasTheme, [signature]);
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const next = element.getBoundingClientRect();
      setSize((current) => {
        const width = Math.max(1, Math.round(next.width));
        const height = Math.max(1, Math.round(next.height));
        return current.width === width && current.height === height
          ? current
          : { width, height };
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function endpointId(endpoint: string | number | GraphNode | undefined): string {
  if (typeof endpoint === "object" && endpoint !== null) {
    return String(endpoint.id ?? "");
  }
  return String(endpoint ?? "");
}

function taskNodeRadius(node: GraphNode): number {
  return node.root ? 7 : 4.5;
}

function labelWidth(node: GraphNode): number {
  return Math.max(38, node.entry.task.key.length * 7 + 18);
}

/** A small rectangular collision force keeps labels readable after physics settles. */
function labelCollisionForce() {
  let nodes: GraphNode[] = [];
  const force = (alpha: number) => {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (!right) continue;
        const dx = (right.x ?? 0) - (left.x ?? 0);
        const dy = (right.y ?? 0) - (left.y ?? 0);
        const wantedX = (labelWidth(left) + labelWidth(right)) / 2;
        const wantedY = 24;
        if (Math.abs(dx) >= wantedX || Math.abs(dy) >= wantedY) continue;
        const xPressure = 1 - Math.abs(dx) / wantedX;
        const yPressure = 1 - Math.abs(dy) / wantedY;
        const strength = alpha * 0.45;
        if (xPressure < yPressure) {
          const push = Math.sign(dx || leftIndex - rightIndex) * xPressure * strength;
          left.vx = (left.vx ?? 0) - push;
          right.vx = (right.vx ?? 0) + push;
        } else {
          const push = Math.sign(dy || leftIndex - rightIndex) * yPressure * strength;
          left.vy = (left.vy ?? 0) - push;
          right.vy = (right.vy ?? 0) + push;
        }
      }
    }
  };
  force.initialize = (next: GraphNode[]) => {
    nodes = next;
  };
  return force;
}

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
  nodes: readonly GraphNode[],
): string | null {
  const selected = nodes.find((node) => node.id === selectedTaskId);
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
    nodes
      .filter((node) => neighbors.has(node.id))
      .map((node) => {
        const dx = (node.x ?? 0) - (selected.x ?? 0);
        const dy = (node.y ?? 0) - (selected.y ?? 0);
        const forward = dx * direction.x + dy * direction.y;
        const cross = Math.abs(dx * direction.y - dy * direction.x);
        return { id: node.id, forward, cross };
      })
      .filter((entry) => entry.forward > 0)
      .sort((a, b) => a.cross - b.cross || a.forward - b.forward)[0]?.id ?? null
  );
}

function HoverCard({ entry }: { entry: RelationshipGraphNode }) {
  const { task, project } = entry;
  return (
    <div className="w-52 rounded-lg border border-input bg-card p-2.5 text-left shadow-lg">
      <div className="flex items-center gap-1.5">
        <StatusIcon status={task.status} className="size-3" />
        <span className="font-mono text-2xs text-subtle-foreground">
          {task.key}
        </span>
        <span className="ml-auto text-2xs text-muted-foreground">
          {STATUS_LABELS[task.status]}
        </span>
      </div>
      <div className="mt-1.5 text-xs font-semibold leading-snug">
        {task.title}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-sm"
          style={{ backgroundColor: project.color }}
        />
        <span className="min-w-0 truncate">{project.name}</span>
      </div>
      {task.isBlocked ? (
        <div className="mt-2 text-2xs font-medium text-warning">
          {task.unresolvedBlockerCount} unresolved blocker
          {task.unresolvedBlockerCount === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
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
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphMethods | undefined>(undefined);
  const hoverCardRef = useRef<HTMLDivElement>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const { width, height } = useElementSize(containerRef);
  const theme = useCanvasTheme();
  const [hoveredTaskId, setHoveredTaskId] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const activeTaskId = focusedTaskId || hoveredTaskId || selectedTaskId;
  const cardTaskId = focusedTaskId || hoveredTaskId;
  const connected = useMemo(
    () => connectedTaskIds(graph, activeTaskId),
    [activeTaskId, graph],
  );

  const graphData = useMemo<GraphData<ForceNode, ForceLink>>(() => {
    const entries = [...graph.nodes.values()];
    const radius = Math.max(64, entries.length * (compact ? 9 : 12));
    const nodes: GraphNode[] = entries.map((entry, index) => {
      const angle = (index / Math.max(1, entries.length)) * Math.PI * 2;
      const root = entry.task.id === graph.rootId;
      return {
        id: entry.task.id,
        entry,
        root,
        x: root ? 0 : Math.cos(angle) * radius,
        y: root ? 0 : Math.sin(angle) * radius,
      };
    });
    const links: GraphLink[] = graph.edges.map((relationship) => ({
      id: relationship.id,
      relationship,
      source: relationship.source,
      target: relationship.target,
    }));
    return { nodes, links };
  }, [compact, graph]);

  const nodes = graphData.nodes as GraphNode[];
  const links = graphData.links as GraphLink[];
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const updateOverlayPositions = useCallback(() => {
    const instance = graphRef.current;
    if (!instance) return;
    for (const node of nodes) {
      const button = nodeButtonRefs.current.get(node.id);
      if (!button || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      const point = instance.graph2ScreenCoords(node.x ?? 0, node.y ?? 0);
      button.style.transform = `translate(${point.x - 12}px, ${point.y - 12}px)`;
    }
    const cardNode = nodeById.get(focusedTaskId || hoveredTaskId);
    const card = hoverCardRef.current;
    if (!card || !cardNode || !Number.isFinite(cardNode.x) || !Number.isFinite(cardNode.y))
      return;
    const point = instance.graph2ScreenCoords(cardNode.x ?? 0, cardNode.y ?? 0);
    const placeLeft = point.x > width - 245;
    const placeAbove = point.y > height - 150;
    card.style.left = `${Math.max(8, Math.min(width - 216, point.x + (placeLeft ? -224 : 16)))}px`;
    card.style.top = `${Math.max(8, Math.min(height - 130, point.y + (placeAbove ? -126 : 12)))}px`;
  }, [focusedTaskId, height, hoveredTaskId, nodeById, nodes, width]);

  useEffect(() => {
    const instance = graphRef.current;
    if (!instance || nodes.length === 0) return;
    const charge = instance.d3Force("charge") as
      | { strength(value: number): unknown; distanceMin(value: number): unknown }
      | undefined;
    charge?.strength(compact ? -260 : -420);
    charge?.distanceMin(22);
    const link = instance.d3Force("link") as
      | {
          distance(value: (edge: GraphLink) => number): unknown;
          strength(value: number): unknown;
        }
      | undefined;
    link?.distance((edge) =>
      edge.relationship.kind === "containment"
        ? compact
          ? 72
          : 94
        : compact
          ? 112
          : 145,
    );
    link?.strength(0.55);
    instance.d3Force("label-collision", labelCollisionForce());
    instance.d3ReheatSimulation();
  }, [compact, height, nodes.length, width]);

  useEffect(() => {
    if (!cardTaskId) return;
    requestAnimationFrame(updateOverlayPositions);
  }, [cardTaskId, updateOverlayPositions]);

  useEffect(() => {
    if (fitRequest === 0 || nodes.length === 0) return;
    graphRef.current?.zoomToFit(0, compact ? 24 : 48);
  }, [compact, fitRequest, height, nodes.length, width]);

  useEffect(() => {
    setFocusedTaskId((current) => (graph.nodes.has(current) ? current : ""));
    setHoveredTaskId((current) => (graph.nodes.has(current) ? current : ""));
  }, [graph]);

  const drawNode = useCallback(
    (node: GraphNode, context: CanvasRenderingContext2D, globalScale: number) => {
      const scale = Math.max(0.55, globalScale);
      const radius = taskNodeRadius(node) / scale;
      const dimmed = activeTaskId !== "" && !connected.has(node.id);
      const selected = node.id === activeTaskId;
      const terminal =
        node.entry.task.status === "done" || node.entry.task.status === "canceled";
      context.save();
      context.globalAlpha = dimmed ? 0.22 : terminal ? 0.58 : 1;
      context.beginPath();
      context.arc(node.x ?? 0, node.y ?? 0, radius, 0, Math.PI * 2);
      context.fillStyle =
        node.entry.task.status === "done"
          ? theme.success
          : node.root
            ? theme.warning
            : theme.background;
      context.fill();
      context.lineWidth = (selected ? 2.5 : 1.5) / scale;
      context.strokeStyle = selected ? theme.foreground : theme.muted;
      context.stroke();
      if (selected) {
        context.beginPath();
        context.arc(node.x ?? 0, node.y ?? 0, radius + 4 / scale, 0, Math.PI * 2);
        context.lineWidth = 1 / scale;
        context.strokeStyle = theme.border;
        context.stroke();
      }
      const fontSize = (node.root ? 11 : 10) / scale;
      context.font = `${node.root ? 650 : 500} ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.lineWidth = 3 / scale;
      context.strokeStyle = theme.background;
      const labelX = (node.x ?? 0) + radius + 6 / scale;
      context.strokeText(node.entry.task.key, labelX, node.y ?? 0);
      context.fillStyle = selected ? theme.foreground : theme.muted;
      context.fillText(node.entry.task.key, labelX, node.y ?? 0);
      context.restore();
    },
    [activeTaskId, connected, theme],
  );

  const paintNodePointerArea = useCallback(
    (node: GraphNode, color: string, context: CanvasRenderingContext2D, scale: number) => {
      const radius = (taskNodeRadius(node) + 7) / Math.max(0.55, scale);
      context.fillStyle = color;
      context.beginPath();
      context.arc(node.x ?? 0, node.y ?? 0, radius, 0, Math.PI * 2);
      context.fill();
    },
    [],
  );

  const onNodeKeyDown = (event: React.KeyboardEvent, taskId: string) => {
    if (event.key === "0") {
      event.preventDefault();
      graphRef.current?.zoomToFit(0, compact ? 24 : 48);
      return;
    }
    if (event.key === "o" || event.key === "O") {
      event.preventDefault();
      onOpenTask(taskId);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (compact) onOpenTask(taskId);
      else onSelect(taskId);
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    const neighbor = chooseDirectionalNeighbor(taskId, event.key, graph, nodes);
    if (!neighbor) return;
    event.preventDefault();
    onSelect(neighbor);
    nodeButtonRefs.current.get(neighbor)?.focus();
  };

  const hoveredEntry = cardTaskId ? graph.nodes.get(cardTaskId) : undefined;

  return (
    <div
      ref={containerRef}
      data-relationship-graph-canvas
      role="application"
      aria-label="Interactive task relationship graph"
      className="relative size-full overflow-hidden bg-surface-recessed-soft-solid"
    >
      {width > 0 && height > 0 ? (
        <ForceGraph2D<ForceNode, ForceLink>
          ref={graphRef}
          graphData={graphData}
          width={width}
          height={height}
          backgroundColor={theme.background}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintNodePointerArea}
          linkColor={(link) => {
            const edge = link.relationship;
            const touchesActive =
              endpointId(link.source) === activeTaskId ||
              endpointId(link.target) === activeTaskId;
            if (activeTaskId && !touchesActive) return theme.border;
            return edge.resolved ? theme.muted : theme.foreground;
          }}
          linkWidth={(link) => {
            const touchesActive =
              endpointId(link.source) === activeTaskId ||
              endpointId(link.target) === activeTaskId;
            return activeTaskId && touchesActive ? 1.8 : 0.8;
          }}
          linkLineDash={(link) =>
            link.relationship.kind === "containment"
              ? [2, 5]
              : link.relationship.resolved
                ? [7, 5]
                : null
          }
          linkDirectionalArrowLength={(link) =>
            link.relationship.kind === "dependency" ? 4 : 0
          }
          linkDirectionalArrowColor={() => theme.muted}
          linkDirectionalArrowRelPos={0.84}
          nodeLabel={() => ""}
          enableNodeDrag={interactive}
          enablePanInteraction={interactive}
          enableZoomInteraction={interactive}
          minZoom={0.25}
          maxZoom={4}
          warmupTicks={compact ? 70 : 100}
          cooldownTicks={compact ? 140 : 220}
          d3VelocityDecay={0.32}
          onNodeHover={(node) => setHoveredTaskId(node?.id ?? "")}
          onNodeClick={(node, event) => {
            if (event.detail > 1) onOpenTask(node.id);
            else if (compact) onOpenTask(node.id);
            else onSelect(node.id);
          }}
          onNodeDrag={updateOverlayPositions}
          onEngineTick={updateOverlayPositions}
          onEngineStop={() => {
            graphRef.current?.zoomToFit(0, compact ? 24 : 48);
            updateOverlayPositions();
          }}
          onZoom={updateOverlayPositions}
          showPointerCursor
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0" aria-label="Graph task navigation">
        {nodes.map((node) => (
          <button
            key={node.id}
            ref={(element) => {
              if (element) nodeButtonRefs.current.set(node.id, element);
              else nodeButtonRefs.current.delete(node.id);
            }}
            type="button"
            aria-label={relationshipNodeAriaLabel(graph, node.id)}
            aria-pressed={node.id === selectedTaskId}
            data-task-graph-node={node.id}
            data-selected={node.id === activeTaskId ? "true" : "false"}
            className={cn(
              "pointer-events-none absolute left-0 top-0 size-6 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
            onFocus={() => {
              setFocusedTaskId(node.id);
              if (!compact && node.id !== selectedTaskId) onSelect(node.id);
            }}
            onBlur={() => setFocusedTaskId("")}
            onKeyDown={(event) => onNodeKeyDown(event, node.id)}
          />
        ))}
      </div>

      {hoveredEntry ? (
        <div
          ref={hoverCardRef}
          className="pointer-events-none absolute z-10 motion-reduce:transition-none"
          role="tooltip"
        >
          <HoverCard entry={hoveredEntry} />
        </div>
      ) : null}

      {omittedNodeCount > 0 ? (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-dashed border-input bg-card/90 px-2 py-1.5 text-right text-2xs text-muted-foreground shadow-2xs">
          <strong className="block text-xs text-foreground">
            +{omittedNodeCount} beyond loaded scope
          </strong>
          {omittedEdgeCount > 0 ? `${omittedEdgeCount} more relationships` : null}
        </div>
      ) : null}
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
  return <GraphCanvasInner {...props} />;
}
