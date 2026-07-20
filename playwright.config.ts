import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Per-server seeded data dirs (created by scripts/prepare-standalone.sh via global-setup).
// Isolation kills the shared-./data contention that made the suite flaky under parallel workers.
const dataDir = (name: string) => resolve("./.e2e", name);

export default defineConfig({
  testDir: "./e2e",
  expect: { timeout: 15_000 },
  // CI gets retries against genuine infra hiccups; locally real flakes stay visible.
  retries: process.env.CI ? 2 : 0,
  // Builds once + copies standalone assets + seeds the three .e2e dirs before any server starts.
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      // Regular production server — runs ALL specs except the destructive library spec.
      command: "npm start",
      // Readiness gate: /api/decks returns 200 only once the data layer can serve decks.
      url: "http://localhost:3000/api/decks",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, MORGANA_DATA_DIR: dataDir("default") },
    },
    {
      // Standalone production server — the Docker/deploy target. Guards deck-loading.
      command: "node .next/standalone/server.js",
      url: "http://localhost:3100/api/decks",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, PORT: "3100", MORGANA_DATA_DIR: dataDir("standalone") },
    },
    {
      // Dedicated `next start` for the destructive library spec — its own data dir so
      // emptying the decks dir can never race another spec.
      command: "npm start -- --port 3200",
      url: "http://localhost:3200/api/decks",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, MORGANA_DATA_DIR: dataDir("library") },
    },
  ],
  projects: [
    { name: "default", testIgnore: /library\.spec\.ts/, use: { baseURL: "http://localhost:3000" } },
    { name: "standalone", testMatch: /editor\.spec\.ts/, use: { baseURL: "http://localhost:3100" } },
    { name: "library", testMatch: /library\.spec\.ts/, use: { baseURL: "http://localhost:3200" } },
  ],
});
