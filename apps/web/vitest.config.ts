import { defineConfig } from "vitest/config";

// apps/web had no unit-testable logic until the wallet-connect signature
// check (T34) — everything before it was pure HTTP glue over already-tested
// packages. This covers just that: src/**/*.test.ts, nothing else.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
