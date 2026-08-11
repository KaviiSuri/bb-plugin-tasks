import type { ElkNode } from "elkjs/lib/elk.bundled.js";
import type { RelationshipGraph } from "./model.js";

export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphGroupLayout {
  id: "subtasks";
  position: GraphPosition;
  width: number;
  height: number;
}

export interface RelationshipGraphLayout {
  positions: Map<string, GraphPosition>;
  group: GraphGroupLayout | null;
  width: number;
  height: number;
}

export interface RelationshipLayoutOptions {
  compact?: boolean;
  direction?: "RIGHT" | "DOWN";
}

const TASK_WIDTH = 160;
const TASK_HEIGHT = 70;
const COMPACT_TASK_WIDTH = 72;
const COMPACT_TASK_HEIGHT = 30;

let elkPromise: Promise<
  InstanceType<(typeof import("elkjs/lib/elk.bundled.js"))["default"]>
> | null = null;

async function elk() {
  elkPromise ??= import("elkjs/lib/elk.bundled.js").then(
    ({ default: ELK }) =>
      new ELK({
        algorithms: ["layered"],
        defaultLayoutOptions: {
          "elk.algorithm": "layered",
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        },
      }),
  );
  return elkPromise;
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? (value ?? 0) : 0;
}

/**
 * ELK is instantiated only when a graph renders. BB currently emits one app
 * artifact, so the dynamic import defers evaluation but not bundle transfer.
 */
export async function layoutRelationshipGraph(
  graph: RelationshipGraph,
  options: RelationshipLayoutOptions = {},
): Promise<RelationshipGraphLayout> {
  const width = options.compact ? COMPACT_TASK_WIDTH : TASK_WIDTH;
  const height = options.compact ? COMPACT_TASK_HEIGHT : TASK_HEIGHT;
  const subtaskIds = new Set(
    graph.edges
      .filter(
        (edge) => edge.kind === "containment" && edge.source === graph.rootId,
      )
      .map((edge) => edge.target),
  );
  const taskNode = (taskId: string): ElkNode => ({
    id: taskId,
    width,
    height,
  });
  const children: ElkNode[] = [];
  const subtasks = [...subtaskIds]
    .filter((taskId) => graph.nodes.has(taskId))
    .map(taskNode);
  if (subtasks.length > 0) {
    children.push({
      id: "subtasks",
      children: subtasks,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.padding": options.compact
          ? "[top=20,left=8,bottom=8,right=8]"
          : "[top=34,left=18,bottom=18,right=18]",
        "elk.spacing.nodeNode": options.compact ? "8" : "24",
      },
    });
  }
  for (const taskId of graph.nodes.keys()) {
    if (!subtaskIds.has(taskId)) children.push(taskNode(taskId));
  }
  const input: ElkNode = {
    id: "relationship-graph",
    children,
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": options.direction ?? "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": options.compact ? "10" : "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": options.compact
        ? "18"
        : "52",
      "elk.padding": options.compact
        ? "[top=8,left=8,bottom=8,right=8]"
        : "[top=28,left=28,bottom=28,right=28]",
    },
  };
  const result = await (await elk()).layout(input);
  const positions = new Map<string, GraphPosition>();
  let group: GraphGroupLayout | null = null;
  for (const child of result.children ?? []) {
    if (child.id !== "subtasks") {
      positions.set(child.id, { x: finite(child.x), y: finite(child.y) });
      continue;
    }
    const groupX = finite(child.x);
    const groupY = finite(child.y);
    group = {
      id: "subtasks",
      position: { x: groupX, y: groupY },
      width: finite(child.width),
      height: finite(child.height),
    };
    for (const subtask of child.children ?? []) {
      positions.set(subtask.id, {
        x: groupX + finite(subtask.x),
        y: groupY + finite(subtask.y),
      });
    }
  }
  return {
    positions,
    group,
    width: finite(result.width),
    height: finite(result.height),
  };
}
