import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-browser/e2e",
  expect: { timeout: 15_000 },
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "pnpm dev --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});