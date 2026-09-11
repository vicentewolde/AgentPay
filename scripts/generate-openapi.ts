/**
 * Generates the `/v1` OpenAPI contract from @agentpay/partner-api's frozen
 * Zod schemas. Run with `pnpm run generate:openapi`; do not edit its output.
 */
import {
  agentResourceSchema,
  consentSessionResourceSchema,
  createConsentSessionRequestSchema,
  createTenantRequestSchema,
  errorEnvelopeSchema,
  mandateResourceSchema,
  tenantResourceSchema,
} from "@agentpay/partner-api";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

const JSON_MEDIA_TYPE = "application/json";
const OUTPUT_PATH = resolve(import.meta.dirname, "../docs/api/openapi.yaml");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }) as JsonSchema;
}

function fieldSchema(schema: z.ZodType, field: string): JsonSchema {
  const jsonSchema = toJsonSchema(schema);
  const properties = jsonSchema.properties;
  if (!isRecord(properties) || !isRecord(properties[field])) {
    throw new Error(`Could not derive ${field} from its resource schema.`);
  }
  return properties[field];
}

function schemaRef(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonContent(schemaName: string): JsonSchema {
  return { content: { [JSON_MEDIA_TYPE]: { schema: schemaRef(schemaName) } } };
}

/** The static shape of `successEnvelope`; resource fields remain $refs. */
function successEnvelopeComponent(data: JsonSchema): JsonSchema {
  return {
    type: "object",
    properties: {
      ok: { type: "boolean", const: true },
      data,
    },
    required: ["ok", "data"],
    additionalProperties: false,
  };
}

const tenantSuccessSchema = successEnvelopeComponent(schemaRef("TenantResource"));
const agentListSuccessSchema = successEnvelopeComponent({ type: "array", items: schemaRef("AgentResource") });
const consentSessionSuccessSchema = successEnvelopeComponent(schemaRef("ConsentSessionResource"));
const mandateSuccessSchema = successEnvelopeComponent(schemaRef("MandateResource"));
const mandateListSuccessSchema = successEnvelopeComponent({ type: "array", items: schemaRef("MandateResource") });

const errorResponse = {
  description: "An error response.",
  ...jsonContent("ErrorEnvelope"),
};

const errorResponses = { "400": { $ref: "#/components/responses/ErrorResponse" } };

const bearerSecurity = [{ bearerAuth: [] }];
const idempotencyKeyParameter = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "A unique key for safely retrying this request.",
  schema: { type: "string", minLength: 1 },
};

const document = {
  openapi: "3.1.0",
  info: {
    title: "AgentPay Partner API",
    version: "0.1.0",
    description: "The testnet partner API. This contract is generated from @agentpay/partner-api Zod schemas.",
    license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  },
  servers: [
    {
      url: "/",
      description: "The base URL of your AgentPay testnet deployment.",
    },
  ],
  paths: {
    "/v1/tenants": {
      post: {
        operationId: "createTenant",
        summary: "Create a tenant",
        description: "Requires the tenants:write scope.",
        security: bearerSecurity,
        parameters: [idempotencyKeyParameter],
        requestBody: {
          required: true,
          content: { [JSON_MEDIA_TYPE]: { schema: schemaRef("CreateTenantRequest") } },
        },
        responses: {
          "201": { description: "The created tenant.", ...jsonContent("TenantSuccessResponse") },
          ...errorResponses,
        },
      },
    },
    "/v1/tenants/{id}": {
      get: {
        operationId: "getTenant",
        summary: "Get a tenant",
        description: "Requires the tenants:read scope.",
        security: bearerSecurity,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: fieldSchema(tenantResourceSchema, "id"),
          },
        ],
        responses: {
          "200": { description: "The tenant.", ...jsonContent("TenantSuccessResponse") },
          ...errorResponses,
        },
      },
    },
    "/v1/agents": {
      get: {
        operationId: "listAgents",
        summary: "List a tenant's agents",
        description: "Requires the agents:read scope.",
        security: bearerSecurity,
        parameters: [
          {
            name: "tenant_id",
            in: "query",
            required: true,
            schema: fieldSchema(agentResourceSchema, "tenant_id"),
          },
        ],
        responses: {
          "200": { description: "The tenant's agents.", ...jsonContent("AgentListSuccessResponse") },
          ...errorResponses,
        },
      },
    },
    "/v1/consent_sessions": {
      post: {
        operationId: "createConsentSession",
        summary: "Create a consent session",
        description: "Requires the consent_sessions:write scope.",
        security: bearerSecurity,
        parameters: [idempotencyKeyParameter],
        requestBody: {
          required: true,
          content: { [JSON_MEDIA_TYPE]: { schema: schemaRef("CreateConsentSessionRequest") } },
        },
        responses: {
          "201": { description: "The created consent session.", ...jsonContent("ConsentSessionSuccessResponse") },
          ...errorResponses,
        },
      },
    },
    "/v1/consent_sessions/{id}": {
      get: {
        operationId: "getConsentSession",
        summary: "Get a consent session",
        description: "Requires the consent_sessions:read scope.",
        security: bearerSecurity,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: fieldSchema(consentSessionResourceSchema, "id"),
          },
        ],
        responses: {
          "200": { description: "The consent session.", ...jsonContent("ConsentSessionSuccessResponse") },
          ...errorResponses,
        },
      },
    },
    "/v1/mandates/{id}": {
      get: {
        operationId: "getMandate",
        summary: "Get a mandate",
        description: "Requires the mandates:read scope.",
        security: bearerSecurity,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: fieldSchema(mandateResourceSchema, "id"),
          },
        ],
        responses: {
          "200": { description: "The mandate.", ...jsonContent("MandateSuccessResponse") },
          ...errorResponses,
        },
      },
    },
    "/v1/mandates": {
      get: {
        operationId: "listMandates",
        summary: "List a tenant's mandates",
        description: "Requires the mandates:read scope.",
        security: bearerSecurity,
        parameters: [
          {
            name: "tenant_id",
            in: "query",
            required: true,
            schema: fieldSchema(mandateResourceSchema, "tenant_id"),
          },
        ],
        responses: {
          "200": { description: "The tenant's mandates.", ...jsonContent("MandateListSuccessResponse") },
          ...errorResponses,
        },
      },
    },
  },
  components: {
    responses: {
      ErrorResponse: errorResponse,
    },
    schemas: {
      CreateTenantRequest: toJsonSchema(createTenantRequestSchema),
      TenantResource: toJsonSchema(tenantResourceSchema),
      AgentResource: toJsonSchema(agentResourceSchema),
      CreateConsentSessionRequest: toJsonSchema(createConsentSessionRequestSchema),
      ConsentSessionResource: toJsonSchema(consentSessionResourceSchema),
      MandateResource: toJsonSchema(mandateResourceSchema),
      ErrorEnvelope: toJsonSchema(errorEnvelopeSchema),
      TenantSuccessResponse: tenantSuccessSchema,
      AgentListSuccessResponse: agentListSuccessSchema,
      ConsentSessionSuccessResponse: consentSessionSuccessSchema,
      MandateSuccessResponse: mandateSuccessSchema,
      MandateListSuccessResponse: mandateListSuccessSchema,
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API key",
        description: "An AgentPay partner API key (`ap_test_...`).",
      },
    },
  },
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(
  OUTPUT_PATH,
  `# Generated by scripts/generate-openapi.ts. Do not edit manually.\n${stringify(document, { aliasDuplicateObjects: false })}`,
  "utf8",
);
console.log(`Generated ${OUTPUT_PATH}`);
