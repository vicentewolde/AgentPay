/**
 * Paying with `policy_rail` (T22) as the buyer — the smart account, not the
 * agent's classic (`G…`) account.
 *
 * `M-12`'s spike answered "can a `C…` account be the payer of an x402 `exact`
 * transfer?" by reading `@x402/stellar`, the facilitator and the Stellar SDK:
 * nothing on that path inspects or restricts the payer's address type. That
 * answer holds — but it is not the whole story, and this milestone found the
 * missing half by tracing the signing call chain in the installed SDK rather
 * than the types:
 *
 * `ExactStellarScheme.createPaymentPayload` signs via
 * `AssembledTransaction.signAuthEntries({ address, signAuthEntry, expiration })`,
 * whose internal callback always reduces a SEP-43 signer's answer to raw
 * signature bytes (`base64ToUint8Array(signedAuthEntry)`). `authorizeEntry`
 * then takes its "bare signature" branch, where the signing key is *derived
 * from the entry's own credential address* — `Keypair.fromPublicKey(
 * Address.fromScAddress(addrAuth.address).toString())`. For a contract
 * account that address is a `C…` strkey, which is not an Ed25519 public key:
 * it throws before any signature is verified. The stock client path is
 * therefore classic-account-only in practice, whatever the types allow.
 *
 * The escape hatch is public API, not a patch: `signAuthEntries` accepts an
 * `authorizeEntry` override, and `authorizeEntry` accepts a signing callback
 * that returns `{ signature, publicKey }` explicitly instead of a bare
 * signature. Down that branch the SDK builds
 * `scvVec([{ public_key: bytes32, signature: bytes64 }])` — field for field
 * the `Vec<Signature>` that `policy_rail`'s `__check_auth` expects (the shape
 * its docstring says it was chosen to match). So the owner's key signs the
 * same payload it would sign for a classic account, and the contract, not the
 * host's native check, decides whether it counts.
 *
 * Everything else about the payment is untouched: the same `AssembledTransaction`
 * against the same SEP-41 `transfer`, the same fee-sponsored facilitator flow,
 * the same `PaymentPayload` shape — this registers as one more
 * `SchemeNetworkClient`, so `x402Client` wraps it exactly as it wraps
 * `ExactStellarScheme`.
 */
import { AgentPassError } from "@agentpass/core";
import {
  Keypair,
  authorizeEntry,
  contract,
  nativeToScVal,
  rpc,
  type xdr,
} from "@stellar/stellar-sdk";
import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import {
  findDefaultAsset,
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
} from "@x402/stellar";

/** Which smart account pays, and whose key speaks for it. */
export interface PolicyRailPayer {
  /** The deployed `policy_rail` contract id (`C…`) — the `from` of the transfer. */
  readonly contractId: string;
  /**
   * The secret whose raw Ed25519 public key is the contract's stored `owner`.
   * `policy_rail` verifies a signature over exactly those 32 bytes; the
   * `G…` address around them is only how this codebase carries a keypair.
   */
  readonly ownerSecret: string;
}

function paymentError(message: string, details: Record<string, unknown>, cause?: unknown): AgentPassError {
  return new AgentPassError("NetworkError", message, { cause, details });
}

/**
 * `@x402/stellar` exports `handleSimulationResult` for exactly this, but it is
 * typed against its own bundled `@stellar/stellar-sdk@16.3.0`, and this
 * module's simulation comes from the repo's `17.0.1` — the same cross-package
 * mismatch `x402.ts` already sidesteps for signers. Six lines here cost less
 * than a cast that would silence a real type difference.
 */
function assertSimulationUsable(
  simulation: rpc.Api.SimulateTransactionResponse | undefined,
  details: Record<string, unknown>,
): void {
  if (simulation === undefined) {
    throw paymentError("the transfer from policy_rail was never simulated", details);
  }
  if (rpc.Api.isSimulationError(simulation)) {
    throw paymentError("simulating the transfer from policy_rail failed", {
      ...details,
      // `__check_auth`'s own error codes surface here — a `perTx`/`perDay`
      // refusal by the contract never reaches the network at all.
      error: simulation.error,
    });
  }
  if (rpc.Api.isSimulationRestore(simulation)) {
    throw paymentError("policy_rail's state has expired and needs restoring before it can pay", details);
  }
}

/**
 * Signs one authorization entry as `policy_rail`'s owner.
 *
 * Returns `{ signature, publicKey }` rather than bare bytes on purpose: that
 * is the only branch of {@link authorizeEntry} that does not try to read a
 * signing key out of the entry's own address, and the only one that produces
 * the `{ public_key, signature }` struct `__check_auth` decodes.
 */
export function authorizeAsPolicyRailOwner(
  owner: Keypair,
): (
  entry: xdr.SorobanAuthorizationEntry,
  _signer: unknown,
  validUntilLedgerSeq: number,
  networkPassphrase: string,
) => Promise<xdr.SorobanAuthorizationEntry> {
  return (entry, _signer, validUntilLedgerSeq, networkPassphrase) =>
    authorizeEntry(
      entry,
      // eslint-disable-next-line @typescript-eslint/require-await
      async (_preimage: unknown, payload: Uint8Array) => ({
        signature: owner.sign(Buffer.from(payload)),
        publicKey: owner.publicKey(),
      }),
      validUntilLedgerSeq,
      networkPassphrase,
    );
}

/**
 * The `exact` scheme, paid by a `policy_rail` smart account.
 *
 * Deliberately not a subclass of `ExactStellarScheme`: it shares the
 * transaction it builds, not the signing step, and the signing step is the
 * whole difference.
 */
export class PolicyRailStellarScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  /**
   * The same reverse lookup `ExactStellarScheme` registers. Without it
   * `x402Client`'s spend controls reject every challenge priced in USDC as an
   * unknown asset before this scheme is ever asked to build anything —
   * found by running the real payment, not by reading the interface.
   */
  readonly findDefaultAsset = findDefaultAsset;

  private readonly owner: Keypair;

  constructor(private readonly payer: PolicyRailPayer) {
    this.owner = Keypair.fromSecret(payer.ownerSecret);
  }

  /**
   * @throws AgentPassError `NetworkError` when the RPC is unreachable, the
   * simulation fails, or the signed transaction still reports a missing
   * signer — the last of which is what a mismatch between the deployed
   * contract's `owner` and `payer.ownerSecret` looks like from here.
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    const { network, payTo, asset, amount, maxTimeoutSeconds } = paymentRequirements;
    const networkPassphrase = getNetworkPassphrase(network);
    const rpcUrl = getRpcUrl(network);

    const rpcClient = getRpcClient(network);
    const [{ sequence }, ledgerSeconds] = await Promise.all([
      rpcClient.getLatestLedger(),
      getEstimatedLedgerCloseTimeSeconds(network),
    ]);
    const maxLedger = sequence + Math.ceil(maxTimeoutSeconds / ledgerSeconds);

    // Same call `ExactStellarScheme` makes, with the contract as `from`. No
    // `publicKey`: the source account stays the SDK's null account, because
    // the facilitator rebuilds and sponsors the envelope (T24).
    let tx: contract.AssembledTransaction<unknown>;
    try {
      tx = await contract.AssembledTransaction.build({
        contractId: asset,
        method: "transfer",
        args: [
          nativeToScVal(this.payer.contractId, { type: "address" }),
          nativeToScVal(payTo, { type: "address" }),
          nativeToScVal(amount, { type: "i128" }),
        ],
        networkPassphrase,
        rpcUrl,
        parseResultXdr: (result: unknown) => result,
        // Ask the RPC for legacy (v1) address credentials. This repo's
        // `@stellar/stellar-sdk@17` defaults to CAP-71 `…AddressV2`, which the
        // facilitator — built against `16.3.0` — cannot even parse: it answers
        // `invalid_exact_stellar_payload_malformed`, and would reject anything
        // but v1 credentials anyway. Found by paying for real and reading the
        // rejection, not from the types.
        useUpgradedAuth: false,
      });
    } catch (error) {
      throw paymentError("could not build the transfer from policy_rail", {
        contractId: this.payer.contractId,
        asset,
        payTo,
        amount,
      }, error);
    }
    assertSimulationUsable(tx.simulation, { contractId: this.payer.contractId, asset, payTo, amount });

    await tx.signAuthEntries({
      address: this.payer.contractId,
      expiration: maxLedger,
      authorizeEntry: authorizeAsPolicyRailOwner(this.owner),
    });

    // Simulating again with the signature in place is what prices
    // `__check_auth` into the fee the facilitator sees (`M-22` measured it at
    // 38 888 of the 50 000 stroops it allows). Existing auth entries survive:
    // `assembleTransaction` keeps them rather than taking the simulation's.
    await tx.simulate({ useUpgradedAuth: false });
    assertSimulationUsable(tx.simulation, { contractId: this.payer.contractId, asset, payTo, amount });

    const missing = tx.needsNonInvokerSigningBy();
    if (missing.length > 0) {
      throw paymentError("policy_rail's authorization did not take", {
        contractId: this.payer.contractId,
        stillNeedsSigningBy: missing,
        hint: "the deployed contract's owner is probably a different key than ownerSecret",
      });
    }

    return { x402Version, payload: { transaction: tx.built?.toXDR() ?? "" } };
  }
}
