/**
 * `/v1/agents` — read-only in this alcance. `@agentpay/directory`'s
 * `AgentInstance` has a `keyIndex` (the SEP-0005 derivation index): it never
 * crosses this boundary — it names nothing a partner integrates against, and
 * the least a partner-facing API can expose about a key derivation scheme is
 * the index inside it.
 */
import { agentIdSchema, agentStatusSchema, onchainStateSchema, tenantIdSchema, type AgentInstance } from "@agentpay/directory";
import { stellarAddressSchema, stellarDidSchema } from "@agentpass/core";
import { z } from "zod";

export const agentResourceSchema = z.strictObject({
  id: agentIdSchema,
  tenant_id: tenantIdSchema,
  address: stellarAddressSchema,
  did: stellarDidSchema,
  label: z.string().max(200).nullable(),
  status: agentStatusSchema,
  onchain_state: onchainStateSchema,
  created_at: z.iso.datetime(),
});

export type AgentResource = z.infer<typeof agentResourceSchema>;

export function toAgentResource(agent: AgentInstance): AgentResource {
  return agentResourceSchema.parse({
    id: agent.id,
    tenant_id: agent.tenantId,
    address: agent.address,
    did: agent.did,
    label: agent.label,
    status: agent.status,
    onchain_state: agent.onchainState,
    created_at: agent.createdAt.toISOString(),
  });
}
