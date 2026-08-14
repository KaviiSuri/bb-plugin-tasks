import { useState, type ComponentType, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../../shared/contract.js";
import { buildRelationshipGraph } from "./model.js";

const mocks = vi.hoisted(() => ({
  fitView: vi.fn(() => Promise.resolve(true)),
  layout: vi.fn(),
}));

vi.mock("./layout.js", () => ({
  layoutRelationshipGraph: mocks.layout,
}));

vi.mock("@xyflow/react", () => ({
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => children,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  getBezierPath: () => ["M0 0", 0, 0],
  useReactFlow: () => ({ fitView: mocks.fitView }),
  ReactFlow: ({
    nodes,
    edges,
    nodeTypes,
    onNodeClick,
    onNodeDoubleClick,
  }: {
    nodes: Array<Record<string, any>>;
    edges: Array<Record<string, any>>;
    nodeTypes: Record<string, ComponentType<any>>;
    onNodeClick: (event: unknown, node: Record<string, any>) => void;
    onNodeDoubleClick: (event: unknown, node: Record<string, any>) => void;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((node) => {
        const Node = nodeTypes[node.type];
        return (
          <div
            key={node.id}
            role={node.type === "task" ? "button" : undefined}
            className="react-flow__node"
            data-id={node.id}
            tabIndex={node.focusable ? 0 : -1}
            aria-label={node.ariaLabel}
            data-selected={node.selected ? "true" : "false"}
            onClick={(event) => onNodeClick(event, node)}
            onDoubleClick={(event) => onNodeDoubleClick(event, node)}
          >
            <Node id={node.id} data={node.data} selected={node.selected} />
          </div>
        );
      })}
      <svg aria-label="Rendered relationship edges">
        {edges.map((edge) => (
          <path
            key={edge.id}
            data-testid={`edge-${edge.id}`}
            data-kind={edge.data.relationship.kind}
            data-opacity={String(edge.style?.opacity ?? 1)}
            markerEnd={edge.markerEnd ? "url(#dependency-arrow)" : undefined}
          />
        ))}
      </svg>
    </div>
  ),
}));

const { RelationshipGraphCanvas, relationshipNodeAriaLabel } = await import(
  "./graph-canvas.js"
);

const project: Project = {
  id: "project",
  name: "Tasks",
  prefix: "TSK",
  nextTaskNumber: 5,
  color: "cornflowerblue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const task = (
  id: string,
  number: number,
  status: Task["status"] = "todo",
  parentTaskId: string | null = null,
): Task => ({
  id,
  projectId: project.id,
  number,
  key: `TSK-${number}`,
  title: `Task ${number}`,
  description: "",
  status,
  priority: "none",
  dueDate: null,
  parentTaskId,
  position: number,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  labelIds: [],
  isBlocked: false,
  unresolvedBlockerCount: 0,
});

const root = task("root", 1);
const child = task("child", 2, "todo", root.id);
const sibling = task("sibling", 3, "todo", root.id);
const blocker = task("blocker", 4, "done");
const graph = buildRelationshipGraph({
  root: { task: root, project },
  children: [
    { task: child, project },
    { task: sibling, project },
  ],
  dependencies: [
    {
      taskId: root.id,
      blockedBy: [{ task: blocker, project }],
      blocks: [],
    },
  ],
});

function CanvasHarness({
  compact = false,
  onOpenTask = () => {},
}: {
  compact?: boolean;
  onOpenTask?: (taskId: string) => void;
}) {
  const [selected, setSelected] = useState(root.id);
  return (
    <RelationshipGraphCanvas
      graph={graph}
      compact={compact}
      selectedTaskId={selected}
      onSelect={setSelected}
      onOpenTask={onOpenTask}
      fitRequest={0}
      interactive
      omittedNodeCount={0}
      omittedEdgeCount={0}
    />
  );
}

afterEach(cleanup);

beforeEach(() => {
  mocks.fitView.mockClear();
  mocks.layout.mockReset();
  mocks.layout.mockResolvedValue({
    positions: new Map([
      [root.id, { x: 0, y: 0 }],
      [child.id, { x: 100, y: 0 }],
      [sibling.id, { x: 100, y: 100 }],
      [blocker.id, { x: -100, y: 0 }],
    ]),
    group: null,
    width: 300,
    height: 200,
  });
});

describe("relationship graph canvas behavior", () => {
  it("names hierarchy and resolved dependency relationships to the root", () => {
    expect(relationshipNodeAriaLabel(graph, child.id)).toContain(
      "Subtask of TSK-1",
    );
    expect(relationshipNodeAriaLabel(graph, blocker.id)).toContain(
      "resolved dependency; blocks TSK-1",
    );
    expect(relationshipNodeAriaLabel(graph, root.id)).toContain("Root task");
  });

  it("renders arrows only for dependencies and keeps containment non-directional", async () => {
    render(<CanvasHarness />);
    await screen.findByRole("button", { name: /TSK-1:/ });
    const dependency = screen.getByTestId("edge-dependency:blocker:root");
    const containment = screen.getByTestId("edge-containment:root:child");
    expect(dependency.getAttribute("marker-end")).toContain("dependency-arrow");
    expect(containment.getAttribute("marker-end")).toBeNull();
  });

  it("scopes directional focus to the active canvas", async () => {
    render(
      <>
        <CanvasHarness />
        <CanvasHarness />
      </>,
    );
    const canvases = await screen.findAllByTestId("react-flow");
    const secondRoot = within(canvases[1]!).getByRole("button", {
      name: /TSK-1:/,
    });
    secondRoot.focus();
    fireEvent.keyDown(secondRoot, { key: "ArrowRight" });
    await waitFor(() =>
      expect(within(canvases[1]!).getByRole("button", { name: /TSK-2:/ })).toBe(
        document.activeElement,
      ),
    );
    expect(
      within(canvases[0]!).getByRole("button", { name: /TSK-2:/ }),
    ).not.toBe(document.activeElement);
  });

  it("opens or selects the actually focused node with O and Enter", async () => {
    const open = vi.fn();
    const view = render(<CanvasHarness onOpenTask={open} />);
    const childNode = await screen.findByRole("button", { name: /TSK-2:/ });
    childNode.focus();
    fireEvent.keyDown(childNode, { key: "O" });
    expect(open).toHaveBeenLastCalledWith(child.id);
    fireEvent.keyDown(childNode, { key: "Enter" });
    expect(childNode.dataset.selected).toBe("true");

    view.unmount();
    const select = vi.fn();
    render(
      <RelationshipGraphCanvas
        graph={graph}
        compact
        selectedTaskId={root.id}
        onSelect={select}
        onOpenTask={open}
        fitRequest={0}
        interactive
        omittedNodeCount={0}
        omittedEdgeCount={0}
      />,
    );
    const compactChild = await screen.findByRole("button", { name: /TSK-2:/ });
    compactChild.focus();
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(compactChild, { key: "Enter" });
    expect(open).toHaveBeenLastCalledWith(child.id);
  });

  it("fits without camera animation and opts node muting out of reduced motion", async () => {
    render(<CanvasHarness />);
    const rootNode = await screen.findByRole("button", { name: /TSK-1:/ });
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalled());
    mocks.fitView.mockClear();
    rootNode.focus();
    fireEvent.keyDown(rootNode, { key: "0" });
    expect(mocks.fitView).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 0 }),
    );
    expect(rootNode.innerHTML).toContain("motion-reduce:transition-none");
  });

  it("mutes nodes and edges unrelated to the focused task", async () => {
    render(<CanvasHarness />);
    const childNode = await screen.findByRole("button", { name: /TSK-2:/ });
    childNode.focus();
    await waitFor(() => expect(childNode.dataset.selected).toBe("true"));
    const siblingNode = screen.getByRole("button", { name: /TSK-3:/ });
    expect(siblingNode.innerHTML).toContain("opacity-35");
    expect(
      screen
        .getByTestId("edge-containment:root:sibling")
        .getAttribute("data-opacity"),
    ).toBe("0.3");
  });

  it("reports layout failures instead of leaving a focusable broken canvas", async () => {
    mocks.layout.mockRejectedValueOnce(new Error("layout exploded"));
    render(<CanvasHarness />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "layout exploded",
    );
    expect(screen.queryByTestId("react-flow")).toBeNull();
  });
});
