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
const COMPACT_TASK_WIDTH = 100;
const COMPACT_TASK_HEIGHT = 24;

interface LayoutMetrics {
  taskWidth: number;
  taskHeight: number;
  columnGap: number;
  rowGap: number;
  outerPadding: number;
  groupPaddingX: number;
  groupPaddingTop: number;
  groupPaddingBottom: number;
}

function metrics(compact: boolean): LayoutMetrics {
  return compact
    ? {
        taskWidth: COMPACT_TASK_WIDTH,
        taskHeight: COMPACT_TASK_HEIGHT,
        columnGap: 18,
        rowGap: 4,
        outerPadding: 4,
        groupPaddingX: 4,
        groupPaddingTop: 12,
        groupPaddingBottom: 4,
      }
    : {
        taskWidth: TASK_WIDTH,
        taskHeight: TASK_HEIGHT,
        columnGap: 52,
        rowGap: 24,
        outerPadding: 28,
        groupPaddingX: 18,
        groupPaddingTop: 34,
        groupPaddingBottom: 18,
      };
}

function directedRanks(graph: RelationshipGraph): Map<string, number> {
  const ranks = new Map<string, number>([[graph.rootId, 0]]);
  const queue = [graph.rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const rank = ranks.get(current) ?? 0;
    for (const edge of graph.edges) {
      let neighbor: string | null = null;
      let nextRank = rank;
      if (edge.source === current) {
        neighbor = edge.target;
        nextRank = rank + 1;
      } else if (edge.target === current) {
        neighbor = edge.source;
        nextRank = rank - 1;
      }
      if (neighbor && !ranks.has(neighbor)) {
        ranks.set(neighbor, nextRank);
        queue.push(neighbor);
      }
    }
  }
  for (const taskId of graph.nodes.keys()) {
    if (!ranks.has(taskId)) ranks.set(taskId, 0);
  }
  return ranks;
}

function rightwardLayout(
  graph: RelationshipGraph,
  layoutMetrics: LayoutMetrics,
): RelationshipGraphLayout {
  const ranks = directedRanks(graph);
  const directSubtasks = new Set(
    graph.edges
      .filter(
        (edge) => edge.kind === "containment" && edge.source === graph.rootId,
      )
      .map((edge) => edge.target),
  );
  const columns = new Map<number, string[]>();
  for (const [taskId, rank] of ranks) {
    const entries = columns.get(rank) ?? [];
    entries.push(taskId);
    columns.set(rank, entries);
  }
  for (const entries of columns.values()) {
    entries.sort((left, right) => {
      const leftSubtask = directSubtasks.has(left) ? 0 : 1;
      const rightSubtask = directSubtasks.has(right) ? 0 : 1;
      return (
        leftSubtask - rightSubtask ||
        (graph.nodes.get(left)?.task.key ?? left).localeCompare(
          graph.nodes.get(right)?.task.key ?? right,
        )
      );
    });
  }

  const sortedRanks = [...columns.keys()].sort((a, b) => a - b);
  const minRank = sortedRanks[0] ?? 0;
  const positions = new Map<string, GraphPosition>();
  let group: GraphGroupLayout | null = null;
  let maxX = 0;
  let maxY = 0;

  for (const rank of sortedRanks) {
    const taskIds = columns.get(rank) ?? [];
    const x =
      layoutMetrics.outerPadding +
      (rank - minRank) * (layoutMetrics.taskWidth + layoutMetrics.columnGap);
    let y = layoutMetrics.outerPadding;
    const subtasks = taskIds.filter((taskId) => directSubtasks.has(taskId));
    if (subtasks.length > 0) {
      const groupX = x - layoutMetrics.groupPaddingX;
      const groupY = y;
      y += layoutMetrics.groupPaddingTop;
      for (const taskId of subtasks) {
        positions.set(taskId, { x, y });
        y += layoutMetrics.taskHeight + layoutMetrics.rowGap;
      }
      const groupHeight =
        layoutMetrics.groupPaddingTop +
        subtasks.length * layoutMetrics.taskHeight +
        Math.max(0, subtasks.length - 1) * layoutMetrics.rowGap +
        layoutMetrics.groupPaddingBottom;
      group = {
        id: "subtasks",
        position: { x: groupX, y: groupY },
        width: layoutMetrics.taskWidth + layoutMetrics.groupPaddingX * 2,
        height: groupHeight,
      };
      y = groupY + groupHeight + layoutMetrics.rowGap;
      maxX = Math.max(maxX, groupX + group.width);
      maxY = Math.max(maxY, groupY + group.height);
    }
    for (const taskId of taskIds) {
      if (directSubtasks.has(taskId)) continue;
      positions.set(taskId, { x, y });
      maxX = Math.max(maxX, x + layoutMetrics.taskWidth);
      maxY = Math.max(maxY, y + layoutMetrics.taskHeight);
      y += layoutMetrics.taskHeight + layoutMetrics.rowGap;
    }
  }

  return {
    positions,
    group,
    width: maxX + layoutMetrics.outerPadding,
    height: maxY + layoutMetrics.outerPadding,
  };
}

function transpose(
  layout: RelationshipGraphLayout,
  graph: RelationshipGraph,
  layoutMetrics: LayoutMetrics,
): RelationshipGraphLayout {
  const positions = new Map<string, GraphPosition>();
  for (const [taskId, position] of layout.positions) {
    positions.set(taskId, { x: position.y, y: position.x });
  }
  let group: GraphGroupLayout | null = null;
  if (layout.group) {
    const subtaskPositions = graph.edges
      .filter(
        (edge) => edge.kind === "containment" && edge.source === graph.rootId,
      )
      .map((edge) => positions.get(edge.target))
      .filter((position): position is GraphPosition => position !== undefined);
    if (subtaskPositions.length > 0) {
      const minX = Math.min(...subtaskPositions.map((position) => position.x));
      const minY = Math.min(...subtaskPositions.map((position) => position.y));
      const maxX = Math.max(...subtaskPositions.map((position) => position.x));
      const maxY = Math.max(...subtaskPositions.map((position) => position.y));
      group = {
        id: "subtasks",
        position: {
          x: minX - layoutMetrics.groupPaddingX,
          y: minY - layoutMetrics.groupPaddingTop,
        },
        width:
          maxX -
          minX +
          layoutMetrics.taskWidth +
          layoutMetrics.groupPaddingX * 2,
        height:
          maxY -
          minY +
          layoutMetrics.taskHeight +
          layoutMetrics.groupPaddingTop +
          layoutMetrics.groupPaddingBottom,
      };
    }
  }
  const maxX = Math.max(
    0,
    ...[...positions.values()].map(
      (position) => position.x + layoutMetrics.taskWidth,
    ),
    group ? group.position.x + group.width : 0,
  );
  const maxY = Math.max(
    0,
    ...[...positions.values()].map(
      (position) => position.y + layoutMetrics.taskHeight,
    ),
    group ? group.position.y + group.height : 0,
  );
  return {
    positions,
    group,
    width: maxX + layoutMetrics.outerPadding,
    height: maxY + layoutMetrics.outerPadding,
  };
}

function verticalStackLayout(
  graph: RelationshipGraph,
  layoutMetrics: LayoutMetrics,
  compact: boolean,
): RelationshipGraphLayout {
  const positions = new Map<string, GraphPosition>();
  let y = layoutMetrics.outerPadding;
  const x = layoutMetrics.outerPadding;

  const root = graph.nodes.get(graph.rootId);
  if (root) {
    positions.set(graph.rootId, { x, y });
    y += layoutMetrics.taskHeight + layoutMetrics.rowGap;
  }

  const subtaskIds = graph.edges
    .filter(
      (edge) => edge.kind === "containment" && edge.source === graph.rootId,
    )
    .map((edge) => edge.target)
    .filter((taskId) => graph.nodes.has(taskId));

  let group: GraphGroupLayout | null = null;
  if (subtaskIds.length > 0) {
    if (compact) {
      // Compact: no group wrapper, just stack subtasks with a small gap
      y += layoutMetrics.rowGap;
      for (const taskId of subtaskIds) {
        positions.set(taskId, { x, y });
        y += layoutMetrics.taskHeight + layoutMetrics.rowGap;
      }
      y += layoutMetrics.rowGap;
    } else {
      const groupY = y;
      y += layoutMetrics.groupPaddingTop;
      for (const taskId of subtaskIds) {
        positions.set(taskId, { x, y });
        y += layoutMetrics.taskHeight + layoutMetrics.rowGap;
      }
      const groupHeight =
        layoutMetrics.groupPaddingTop +
        subtaskIds.length * layoutMetrics.taskHeight +
        Math.max(0, subtaskIds.length - 1) * layoutMetrics.rowGap +
        layoutMetrics.groupPaddingBottom;
      group = {
        id: "subtasks",
        position: { x: x - layoutMetrics.groupPaddingX, y: groupY },
        width: layoutMetrics.taskWidth + layoutMetrics.groupPaddingX * 2,
        height: groupHeight,
      };
      y = groupY + groupHeight + layoutMetrics.rowGap;
    }
  }

  const remaining = [...graph.nodes.keys()].filter(
    (taskId) => taskId !== graph.rootId && !subtaskIds.includes(taskId),
  );
  for (const taskId of remaining) {
    positions.set(taskId, { x, y });
    y += layoutMetrics.taskHeight + layoutMetrics.rowGap;
  }

  const maxX =
    x + layoutMetrics.taskWidth + (group ? layoutMetrics.groupPaddingX * 2 : 0);
  const maxY = y - layoutMetrics.rowGap + layoutMetrics.outerPadding;

  return {
    positions,
    group,
    width: maxX + layoutMetrics.outerPadding,
    height: Math.max(maxY, layoutMetrics.outerPadding * 2 + layoutMetrics.taskHeight),
  };
}

/**
 * Deterministic bounded layered/compound layout for the relationship projection.
 *
 * BB packages a plugin frontend as one offline artifact, so the approved ELK
 * prototype imposed its full worker runtime on every Tasks page even when the
 * graph was never opened. This narrow layout keeps blocker-to-dependent ranks,
 * groups direct subtasks, and avoids that always-transferred runtime.
 */
export async function layoutRelationshipGraph(
  graph: RelationshipGraph,
  options: RelationshipLayoutOptions = {},
): Promise<RelationshipGraphLayout> {
  const layoutMetrics = metrics(options.compact ?? false);
  if (options.compact) {
    return verticalStackLayout(graph, layoutMetrics, true);
  }
  const layout = rightwardLayout(graph, layoutMetrics);
  return options.direction === "DOWN"
    ? transpose(layout, graph, layoutMetrics)
    : layout;
}
