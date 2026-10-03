import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['server/chat/**/*.test.ts'], testTimeout: 10_000 } });
