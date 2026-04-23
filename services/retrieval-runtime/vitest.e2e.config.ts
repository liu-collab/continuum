import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    fileParallelism: false,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
