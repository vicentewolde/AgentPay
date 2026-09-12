import { afterEach, describe, expect, it, vi } from "vitest";

interface PoolOptions {
  readonly connectionString: string;
  readonly ssl: { readonly ca?: string; readonly rejectUnauthorized: boolean };
}

const pools = vi.hoisted((): PoolOptions[] => []);

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: PoolOptions) {
      pools.push(options);
    }

    async query() {
      return { rows: [] };
    }

    async end() {}
  },
}));

import { createPostgresMandateVault } from "./postgres-vault.js";

const originalPostgresCa = process.env.POSTGRES_CA_CERT;

afterEach(() => {
  pools.length = 0;
  if (originalPostgresCa === undefined) delete process.env.POSTGRES_CA_CERT;
  else process.env.POSTGRES_CA_CERT = originalPostgresCa;
});

describe("createPostgresMandateVault TLS", () => {
  it("keeps the existing encrypted-but-unverified TLS behavior without a provider CA", async () => {
    delete process.env.POSTGRES_CA_CERT;

    await createPostgresMandateVault({ connectionString: "postgres://test", tenantId: "tenant" });

    expect(pools).toHaveLength(1);
    expect(pools[0]?.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("requires certificate verification when a provider CA is configured", async () => {
    process.env.POSTGRES_CA_CERT = "test provider CA";

    await createPostgresMandateVault({ connectionString: "postgres://test", tenantId: "tenant" });

    expect(pools[0]?.ssl).toEqual({ ca: "test provider CA", rejectUnauthorized: true });
  });
});
