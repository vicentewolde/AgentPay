import { AgentPassError, hasErrorCode } from "@agentpass/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TOOL_NAMES, createToolSet, defineTool, isToolName, type ErasedTool } from "./tool.js";

function stub(name: (typeof TOOL_NAMES)[number], run?: (input: unknown) => unknown): ErasedTool {
  return defineTool({
    name,
    description: `stub for ${name}`,
    input: z.strictObject({ n: z.int().optional() }),
    async run(input: { n?: number }) {
      return run === undefined ? { ok: name, echoed: input } : run(input);
    },
  });
}

describe("TOOL_NAMES", () => {
  it("is exactly the five the project specifies, in order", () => {
    expect([...TOOL_NAMES]).toEqual([
      "list_products",
      "get_product",
      "check_my_credential",
      "create_purchase_intent",
      "execute_payment",
    ]);
  });

  it("narrows a string to a tool name", () => {
    expect(isToolName("get_product")).toBe(true);
    expect(isToolName("delete_everything")).toBe(false);
    expect(isToolName("")).toBe(false);
  });
});

describe("the tool list is the boundary", () => {
  /**
   * The property the whole phase rests on. A withheld tool is not "forbidden",
   * it is absent — there is nothing to argue with and nothing to persuade.
   * T11 withholds `create_purchase_intent` for a revoked credential; this
   * proves the mechanism works before there is a credential to revoke.
   */
  it("a tool left out of the set cannot be invoked", async () => {
    const withheld = createToolSet([stub("list_products"), stub("get_product")]);

    expect(withheld.list().map((tool) => tool.name)).toEqual(["list_products", "get_product"]);
    expect(withheld.has("create_purchase_intent")).toBe(false);

    await expect(withheld.invoke("create_purchase_intent", {})).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "UnknownTool"),
    );
  });

  it("names what is available in the error, so the gap is diagnosable", async () => {
    const withheld = createToolSet([stub("list_products")]);

    try {
      await withheld.invoke("create_purchase_intent", {});
      expect.unreachable("a withheld tool must not be invocable");
    } catch (error) {
      const details = (error as AgentPassError).details as {
        requested: string;
        available: string[];
      };
      expect(details.requested).toBe("create_purchase_intent");
      expect(details.available).toEqual(["list_products"]);
    }
  });

  it("rejects a name that is not a tool name at all", async () => {
    const set = createToolSet([stub("list_products")]);

    for (const name of ["delete_everything", "LIST_PRODUCTS", " list_products", ""]) {
      await expect(set.invoke(name, {})).rejects.toSatisfy((error: unknown) =>
        hasErrorCode(error, "UnknownTool"),
      );
    }
  });

  it("lists tools in declaration order, whatever order they were registered in", () => {
    const set = createToolSet([
      stub("create_purchase_intent"),
      stub("list_products"),
      stub("check_my_credential"),
    ]);

    expect(set.list().map((tool) => tool.name)).toEqual([
      "list_products",
      "check_my_credential",
      "create_purchase_intent",
    ]);
  });

  it("refuses to register the same tool twice", () => {
    try {
      createToolSet([stub("get_product"), stub("get_product")]);
      expect.unreachable("a duplicate registration must not be silently collapsed");
    } catch (error) {
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
    }
  });
});

describe("input validation", () => {
  it("a handler never sees unvalidated input", async () => {
    let seen: unknown = "never ran";
    const set = createToolSet([
      stub("get_product", (input) => {
        seen = input;
        return input;
      }),
    ]);

    await expect(set.invoke("get_product", { n: "not a number" })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidToolInput"),
    );
    expect(seen).toBe("never ran");
  });

  it("rejects unknown arguments rather than dropping them", async () => {
    const set = createToolSet([stub("get_product")]);

    await expect(set.invoke("get_product", { n: 1, extra: true })).rejects.toSatisfy(
      (error: unknown) => hasErrorCode(error, "InvalidToolInput"),
    );
  });

  it("names the offending argument in details", async () => {
    const set = createToolSet([stub("get_product")]);

    try {
      await set.invoke("get_product", { n: "x" });
      expect.unreachable("expected InvalidToolInput");
    } catch (error) {
      const details = (error as AgentPassError).details as {
        tool: string;
        issues: { path: string }[];
      };
      expect(details.tool).toBe("get_product");
      expect(details.issues.some((issue) => issue.path === "n")).toBe(true);
    }
  });

  it("passes the parsed value, not the raw one, to the handler", async () => {
    let seen: unknown;
    const set = createToolSet([
      stub("get_product", (input) => {
        seen = input;
        return null;
      }),
    ]);

    await set.invoke("get_product", { n: 7 });
    expect(seen).toEqual({ n: 7 });
  });
});

describe("descriptors", () => {
  it("carries a JSON Schema a model can be handed directly", () => {
    const set = createToolSet([stub("get_product")]);
    const [descriptor] = set.list();

    expect(descriptor?.name).toBe("get_product");
    expect(descriptor?.description).toBe("stub for get_product");
    expect(descriptor?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: { n: { type: "integer" } },
    });
  });

  it("returns a frozen list, so a caller cannot widen the boundary in place", () => {
    const set = createToolSet([stub("get_product")]);

    expect(Object.isFrozen(set.list())).toBe(true);
  });
});
