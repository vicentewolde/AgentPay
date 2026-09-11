import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** The live-Postgres proof is separate so the ordinary workspace suite remains offline. */
export default defineConfig({
  resolve: {
    alias: {
      "@agentpass/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@agentpay/directory": fileURLToPath(new URL("../../packages/directory/src/index.ts", import.meta.url)),
      "@agentpay/vault": fileURLToPath(new URL("../../packages/vault/src/index.ts", import.meta.url)),
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
