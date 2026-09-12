#![no_std]
//! `policy_rail` — PolicyRail's spending limits, enforced inside the same
//! transaction that moves the money.
//!
//! `M-12` asked whether a Soroban contract can stand in as the `payer` of an
//! x402 `exact`-scheme transfer at all — reading `@x402/stellar` and the
//! OpenZeppelin facilitator's source said yes, structurally. A minimal spike
//! (verify one Ed25519 signature, nothing else) then measured what that
//! costs against the facilitator's fee ceiling: 29 890 of 50 000 stroops,
//! with room to spare (`docs/fase-3-policyrail-mandato/evidencia/T22-spike.md`).
//! This is that spike, grown into what it was always meant to become: the
//! same two limits `LocalPolicyRail` (T19) enforces off-chain — `perTx` and
//! `perDay` — enforced instead by the network itself, atomically with the
//! transfer, with no window between checking and recording.
//!
//! **What this deliberately still is not.** It is not the Mandate. It knows
//! nothing about a venue allowlist, or an expiry window signed by anyone but
//! whoever deployed it. It enforces two numbers against one asset, the same
//! two numbers `checkDailyLimit` (T18) and `checkScope`'s `perTx` (T12)
//! already enforce off-chain — proving the on-chain path is real, not
//! replacing the Mandate's richer, off-chain-verified consent. `valid_until`
//! mirrors `M-7`'s "a mandate always has an end date," not the Mandate's full
//! validity-window semantics. It does know one thing about a principal, and
//! only one: which wallet owns the money in it (T57, `C-61`) — enough to hand
//! the balance back and to rotate the spending key, nothing more.
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short,
    token::TokenClient,
    Address, Bytes, BytesN, Env, Symbol, TryIntoVal, Vec,
};

/// Bumped whenever the persistent storage layout changes incompatibly.
pub const STORAGE_SCHEMA_VERSION: u32 = 1;

const LEDGERS_PER_DAY: u32 = 17_280; // ~5s per ledger, same estimate agent-registry uses
const INSTANCE_TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
const INSTANCE_TTL_EXTEND_TO: u32 = 90 * LEDGERS_PER_DAY;

/// `SpentOn(day)` only ever needs to answer for the day it names — nothing
/// reads yesterday's entry once today's exists. Bumping a brand-new entry's
/// TTL is what a Soroban `extend_ttl` actually charges rent for (extending
/// one that is already past its threshold is next to free); giving this
/// short-lived counter the same 90-day horizon as `Config` — which lives for
/// the rail's entire `valid_until` window — measured at ~154 000 stroops on
/// its own, alone enough to blow the facilitator's 50 000-stroop ceiling
/// (`docs/fase-3-policyrail-mandato/evidencia/T22-spike.md` §9). A window
/// this data actually needs is both more correct and, empirically, the
/// entire difference between fitting under that ceiling and not.
const SPEND_ENTRY_TTL_THRESHOLD: u32 = LEDGERS_PER_DAY / 2;
const SPEND_ENTRY_TTL_EXTEND_TO: u32 = 2 * LEDGERS_PER_DAY;

/// UTC day boundary, same convention `utcDayKey()` uses off-chain
/// (`apps/agent/src/ledger/spend-ledger.ts`) — "today" means the same thing
/// on-chain and off, no matter which clock is asking.
const SECONDS_PER_DAY: u64 = 86_400;

const TRANSFER_FN: Symbol = symbol_short!("transfer");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum Error {
    /// The contract was deployed without an owner key. Should be unreachable.
    NotInitialized = 1,
    /// `__check_auth` received a signature count other than exactly one, or
    /// one from a key other than the stored owner's.
    UnknownSigner = 2,
    /// `valid_until` was not in the future at construction time.
    AlreadyExpired = 3,
    /// `per_tx` or `per_day` was zero or negative.
    InvalidLimit = 4,
    /// The current ledger time is past `valid_until`.
    Expired = 5,
    /// The authorization covers something other than exactly one call to
    /// this contract's own asset's `transfer`, with this contract as `from`.
    /// Deliberately one error for every shape of mismatch: what was being
    /// authorized does not matter once it is established that it was not
    /// the one thing this account is allowed to authorise.
    UnexpectedInvocation = 6,
    /// The transfer amount exceeds `per_tx`.
    PerTxExceeded = 7,
    /// Today's cumulative spend, plus this transfer, would exceed `per_day`.
    PerDayExceeded = 8,
    /// `withdraw` was asked to move zero or a negative amount.
    InvalidWithdrawAmount = 9,
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

/// Everything `__check_auth` needs to know that never changes after deploy,
/// as one entry instead of five. Reading five separate instance keys measured
/// meaningfully more expensive than reading this struct once — a Soroban
/// storage read costs real ledger I/O regardless of how small the value is,
/// so the number of *keys* touched matters as much as the bytes moved.
#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub owner: BytesN<32>,
    /// The wallet that funds this rail and has the last word over it. Unlike
    /// `owner` — a raw Ed25519 key checked by this contract's own
    /// `__check_auth` — this is an ordinary Stellar `Address`, authorised by
    /// Soroban's own `require_auth()`. Two separate authorities on purpose:
    /// the agent's delegated key spends day to day, the principal's wallet
    /// takes the money back or rotates that key, and neither can do the
    /// other's job. See `docs/fase-6-agentguard-comercializacion/DECISIONES.md`
    /// → `C-61`.
    pub principal: Address,
    pub asset: Address,
    pub per_tx: i128,
    pub per_day: i128,
    pub valid_until: u64,
}

#[contracttype]
pub enum DataKey {
    Config,
    /// Keyed by UTC day index (`timestamp / SECONDS_PER_DAY`) — the on-chain
    /// twin of `SpendLedger`'s per-day entries (T18), except there is no
    /// separate `record()` step: checking and recording are the same write.
    SpentOn(u64),
}

#[contract]
pub struct PolicyRail;

#[contractimpl]
impl PolicyRail {
    /// `owner` is the raw Ed25519 key that authorizes on this account's
    /// behalf — not a Stellar `Address`. `__check_auth` verifies a signature
    /// over exactly these 32 bytes; a G-account's `Address` isn't one, and
    /// nothing here needs it to be.
    ///
    /// `principal` is the other half of that split, and an ordinary Stellar
    /// `Address` rather than a raw key: the wallet that funds this rail, and
    /// the only one that can take the balance back out (`withdraw`) or point
    /// `owner` at a different spending key (`set_owner`). Fixed once here,
    /// like everything else in `Config` — a rail that could be re-pointed at
    /// a new principal after deploy would hand whoever could do that the
    /// funds.
    ///
    /// `asset` pins this rail to a single SEP-41 token contract — the same
    /// simplification `M-14` already made off-chain (comparing against one
    /// asset, not a list). Supporting more than one asset would need a set
    /// in storage instead of a single value; deferred until something
    /// actually needs it.
    pub fn __constructor(
        env: Env,
        owner: BytesN<32>,
        principal: Address,
        asset: Address,
        per_tx: i128,
        per_day: i128,
        valid_until: u64,
    ) -> Result<(), Error> {
        if per_tx <= 0 || per_day <= 0 {
            return Err(Error::InvalidLimit);
        }
        if valid_until <= env.ledger().timestamp() {
            return Err(Error::AlreadyExpired);
        }

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                owner,
                principal,
                asset,
                per_tx,
                per_day,
                valid_until,
            },
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
        Ok(())
    }

    pub fn schema_version(_env: Env) -> u32 {
        STORAGE_SCHEMA_VERSION
    }

    fn config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    pub fn owner(env: Env) -> Result<BytesN<32>, Error> {
        Ok(Self::config(&env)?.owner)
    }

    pub fn principal(env: Env) -> Result<Address, Error> {
        Ok(Self::config(&env)?.principal)
    }

    pub fn asset(env: Env) -> Result<Address, Error> {
        Ok(Self::config(&env)?.asset)
    }

    pub fn per_tx(env: Env) -> Result<i128, Error> {
        Ok(Self::config(&env)?.per_tx)
    }

    pub fn per_day(env: Env) -> Result<i128, Error> {
        Ok(Self::config(&env)?.per_day)
    }

    pub fn valid_until(env: Env) -> Result<u64, Error> {
        Ok(Self::config(&env)?.valid_until)
    }

    /// What has already been spent on the UTC day `day` falls in. Read-only,
    /// mirrors `SpendLedger.spentOn()` (T18) — zero, not an error, for a day
    /// nothing was ever recorded against.
    pub fn spent_on(env: Env, day: u64) -> i128 {
        env.storage()
            .temporary()
            .get(&DataKey::SpentOn(day))
            .unwrap_or(0)
    }

    /// Moves `amount` of this rail's asset out to `to`, on the principal's
    /// say-so. The escape hatch `G9` said was missing: before this existed,
    /// funds that reached this contract could only ever leave through a
    /// payment the `owner` key signed — so a customer who funded a rail
    /// AgentPey held the `owner` key for could not get their own money back
    /// without AgentPey's cooperation.
    ///
    /// Gated by `config.principal.require_auth()` — Soroban's own mechanism
    /// for an ordinary `Address`, the same one every wallet signature in this
    /// project already goes through. Deliberately *not* `owner`/`__check_auth`:
    /// the whole point is that the key the agent holds cannot reach this.
    ///
    /// The `transfer` below does not re-enter `__check_auth`. `__check_auth`
    /// runs when something *outside* this contract asks this contract's
    /// address to authorise a call — the x402 payment path. Here this contract
    /// is the invoker, and Soroban authorises a `from` equal to
    /// `env.current_contract_address()` implicitly, as the caller of its own
    /// sub-invocation. That is also why `per_tx`/`per_day` do not apply: they
    /// are limits on what the *delegated key* may spend, not on the owner of
    /// the money taking it back.
    ///
    /// `valid_until` does not apply either, and that is the point rather than
    /// an oversight. A rail whose mandate has expired is exactly the rail
    /// whose balance most needs a way out; refusing here would recreate `G9`
    /// on a timer.
    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        let config = Self::config(&env)?;
        config.principal.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidWithdrawAmount);
        }

        TokenClient::new(&env, &config.asset).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
        Ok(())
    }

    /// Points `owner` — the key `__check_auth` accepts — at a different
    /// Ed25519 key, on the principal's say-so. The other half of `G9`: a
    /// delegated spending key that leaks, or an agent operator the principal
    /// no longer wants spending, can be cut off without moving the funds or
    /// redeploying the rail.
    ///
    /// No shape check on `new_owner` beyond being 32 bytes, for the same
    /// reason the constructor does none: any 32-byte value is a syntactically
    /// valid Ed25519 public key, and there is nothing here that could tell a
    /// typo from a key whose secret lives somewhere this contract cannot see.
    /// Setting an owner nobody can sign for stops payments, which is a strictly
    /// safer failure than the alternative — and `withdraw` still works.
    ///
    /// Rewrites the whole `Config`: it is one instance entry, so there is no
    /// cheaper partial write to make.
    pub fn set_owner(env: Env, new_owner: BytesN<32>) -> Result<(), Error> {
        let config = Self::config(&env)?;
        config.principal.require_auth();

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                owner: new_owner,
                ..config
            },
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
        Ok(())
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
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let config = Self::config(&env)?;

        if env.ledger().timestamp() > config.valid_until {
            return Err(Error::Expired);
        }

        // Exactly one signer, and it has to be the owner — no silent
        // tolerance for extra, unchecked signatures riding along.
        if signatures.len() != 1 {
            return Err(Error::UnknownSigner);
        }
        let sig = signatures.get_unchecked(0);
        if sig.public_key != config.owner {
            return Err(Error::UnknownSigner);
        }

        // Panics — aborting the whole invocation — on an invalid signature.
        // Same fail-closed direction as every other check in this project
        // (`B-1`), just enforced by the host instead of by a returned error:
        // `ed25519_verify` has no fallible return path to give one.
        let payload: Bytes = signature_payload.clone().into();
        env.crypto()
            .ed25519_verify(&sig.public_key, &payload, &sig.signature);

        // What is actually being authorised, not what a caller claims is
        // being authorised: `auth_contexts` is the host's own account of the
        // call tree this signature covers, the same guarantee `require_auth`
        // gives every other Soroban contract. One call, to this rail's own
        // asset, moving funds *from* this contract — anything else is a
        // shape this account was never meant to approve, `UnexpectedInvocation`
        // rather than a more specific reason: what it was does not matter
        // once it is established that it was not the one thing allowed.
        if auth_contexts.len() != 1 {
            return Err(Error::UnexpectedInvocation);
        }
        let Context::Contract(call) = auth_contexts.get_unchecked(0) else {
            return Err(Error::UnexpectedInvocation);
        };

        if call.contract != config.asset || call.fn_name != TRANSFER_FN || call.args.len() != 3 {
            return Err(Error::UnexpectedInvocation);
        }

        let from: Address = call
            .args
            .get_unchecked(0)
            .try_into_val(&env)
            .map_err(|_| Error::UnexpectedInvocation)?;
        if from != env.current_contract_address() {
            return Err(Error::UnexpectedInvocation);
        }

        let amount: i128 = call
            .args
            .get_unchecked(2)
            .try_into_val(&env)
            .map_err(|_| Error::UnexpectedInvocation)?;
        if amount <= 0 {
            return Err(Error::UnexpectedInvocation);
        }

        if amount > config.per_tx {
            return Err(Error::PerTxExceeded);
        }

        // The clock is this rail's own — `env.ledger().timestamp()` — never
        // anything the transfer's own arguments could carry, for the same
        // reason `M-16` keeps `LocalPolicyRail`'s day on the rail's clock:
        // there is no field here an attacker could backdate even if they
        // wanted to, but the discipline is the same fail-closed default.
        let day = env.ledger().timestamp() / SECONDS_PER_DAY;
        let spent_key = DataKey::SpentOn(day);
        let spent_before: i128 = env.storage().temporary().get(&spent_key).unwrap_or(0);
        let spent_after = spent_before
            .checked_add(amount)
            .ok_or(Error::PerDayExceeded)?;
        if spent_after > config.per_day {
            return Err(Error::PerDayExceeded);
        }

        // Checked, then — and only then — recorded. If anything above this
        // line had failed, execution never reaches here, and the whole
        // transaction (this write included) is rolled back by the host:
        // unlike `LocalPolicyRail`'s two-step consult-then-record (`M-15`),
        // there is no window between the two on-chain, because there is no
        // separate step.
        //
        // `temporary`, not `persistent`: this counter only ever needs to
        // answer for the UTC day it names, and Soroban's temporary storage
        // has no rent — a correctness match for data with a real expiry, and
        // measurably most of the difference between fitting under the
        // facilitator's fee ceiling and not (`evidencia/T22-spike.md` §9).
        env.storage().temporary().set(&spent_key, &spent_after);
        env.storage().temporary().extend_ttl(
            &spent_key,
            SPEND_ENTRY_TTL_THRESHOLD,
            SPEND_ENTRY_TTL_EXTEND_TO,
        );
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);

        // No event is published here, and that is a constraint from outside
        // this contract, not a preference: the x402 facilitator that settles
        // these payments requires *every* contract event a simulated payment
        // emits to be a token `transfer`, and rejects the payment outright
        // otherwise (`invalid_exact_stellar_payload_event_not_transfer`). An
        // audit event named anything else — as this contract published until
        // T31 — makes the rail unable to pay at all. What it recorded is not
        // lost: `spent_on(day)` answers the same question on demand, and the
        // token's own `transfer` event still records the payment. See
        // `docs/fase-5-mandatevault/DECISIONES.md` → `V-12`.

        Ok(())
    }
}

mod test;
