import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "tsfm-sdk/chat": resolve(import.meta.dirname, "src/compat/index.js"),
      "tsfm-sdk/openai": resolve(import.meta.dirname, "src/compat/index.js"),
      "tsfm-sdk": resolve(import.meta.dirname, "src/index.js"),
    },
  },
  test: {
    coverage: {
      include: ["src/**"],
      exclude: ["src/index.ts", "src/bindings.ts", "src/compat/types.ts"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          globals: true,
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          globals: true,
          include: ["tests/integration/**/*.test.ts"],
          pool: "forks",
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
