import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
});
