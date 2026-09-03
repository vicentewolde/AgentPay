#![no_std]
//! `policy_rail` — PolicyRail as a Soroban smart account. **Spike, T22.**
//!
//! `M-12` asked whether a Soroban contract can stand in as the `payer` of an
//! x402 `exact`-scheme transfer at all — reading `@x402/stellar` and the
//! OpenZeppelin facilitator's source said yes, structurally (see
//! `docs/fase-3-policyrail-mandato/evidencia/T22-spike.md`). What that
//! reading could not answer is whether a `__check_auth` with any logic of
//! its own fits under the facilitator's fixed fee ceiling
//! (`maxTransactionFeeStroops`, 50 000 stroops by default) — verifying a
//! signature costs real Soroban compute that a classic account's native
//! verification does not.
//!
//! This contract exists to measure that, and nothing more. `__check_auth`
//! does exactly what the network already does for free on a classic
//! account — verify one Ed25519 signature against a stored owner key — and
//! **no `perTx`/`perDay` enforcement**. That logic only earns its complexity
//! once this minimal version is proven to fit under the ceiling; adding it
//! before knowing that would be building the rest of a bridge whose first
//! span might not hold weight.
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    Bytes, BytesN, Env, Vec,
};

/// Bumped whenever the persistent storage layout changes incompatibly.
pub const STORAGE_SCHEMA_VERSION: u32 = 1;

const LEDGERS_PER_DAY: u32 = 17_280; // ~5s per ledger, same estimate agent-registry uses
const INSTANCE_TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
const INSTANCE_TTL_EXTEND_TO: u32 = 90 * LEDGERS_PER_DAY;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum Error {
    /// The contract was deployed without an owner key. Should be unreachable.
    NotInitialized = 1,
    /// `__check_auth` received a signature count other than exactly one, or
    /// one from a key other than the stored owner's.
    UnknownSigner = 2,
}

/// One signer's authorization over the payload the host asked to be checked.
///
/// Shape chosen to match, field for field, what `@stellar/stellar-sdk`'s own
/// `authorizeEntry()` helper builds when a client signer returns a raw
/// `{ signature, publicKey }` pair instead of a hand-built `ScVal` — the same
/// helper `@x402/stellar`'s `ExactStellarScheme` calls to sign the buyer's
/// authorization. A client that can already produce a classic-account
/// signature needs no new signing code to produce this one — only a
/// different `address` pointed at this contract.
#[contracttype]
#[derive(Clone)]
pub struct Signature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
pub enum DataKey {
    Owner,
}

#[contract]
pub struct PolicyRail;

#[contractimpl]
impl PolicyRail {
    /// `owner` is the raw Ed25519 key that authorizes on this account's
    /// behalf — not a Stellar `Address`. `__check_auth` verifies a signature
    /// over exactly these 32 bytes; a G-account's `Address` isn't one, and
    /// this spike has no consent logic that would need it to be.
    pub fn __constructor(env: Env, owner: BytesN<32>) {
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    pub fn schema_version(_env: Env) -> u32 {
        STORAGE_SCHEMA_VERSION
    }

    pub fn owner(env: Env) -> Result<BytesN<32>, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::NotInitialized)
    }
}

#[contractimpl]
impl CustomAccountInterface for PolicyRail {
    type Signature = Vec<Signature>;
    type Error = Error;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<Signature>,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let owner: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::NotInitialized)?;

        // Exactly one signer, and it has to be the owner — no silent
        // tolerance for extra, unchecked signatures riding along.
        if signatures.len() != 1 {
            return Err(Error::UnknownSigner);
        }
        let sig = signatures.get_unchecked(0);
        if sig.public_key != owner {
            return Err(Error::UnknownSigner);
        }

        // Panics — aborting the whole invocation — on an invalid signature.
        // Same fail-closed direction as every other check in this project
        // (`B-1`), just enforced by the host instead of by a returned error:
        // `ed25519_verify` has no fallible return path to give one.
        let payload: Bytes = signature_payload.into();
        env.crypto()
            .ed25519_verify(&sig.public_key, &payload, &sig.signature);

        Ok(())
    }
}

mod test;
