import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "tippy.js": "tippy.js/dist/tippy.esm.js",
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-tasks",
    testTimeout: 20_000,
    environment: "jsdom",
    setupFiles: ["./upstream/vitest.setup.ts"],
    include: [
      "upstream/dependencies.test.ts",
      "upstream/blocking.test.ts",
      "upstream/views/blocking/**/*.test.{ts,tsx}",
      "upstream/views/list/list-preference.test.ts",
    ],
    exclude: ["node_modules/**"],
    server: {
      deps: {
        inline: ["@tiptap/extension-bubble-menu"],
      },
    },
  },
});
