import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agentpass/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@agentpay/directory": fileURLToPath(new URL("../directory/src/index.ts", import.meta.url)),
      "@agentpay/mandate": fileURLToPath(new URL("../mandate/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
