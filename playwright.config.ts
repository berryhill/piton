import { defineConfig } from "@playwright/test";

const port = Number(process.env.PITON_TEST_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid PITON_TEST_PORT");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests-browser/e2e",
  expect: { timeout: 15_000 },
  use: { baseURL },
  webServer: {
    // Exercise initial dependency discovery on every run, not only warm caches.
    command: `pnpm dev --port ${port} --strictPort --force`,
    url: baseURL,
    reuseExistingServer: false,
  },
});