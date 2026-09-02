import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolve workspace siblings straight to their sources so tests never depend on
// a prior `tsc -b`. Production resolution still goes through dist/ via exports.
export default defineConfig({
  resolve: {
    alias: {
      "@agentpass/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
