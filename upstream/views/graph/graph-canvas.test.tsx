import { useState } from "react";
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
  zoom: vi.fn(() => 3),
  zoomToFit: vi.fn(),
  reheat: vi.fn(),
  graph2ScreenCoords: vi.fn((x: number, y: number) => ({ x, y })),
  chargeStrength: vi.fn(),
  chargeDistanceMin: vi.fn(),
  linkDistance: vi.fn(),
  linkStrength: vi.fn(),
  d3Force: vi.fn(),
}));

vi.mock("react-force-graph-2d", async () => {
  const React = await import("react");
  const MockForceGraph = React.forwardRef(function MockForceGraph(
    props: Record<string, any>,
    ref: React.ForwardedRef<Record<string, any>>,
  ) {
    React.useImperativeHandle(ref, () => ({
      zoom: mocks.zoom,
      zoomToFit: mocks.zoomToFit,
      d3ReheatSimulation: mocks.reheat,
      graph2ScreenCoords: mocks.graph2ScreenCoords,
      d3Force: mocks.d3Force,
    }));
    const data = props.graphData as {
      nodes: Array<Record<string, any>>;
      links: Array<Record<string, any>>;
    };
    return (
      <div data-testid="force-graph">
        <button data-testid="engine-stop" onClick={props.onEngineStop} />
        {data.nodes.map((node) => (
          <button
            key={node.id}
            data-testid={`canvas-node-${node.id}`}
            onMouseEnter={() => props.onNodeHover(node, null)}
            onMouseLeave={() => props.onNodeHover(null, node)}
            onClick={(event) => props.onNodeClick(node, event.nativeEvent)}
          >
            {node.entry.task.key}
          </button>
        ))}
        <svg aria-label="Rendered relationship edges">
          {data.links.map((link) => (
            <path
              key={link.id}
              data-testid={`edge-${link.id}`}
              data-kind={link.relationship.kind}
              data-width={String(props.linkWidth(link))}
              data-dash={JSON.stringify(props.linkLineDash(link))}
              data-arrow={String(props.linkDirectionalArrowLength(link))}
            />
          ))}
        </svg>
      </div>
    );
  });
  return { default: MockForceGraph };
});

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
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.d3Force.mockImplementation((name: string) => {
    if (name === "charge") {
      return {
        strength: mocks.chargeStrength,
        distanceMin: mocks.chargeDistanceMin,
      };
    }
    if (name === "link") {
      return {
        distance: mocks.linkDistance,
        strength: mocks.linkStrength,
      };
    }
    return undefined;
  });
});

describe("relationship force graph behavior", () => {
  it("names hierarchy and resolved dependency relationships to the root", () => {
    expect(relationshipNodeAriaLabel(graph, child.id)).toContain(
      "Subtask of TSK-1",
    );
    expect(relationshipNodeAriaLabel(graph, blocker.id)).toContain(
      "resolved dependency; blocks TSK-1",
    );
    expect(relationshipNodeAriaLabel(graph, root.id)).toContain("Root task");
  });

  it("renders arrows only for dependencies and distinguishes relationship lines", async () => {
    render(<CanvasHarness />);
    await screen.findByTestId("force-graph");
    const dependency = screen.getByTestId("edge-dependency:blocker:root");
    const containment = screen.getByTestId("edge-containment:root:child");
    expect(dependency.getAttribute("data-arrow")).toBe("4");
    expect(dependency.getAttribute("data-dash")).toBe("[7,5]");
    expect(containment.getAttribute("data-arrow")).toBe("0");
    expect(containment.getAttribute("data-dash")).toBe("[2,5]");
  });

  it("scopes directional keyboard focus to the active graph", async () => {
    render(
      <>
        <CanvasHarness />
        <CanvasHarness />
      </>,
    );
    const canvases = await screen.findAllByRole("application", {
      name: "Interactive task relationship graph",
    });
    const secondRoot = within(canvases[1]!).getByRole("button", {
      name: /TSK-1:/,
    });
    secondRoot.focus();
    fireEvent.keyDown(secondRoot, { key: "ArrowDown" });
    await waitFor(() =>
      expect(within(canvases[1]!).getByRole("button", { name: /TSK-2:/ })).toBe(
        document.activeElement,
      ),
    );
    expect(
      within(canvases[0]!).getByRole("button", { name: /TSK-2:/ }),
    ).not.toBe(document.activeElement);
  });

  it("opens or selects the focused node with O and Enter", async () => {
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

  it("configures force spacing and fits without camera animation", async () => {
    const view = render(<CanvasHarness />);
    await waitFor(() => expect(mocks.reheat).toHaveBeenCalled());
    expect(mocks.chargeStrength).toHaveBeenCalledWith(-420);
    expect(mocks.linkDistance).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.d3Force).toHaveBeenCalledWith(
      "label-collision",
      expect.any(Function),
    );

    view.rerender(
      <RelationshipGraphCanvas
        graph={graph}
        compact={false}
        selectedTaskId={root.id}
        onSelect={() => {}}
        onOpenTask={() => {}}
        fitRequest={1}
        interactive
        omittedNodeCount={0}
        omittedEdgeCount={0}
      />,
    );
    await waitFor(() => expect(mocks.zoomToFit).toHaveBeenCalledWith(0, 48));

    mocks.zoomToFit.mockClear();
    fireEvent.click(screen.getByTestId("engine-stop"));
    expect(mocks.zoomToFit).toHaveBeenCalledWith(0, 48);
    expect(mocks.zoom).toHaveBeenCalledWith(1.35, 0);
  });

  it("shows the full task card on hover and emphasizes connected links", async () => {
    render(<CanvasHarness />);
    const canvasNode = await screen.findByTestId("canvas-node-child");
    fireEvent.mouseEnter(canvasNode);
    expect((await screen.findByRole("tooltip")).textContent).toContain("Task 2");
    expect(
      screen.getByTestId("edge-containment:root:child").getAttribute("data-width"),
    ).toBe("1.8");
    expect(
      screen
        .getByTestId("edge-containment:root:sibling")
        .getAttribute("data-width"),
    ).toBe("0.8");
  });

  it("opens compact nodes on click and selects expanded nodes", async () => {
    const open = vi.fn();
    render(<CanvasHarness compact onOpenTask={open} />);
    fireEvent.click(await screen.findByTestId("canvas-node-child"));
    expect(open).toHaveBeenCalledWith(child.id);
  });
});
