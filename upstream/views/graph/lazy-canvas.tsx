import { lazy } from "react";

/**
 * Defer React Flow and graph-canvas module evaluation until a graph is
 * actually visible. The plugin build is a single frontend artifact, so this
 * improves startup work rather than claiming a separate network chunk.
 */
export const LazyRelationshipGraphCanvas = lazy(async () => {
  const module = await import("./graph-canvas.js");
  return { default: module.RelationshipGraphCanvas };
});
