import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/real-user-experience.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
