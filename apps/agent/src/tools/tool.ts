/**
 * The agent's tool surface — and, more to the point, its boundary.
 *
 * What the agent can do is exactly what {@link ToolSet.list} returns. Invoking
 * happens by name against that same list, so a tool that is not in it cannot be
 * called at all: the failure is `UnknownTool`, not a refusal the model could
 * argue with. T11 makes the list depend on whether the agent's credential still
 * verifies, and that is the whole mechanism — authorisation is removed by the
 * tool ceasing to exist, never by asking the agent nicely in a prompt.
 *
 * Two consequences worth stating, because they are load-bearing:
 *
 *  - {@link TOOL_NAMES} is a literal union. A new tool cannot be *named*
 *    without editing this file, so the tool surface is checked by the
 *    compiler rather than by discipline.
 *  - A handler never sees unvalidated input. `invoke` parses through the tool's
 *    own zod schema first and fails with `InvalidToolInput` otherwise.
 */
import { AgentPassError } from "@agentpass/core";
import { z } from "zod";

/**
 * Every tool this agent will ever have. The phase spec started as "four
 * tools, nothing more"; `execute_payment` is the fifth, added deliberately
 * in `G-4` rather than by extending `create_purchase_intent` — a tool that
 * moves real money is its own decision, not a variant of one that only signs.
 * Making the names a literal union is how "exactly these, no more" survives
 * contact with later milestones.
 */
export const TOOL_NAMES = [
  "list_products",
  "get_product",
  "check_my_credential",
  "create_purchase_intent",
  "execute_payment",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/** How a tool is written. `Input` is whatever its schema parses to. */
export interface Tool<Input, Output> {
  readonly name: ToolName;
  /**
   * Shown to the model. Says what the tool does and what it refuses; never
   * carries an instruction that a catalogue's text could contradict.
   */
  readonly description: string;
  readonly input: z.ZodType<Input>;
  run(input: Input): Promise<Output>;
}

/**
 * A tool with its input type erased, so tools with different input shapes can
 * live in one list. Produced only by {@link defineTool}.
 */
export interface ErasedTool {
  readonly name: ToolName;
  readonly description: string;
  readonly input: z.ZodType<unknown>;
  run(input: unknown): Promise<unknown>;
}

/**
 * Erases a tool's input type for storage in a {@link ToolSet}.
 *
 * The one cast in this package: `run` is re-typed to accept `unknown`. It is
 * sound because {@link createToolSet} is the only caller of `run`, and it only
 * ever passes the output of `input.safeParse` — the very schema whose inferred
 * type `Input` is. Writing the array as `Tool<any, unknown>[]` instead would
 * spread `any` across every call site to avoid one localised cast here.
 */
export function defineTool<Input, Output>(tool: Tool<Input, Output>): ErasedTool {
  return {
    name: tool.name,
    description: tool.description,
    input: tool.input as z.ZodType<unknown>,
    run: (input: unknown): Promise<unknown> => tool.run(input as Input),
  };
}

/** A tool as it would be handed to a model: name, description, JSON Schema. */
export interface ToolDescriptor {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolSet {
  /** Exactly what the agent can do, in a stable order. */
  list(): readonly ToolDescriptor[];
  has(name: string): boolean;
  /**
   * Validates `rawInput` against the tool's schema, then runs it.
   *
   * @throws AgentPassError `UnknownTool` when the name is not in {@link list}.
   * @throws AgentPassError `InvalidToolInput` when the arguments do not match.
   */
  invoke(name: string, rawInput: unknown): Promise<unknown>;
}

function unknownTool(name: string, available: readonly ToolName[]): AgentPassError {
  return new AgentPassError("UnknownTool", `no tool named "${name}" is available`, {
    details: { requested: name, available: [...available] },
  });
}

function invalidToolInput(name: ToolName, error: z.ZodError): AgentPassError {
  return new AgentPassError("InvalidToolInput", `the arguments for "${name}" are not valid`, {
    cause: error,
    details: {
      tool: name,
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  });
}

/**
 * Builds a {@link ToolSet} over exactly the tools it is given.
 *
 * Which tools those are is the caller's decision — that is the seam T11 uses to
 * drop `create_purchase_intent` when the credential no longer verifies.
 *
 * @throws AgentPassError `ConfigError` if the same tool is registered twice.
 */
export function createToolSet(tools: readonly ErasedTool[]): ToolSet {
  const byName = new Map<ToolName, ErasedTool>();

  for (const tool of tools) {
    if (byName.has(tool.name)) {
      throw new AgentPassError("ConfigError", `tool "${tool.name}" is registered twice`, {
        details: { tool: tool.name },
      });
    }
    byName.set(tool.name, tool);
  }

  // Declaration order, not registration order, so the list a model sees does
  // not shift because a caller assembled the array differently.
  const ordered: readonly ErasedTool[] = TOOL_NAMES.flatMap((name) => {
    const tool = byName.get(name);
    return tool === undefined ? [] : [tool];
  });

  const descriptors: readonly ToolDescriptor[] = Object.freeze(
    ordered.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.input) as Record<string, unknown>,
    })),
  );

  const availableNames: readonly ToolName[] = ordered.map((tool) => tool.name);

  return {
    list(): readonly ToolDescriptor[] {
      return descriptors;
    },

    has(name: string): boolean {
      return isToolName(name) && byName.has(name);
    },

    async invoke(name: string, rawInput: unknown): Promise<unknown> {
      // The list is the boundary: an absent tool is unknown, not forbidden.
      if (!isToolName(name)) throw unknownTool(name, availableNames);

      const tool = byName.get(name);
      if (tool === undefined) throw unknownTool(name, availableNames);

      const parsed = tool.input.safeParse(rawInput);
      if (!parsed.success) throw invalidToolInput(name, parsed.error);

      return tool.run(parsed.data);
    },
  };
}
