import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/memory-orchestrator-real-eval.test.ts", "tests/real-user-experience.test.ts", "tests/e2e/**"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
