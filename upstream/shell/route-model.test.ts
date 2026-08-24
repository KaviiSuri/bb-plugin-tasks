import { describe, expect, it } from "vitest";
import { parseTasksRoute, tasksRouteToSubPath } from "./route-model.js";

describe("relationship graph route", () => {
  it("round-trips root and graph settings", () => {
    const route = {
      kind: "graph" as const,
      taskKey: "TSK-9",
      depth: 2 as const,
      containment: true,
      dependencies: false,
      resolved: false,
    };
    expect(parseTasksRoute(tasksRouteToSubPath(route))).toEqual(route);
  });

  it("defaults graph links to the complete transitive blocker chain", () => {
    expect(parseTasksRoute("graph/TSK-9")).toMatchObject({
      depth: "all-blockers",
    });
  });

  it("never parses a graph with both relationship types disabled", () => {
    expect(
      parseTasksRoute(
        "graph/TSK-9?depth=1&containment=0&dependencies=0&resolved=1",
      ),
    ).toMatchObject({ containment: true, dependencies: true });
  });
});
