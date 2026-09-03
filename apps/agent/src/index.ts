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
  BAZAAR_USDC,
  BAZAAR_USDC_ISSUER,
  BAZAAR_VENUE_CONTRACT_ID,
  BAZAAR_VENUE_ID,
  createBazaarCatalog,
  type BazaarCatalogOptions,
} from "./catalog/bazaar.js";

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
  type CreatePurchaseIntentResult,
  type GetProductResult,
  type ListProductsResult,
  type WireProduct,
} from "./tools/agent-tools.js";

export {
  checkOwnCredential,
  type CredentialState,
  type CredentialVerifier,
  type UnusableCredential,
  type UsableCredential,
  type VerifiedOwnCredential,
} from "./credential/verifier.js";

export {
  checkOwnMandate,
  createOnChainMandateVerifier,
  type MandateState,
  type MandateVerifier,
  type UnusableMandate,
  type UsableMandate,
  type VerifiedOwnMandate,
} from "./mandate/verifier.js";

export {
  toCredentialReport,
  type ActiveCredentialReport,
  type CheckCredentialResult,
  type UnusableCredentialReport,
} from "./tools/agent-tools.js";

export { createAgent, type Agent, type AgentConfig } from "./agent.js";

export {
  AMOUNT_DECIMALS,
  fromScaledAmount,
  multiplyAmount,
  toScaledAmount,
} from "./scope/amount.js";

export {
  INTENT_CREATE_ACTION,
  checkScope,
  scopeError,
  type ScopeAllowed,
  type ScopeDecision,
  type ScopeDenied,
  type ScopeRejectionCode,
  type ScopeRequest,
} from "./scope/scope.js";

export {
  AGENTPAY_INTENT_FAMILY,
  AGENTPAY_INTENT_TYPE,
  DEFAULT_INTENT_TTL_SECONDS,
  intentAuthorisationSchema,
  intentCredentialRefSchema,
  intentPurchaseSchema,
  purchaseIntentSchema,
  type IntentAuthorisation,
  type IntentCredentialRef,
  type IntentPurchase,
  type PurchaseIntent,
} from "./intent/intent.js";

export {
  AGENTPAY_INTENT_TYP,
  intentHash,
  signIntent,
  verifyIntent,
  type SignedIntent,
  type VerifiedIntent,
  type VerifyIntentOptions,
} from "./intent/sign.js";

export { interpretPurchase, type PurchaseInterpretation } from "./interpret.js";

// T17 and T18 left these unexported: nothing outside the package needed them
// yet. PolicyRail changes that — `LocalPolicyRailDeps` names a `SpendLedger`,
// so a consumer that cannot see the type cannot build a rail at all.
export {
  checkMandate,
  mandateCheckError,
  type MandateAllowed,
  type MandateDecision,
  type MandateDenied,
  type MandateRejectionCode,
} from "./mandate/check-mandate.js";

export {
  checkDailyLimit,
  dailyLimitError,
  type DailyLimitAllowed,
  type DailyLimitDecision,
  type DailyLimitDenied,
  type DailyLimitRejectionCode,
} from "./ledger/check-daily-limit.js";

export {
  createInMemorySpendLedger,
  utcDayKey,
  type SpendLedger,
  type SpendLedgerEntry,
} from "./ledger/spend-ledger.js";

export {
  createLocalPolicyRail,
  policyRailError,
  type AuthorisationDecision,
  type AuthorisationGranted,
  type AuthorisationRefused,
  type AuthorisationRejectionCode,
  type AuthorisationRequest,
  type LocalPolicyRailDeps,
  type PolicyRail,
} from "./policy/policy-rail.js";

export {
  reconcileTerms,
  termsError,
  type PaymentTerms,
  type TermsDecision,
  type TermsDenied,
  type TermsRejectionCode,
} from "./policy/terms.js";
