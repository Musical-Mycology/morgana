import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
  // tsconfig.json sets "jsx": "preserve" (Next.js handles the JSX transform in its own build),
  // and Vite (8.x, oxc-based) picks that up as the default oxc transform option too. Vitest has
  // no such external build step, so oxc must transform JSX itself here.
  oxc: { jsx: { runtime: "automatic" } },
});
