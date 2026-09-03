import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The live-network suite. Slow, stateful, and needs .env.local — kept out of
// `pnpm test` so the fast suite stays fast and runnable without keys.
export default defineConfig({
  resolve: {
    alias: {
      "@agentpass/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@agentpass/sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
