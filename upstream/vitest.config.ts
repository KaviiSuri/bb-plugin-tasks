import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // This repository vendors the plugin under upstream/ rather than running it
  // from BB's monorepo package directory. Anchor the existing package config
  // here so both environments resolve setup files and test globs identically.
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      // tippy.js (via @tiptap/extension-bubble-menu) only ships a CJS main;
      // point vitest at the ESM build so `import tippy` gets the function.
      "tippy.js": "tippy.js/dist/tippy.esm.js",
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-tasks",
    testTimeout: 20_000,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    server: {
      deps: {
        inline: ["@tiptap/extension-bubble-menu"],
      },
    },
  },
});
