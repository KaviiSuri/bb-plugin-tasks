/**
 * Build-time stand-in for the `@bb/plugin-sdk` package root.
 *
 * The host injects the real SDK into the SERVER bundle at runtime (esbuild
 * keeps `@bb/plugin-sdk` external there). The APP bundle has no such injection,
 * but upstream's `shared/contract.ts` is imported by both sides, so the app
 * build needs the one *value* it pulls from the root: `defineRpcContract`.
 *
 * Upstream's implementation is the identity function, and BB's own build inlines
 * it into app.js exactly the same way — verified against the shipped bundle:
 *   packages/plugin-sdk/dist/index.js -> function defineRpcContract(contract) { return contract; }
 *
 * Everything else upstream imports from the root (`BbPluginApi`) is type-only
 * and erased at build time.
 */
export function defineRpcContract<const Contract>(contract: Contract): Contract {
  return contract;
}
