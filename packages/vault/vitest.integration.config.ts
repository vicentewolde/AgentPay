import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The live-database suite. Needs DATABASE_URL in .env.local — kept out of
// `pnpm test` so the fast suite stays fast and runnable without a Postgres.
export default defineConfig({
  resolve: {
    alias: {
      "@agentpass/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
