import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/memory-orchestrator-real-eval.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
