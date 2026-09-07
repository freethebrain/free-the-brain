import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "client",
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
