import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The live-database suite. Needs DATABASE_URL in .env.local — kept out of
// `pnpm test` so the fast suite stays fast and runnable without a Postgres.
// `fileParallelism: false` matters more here than in the vault: these tests
// allocate from a shared key-index sequence and assert on what they got.
export default defineConfig({
  resolve: {
    alias: {
      "@agentpass/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@agentpay/tenancy": fileURLToPath(new URL("../tenancy/src/index.ts", import.meta.url)),
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
