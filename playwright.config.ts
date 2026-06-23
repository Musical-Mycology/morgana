import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run seed:demo && npm run build && npm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...process.env, MORGANA_DATA_DIR: "./data" },
  },
  use: { baseURL: "http://localhost:3000" },
});
