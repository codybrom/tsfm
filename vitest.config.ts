import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "tsfm-sdk/chat": resolve(__dirname, "src/compat/index.js"),
      "tsfm-sdk": resolve(__dirname, "src/index.js"),
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
