import { AgentPassError } from "@agentpass/core";

/**
 * Marks a surface that is declared but not yet wired. Replaced task by task:
 * `issue()` and `verify()` land in T7, once the registry contract is deployed.
 */
export function notImplemented(surface: string): never {
  throw new AgentPassError("NotImplemented", `${surface} is not implemented yet`, {
    details: { surface },
  });
}

export async function issue(): Promise<never> {
  return notImplemented("issue");
}

export async function verify(): Promise<never> {
  return notImplemented("verify");
}

export async function revoke(): Promise<never> {
  return notImplemented("revoke");
}
