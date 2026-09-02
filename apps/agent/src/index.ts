/**
 * @agentpay/agent — the minimal purchasing agent (phase 2).
 *
 * It consumes AgentPass rather than extending it: identity, signing and
 * revocation all stay in `@agentpass/core` and `@agentpass/sdk`. What lives
 * here is what an agent does with a credential once it has one.
 */
export {
  parseProduct,
  priceSchema,
  productIdSchema,
  productNotFound,
  productSchema,
  type CatalogAdapter,
  type Price,
  type Product,
} from "./catalog/catalog.js";

export {
  ID_SEPARATOR,
  assetIdSchema,
  makeAssetId,
  makeVenueId,
  parseAssetId,
  parseVenueId,
  venueIdSchema,
  type AssetId,
  type ParsedAssetId,
  type ParsedVenueId,
  type VenueId,
} from "./catalog/ids.js";

export {
  EURC_MOCK,
  MOCK_PRODUCTS,
  MOCK_VENUE_CONTRACT_ID,
  MOCK_VENUE_ID,
  USDC_TESTNET,
  createMockCatalog,
  type MockCatalogOptions,
} from "./catalog/mock.js";

export {
  TOOL_NAMES,
  createToolSet,
  defineTool,
  isToolName,
  type ErasedTool,
  type Tool,
  type ToolDescriptor,
  type ToolName,
  type ToolSet,
} from "./tools/tool.js";

export {
  createAgentTools,
  type AgentToolsDeps,
  type CheckCredentialResult,
  type CreatePurchaseIntentResult,
  type GetProductResult,
  type ListProductsResult,
  type WireProduct,
} from "./tools/agent-tools.js";
