import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-browser/production",
  expect: { timeout: 15_000 },
  use: { baseURL: "http://127.0.0.1:4189" },
  webServer: {
    command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4189 --strictPort",
    url: "http://127.0.0.1:4189",
    reuseExistingServer: false,
  },
});
