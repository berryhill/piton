import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    // The HTML crawl does not enter geometry.worker.ts. Discovering Manifold
    // on its first worker request otherwise re-optimizes deps and reloads all
    // open pages, discarding in-progress interactions (even in other tabs).
    include: ["manifold-3d"],
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests-browser/setup.ts"],
    include: ["tests-browser/**/*.test.{ts,tsx}"],
    testTimeout: 15_000,
  },
});