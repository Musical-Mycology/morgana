import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Absolute, seeded data dir shared by both servers.
const DATA_DIR = resolve("./data");

export default defineConfig({
  testDir: "./e2e",
  expect: { timeout: 15_000 },
  // Builds once + copies standalone assets before either server starts.
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      // Regular production server — exercises ALL e2e specs.
      command: "npm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, MORGANA_DATA_DIR: DATA_DIR },
    },
    {
      // Standalone production server — the Docker/deploy target. Guards deck-loading.
      command: "node .next/standalone/server.js",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, PORT: "3100", MORGANA_DATA_DIR: DATA_DIR },
    },
  ],
  projects: [
    { name: "default", use: { baseURL: "http://localhost:3000" } },
    { name: "standalone", use: { baseURL: "http://localhost:3100" }, testMatch: /editor\.spec\.ts/ },
  ],
});
