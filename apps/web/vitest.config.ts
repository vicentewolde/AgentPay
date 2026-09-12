import { defineConfig } from "vitest/config";

// apps/web had no unit-testable logic until the wallet-connect signature
// check (T34) — everything before it was pure HTTP glue over already-tested
// packages. This covers just that: src/**/*.test.ts, nothing else.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The live-Postgres suite (T68) needs DATABASE_URL and stays out of the
    // default run — same split every other package with one already uses.
    exclude: ["src/**/*.integration.test.ts"],
    // apps/web is mostly HTTP glue over already-tested packages — it is
    // normal for it to have zero test files between the rare pieces of
    // pure logic (like T34's wallet signature check) that are worth one.
    passWithNoTests: true,
  },
});
