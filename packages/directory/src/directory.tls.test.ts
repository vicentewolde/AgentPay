import { afterEach, describe, expect, it, vi } from "vitest";

interface PoolOptions {
  readonly connectionString: string;
  readonly ssl: { readonly ca?: string; readonly rejectUnauthorized: boolean };
  readonly max: number;
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

import { createDirectory } from "./directory.js";

const originalPostgresCa = process.env.POSTGRES_CA_CERT;

afterEach(() => {
  pools.length = 0;
  if (originalPostgresCa === undefined) delete process.env.POSTGRES_CA_CERT;
  else process.env.POSTGRES_CA_CERT = originalPostgresCa;
});

describe("createDirectory TLS", () => {
  it("keeps the existing encrypted-but-unverified TLS behavior without a provider CA", async () => {
    delete process.env.POSTGRES_CA_CERT;

    const directory = await createDirectory({ connectionString: "postgres://test" });

    expect(pools).toHaveLength(1);
    expect(pools[0]?.ssl).toEqual({ rejectUnauthorized: false });
    await directory.close();
  });

  it("requires certificate verification when a provider CA is configured", async () => {
    process.env.POSTGRES_CA_CERT = "test provider CA";

    const directory = await createDirectory({ connectionString: "postgres://test" });

    expect(pools[0]?.ssl).toEqual({ ca: "test provider CA", rejectUnauthorized: true });
    await directory.close();
  });
});
