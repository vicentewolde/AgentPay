#![cfg(test)]
extern crate std;

use super::{Error, PolicyRail, Signature, STORAGE_SCHEMA_VERSION};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{
    auth::{Context, ContractContext},
    symbol_short,
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, IntoVal, InvokeError, Val, Vec,
};

const NOW: u64 = 1_772_000_000; // a fixed "now" so tests never depend on the clock
const DAY: u64 = 86_400;

fn generate_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

fn public_key_bytes(env: &Env, key: &SigningKey) -> BytesN<32> {
    BytesN::from_array(env, &key.verifying_key().to_bytes())
}

fn payload_bytes(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

struct Fixture {
    env: Env,
    contract_id: Address,
    owner_key: SigningKey,
    owner: BytesN<32>,
    asset: Address,
    per_tx: i128,
    per_day: i128,
    valid_until: u64,
}

impl Fixture {
    fn setup() -> Self {
        Self::with_limits(500_0000000, 2_000_0000000) // 500 / 2000, arbitrary units
    }

    fn with_limits(per_tx: i128, per_day: i128) -> Self {
        let env = Env::default();
        env.ledger().set_timestamp(NOW);
        let owner_key = generate_key();
        let owner = public_key_bytes(&env, &owner_key);
        let asset = Address::generate(&env);
        let valid_until = NOW + 30 * DAY;

        let contract_id = env.register(
            PolicyRail,
            (owner.clone(), asset.clone(), per_tx, per_day, valid_until),
        );

        Fixture {
            env,
            contract_id,
            owner_key,
            owner,
            asset,
            per_tx,
            per_day,
            valid_until,
        }
    }

    fn sign(&self, payload: &BytesN<32>) -> BytesN<64> {
        let signature = self.owner_key.sign(&payload.to_array());
        BytesN::from_array(&self.env, &signature.to_bytes())
    }

    fn signature_val_from(&self, public_key: &BytesN<32>, signature: &BytesN<64>) -> Val {
        let sig = Signature {
            public_key: public_key.clone(),
            signature: signature.clone(),
        };
        let sigs: Vec<Signature> = vec![&self.env, sig];
        sigs.into_val(&self.env)
    }

    /// The owner's real signature over `payload` — the normal case.
    fn signature_val(&self, payload: &BytesN<32>) -> Val {
        let signature = self.sign(payload);
        self.signature_val_from(&self.owner, &signature)
    }

    fn no_contexts(&self) -> Vec<Context> {
        vec![&self.env]
    }

    /// The one call shape this rail approves: `asset.transfer(this contract, to, amount)`.
    fn transfer_context(&self, to: &Address, amount: i128) -> Vec<Context> {
        vec![&self.env, self.context_calling(&self.asset, "transfer", to, amount)]
    }

    fn context_calling(
        &self,
        contract: &Address,
        fn_name: &str,
        to: &Address,
        amount: i128,
    ) -> Context {
        let args: Vec<Val> = vec![
            &self.env,
            self.contract_id.clone().into_val(&self.env),
            to.clone().into_val(&self.env),
            amount.into_val(&self.env),
        ];
        Context::Contract(ContractContext {
            contract: contract.clone(),
            fn_name: soroban_sdk::Symbol::new(&self.env, fn_name),
            args,
        })
    }

    fn check_auth(
        &self,
        payload: &BytesN<32>,
        sig_val: Val,
        contexts: Vec<Context>,
    ) -> Result<(), Result<Error, InvokeError>> {
        self.env
            .try_invoke_contract_check_auth::<Error>(&self.contract_id, payload, sig_val, &contexts)
    }

    fn authorise(&self, to: &Address, amount: i128, seed: u8) -> Result<(), Result<Error, InvokeError>> {
        let payload = payload_bytes(&self.env, seed);
        let sig_val = self.signature_val(&payload);
        self.check_auth(&payload, sig_val, self.transfer_context(to, amount))
    }

    fn spent_today(&self) -> i128 {
        let day = NOW / DAY;
        super::PolicyRailClient::new(&self.env, &self.contract_id).spent_on(&day)
    }
}

// ------------------------------------------------------------- configuration

#[test]
fn reports_the_configuration_it_was_deployed_with() {
    let f = Fixture::setup();
    let client = super::PolicyRailClient::new(&f.env, &f.contract_id);

    assert_eq!(STORAGE_SCHEMA_VERSION, 1);
    assert_eq!(client.schema_version(), STORAGE_SCHEMA_VERSION);
    assert_eq!(client.owner(), f.owner);
    assert_eq!(client.asset(), f.asset);
    assert_eq!(client.per_tx(), f.per_tx);
    assert_eq!(client.per_day(), f.per_day);
    assert_eq!(client.valid_until(), f.valid_until);
}

#[test]
fn a_zero_per_tx_limit_is_refused_at_deploy_time() {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    let owner = public_key_bytes(&env, &generate_key());
    let asset = Address::generate(&env);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(PolicyRail, (owner, asset, 0i128, 100i128, NOW + DAY))
    }));

    assert!(result.is_err(), "a zero per_tx must not deploy");
}

#[test]
fn a_valid_until_that_is_already_in_the_past_is_refused_at_deploy_time() {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    let owner = public_key_bytes(&env, &generate_key());
    let asset = Address::generate(&env);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(PolicyRail, (owner, asset, 100i128, 100i128, NOW - 1))
    }));

    assert!(result.is_err(), "an already-expired valid_until must not deploy");
}

// -------------------------------------------------------- the happy path

#[test]
fn a_transfer_within_both_limits_is_authorised_and_recorded() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);

    let result = f.authorise(&to, 100_0000000, 1);

    assert_eq!(result, Ok(()));
    assert_eq!(f.spent_today(), 100_0000000);
}

#[test]
fn spend_accumulates_across_authorisations_on_the_same_day() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);

    assert_eq!(f.authorise(&to, 100_0000000, 1), Ok(()));
    assert_eq!(f.authorise(&to, 50_0000000, 2), Ok(()));

    assert_eq!(f.spent_today(), 150_0000000);
}

// ------------------------------------------------------------------- perTx

#[test]
fn a_transfer_over_per_tx_is_refused_and_nothing_is_recorded() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);

    let result = f.authorise(&to, f.per_tx + 1, 1);

    assert_eq!(result, Err(Ok(Error::PerTxExceeded)));
    assert_eq!(f.spent_today(), 0, "a refused authorisation must not spend budget");
}

#[test]
fn a_transfer_of_exactly_per_tx_is_allowed() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);

    assert_eq!(f.authorise(&to, f.per_tx, 1), Ok(()));
}

// ------------------------------------------------------------------ perDay

#[test]
fn a_second_transfer_that_would_push_the_day_over_per_day_is_refused() {
    // 500 perTx, 2000 perDay: four transfers of 500 exhaust the day exactly;
    // a fifth of any size must be refused, even a single stroop.
    let f = Fixture::setup();
    let to = Address::generate(&f.env);

    for seed in 1..=4u8 {
        assert_eq!(f.authorise(&to, f.per_tx, seed), Ok(()));
    }
    assert_eq!(f.spent_today(), f.per_day);

    let result = f.authorise(&to, 1, 5);

    assert_eq!(result, Err(Ok(Error::PerDayExceeded)));
    assert_eq!(f.spent_today(), f.per_day, "the refused fifth transfer must not be recorded");
}

#[test]
fn the_day_resets_naturally_because_the_key_is_the_ledger_s_own_day() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    assert_eq!(f.authorise(&to, f.per_tx, 1), Ok(()));

    // Tomorrow, UTC — a fresh day, a fresh budget. Nothing about yesterday's
    // spend carries over, because `SpentOn(day)` is keyed by the day itself.
    f.env.ledger().set_timestamp(NOW + DAY);
    let tomorrow = f.authorise(&to, f.per_tx, 2);

    assert_eq!(tomorrow, Ok(()));
}

// ------------------------------------------------------------- expiration

#[test]
fn a_transfer_after_valid_until_is_refused_even_if_everything_else_is_correct() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    f.env.ledger().set_timestamp(f.valid_until + 1);

    let result = f.authorise(&to, 1, 1);

    assert_eq!(result, Err(Ok(Error::Expired)));
}

// ------------------------------------------------------- shape of the call

#[test]
fn no_auth_contexts_at_all_is_refused() {
    let f = Fixture::setup();
    let payload = payload_bytes(&f.env, 1);
    let sig_val = f.signature_val(&payload);

    let result = f.check_auth(&payload, sig_val, f.no_contexts());

    assert_eq!(result, Err(Ok(Error::UnexpectedInvocation)));
}

#[test]
fn more_than_one_auth_context_is_refused() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let payload = payload_bytes(&f.env, 1);
    let sig_val = f.signature_val(&payload);
    let one = f.transfer_context(&to, 10_0000000);
    let contexts: Vec<Context> = vec![&f.env, one.get_unchecked(0), one.get_unchecked(0)];

    let result = f.check_auth(&payload, sig_val, contexts);

    assert_eq!(result, Err(Ok(Error::UnexpectedInvocation)));
}

#[test]
fn a_call_to_a_contract_other_than_this_rail_s_asset_is_refused() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let a_different_token = Address::generate(&f.env);
    let payload = payload_bytes(&f.env, 1);
    let sig_val = f.signature_val(&payload);
    let contexts = vec![&f.env, f.context_calling(&a_different_token, "transfer", &to, 10_0000000)];

    let result = f.check_auth(&payload, sig_val, contexts);

    assert_eq!(result, Err(Ok(Error::UnexpectedInvocation)));
}

#[test]
fn a_call_to_a_function_other_than_transfer_is_refused() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let payload = payload_bytes(&f.env, 1);
    let sig_val = f.signature_val(&payload);
    let contexts = vec![&f.env, f.context_calling(&f.asset, "burn", &to, 10_0000000)];

    let result = f.check_auth(&payload, sig_val, contexts);

    assert_eq!(result, Err(Ok(Error::UnexpectedInvocation)));
}

#[test]
fn a_transfer_where_this_rail_is_not_the_source_is_refused() {
    // Someone else's transfer, on the rail's own asset — this account never
    // asked to authorise moving funds it is not the source of.
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let someone_else = Address::generate(&f.env);
    let payload = payload_bytes(&f.env, 1);
    let sig_val = f.signature_val(&payload);
    let args: Vec<Val> = vec![
        &f.env,
        someone_else.into_val(&f.env),
        to.into_val(&f.env),
        10_0000000i128.into_val(&f.env),
    ];
    let contexts = vec![
        &f.env,
        Context::Contract(ContractContext {
            contract: f.asset.clone(),
            fn_name: symbol_short!("transfer"),
            args,
        }),
    ];

    let result = f.check_auth(&payload, sig_val, contexts);

    assert_eq!(result, Err(Ok(Error::UnexpectedInvocation)));
}

#[test]
fn a_zero_amount_transfer_is_refused() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);

    let result = f.authorise(&to, 0, 1);

    assert_eq!(result, Err(Ok(Error::UnexpectedInvocation)));
}

// -------------------------------------------------------------- signer identity

#[test]
fn a_valid_signature_from_the_owner_is_accepted() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);

    assert_eq!(f.authorise(&to, 10_0000000, 1), Ok(()));
}

#[test]
fn a_signature_from_a_key_that_is_not_the_owner_is_rejected_without_touching_crypto() {
    // The stranger's signature is genuine — over the right payload, with a
    // real key — and still refused, because `public_key != owner` is checked
    // before `ed25519_verify` ever runs. A forged signer identity is caught
    // by comparison, not by a cryptographic failure that happens to also work.
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let stranger_key = generate_key();
    let stranger_public_key = public_key_bytes(&f.env, &stranger_key);
    let payload = payload_bytes(&f.env, 1);
    let stranger_signature = BytesN::from_array(&f.env, &stranger_key.sign(&payload.to_array()).to_bytes());
    let sig_val = f.signature_val_from(&stranger_public_key, &stranger_signature);

    let result = f.check_auth(&payload, sig_val, f.transfer_context(&to, 10_0000000));

    assert_eq!(result, Err(Ok(Error::UnknownSigner)));
}

#[test]
fn no_signatures_at_all_is_rejected() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let payload = payload_bytes(&f.env, 1);
    let empty: Vec<Signature> = vec![&f.env];
    let sig_val: Val = empty.into_val(&f.env);

    let result = f.check_auth(&payload, sig_val, f.transfer_context(&to, 10_0000000));

    assert_eq!(result, Err(Ok(Error::UnknownSigner)));
}

#[test]
fn more_than_one_signature_is_rejected_even_if_one_of_them_is_the_owner_s() {
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let payload = payload_bytes(&f.env, 1);
    let owner_signature = f.sign(&payload);
    let extra_key = generate_key();
    let extra_public_key = public_key_bytes(&f.env, &extra_key);
    let extra_signature = BytesN::from_array(&f.env, &extra_key.sign(&payload.to_array()).to_bytes());

    let sigs: Vec<Signature> = vec![
        &f.env,
        Signature {
            public_key: f.owner.clone(),
            signature: owner_signature,
        },
        Signature {
            public_key: extra_public_key,
            signature: extra_signature,
        },
    ];
    let sig_val: Val = sigs.into_val(&f.env);

    let result = f.check_auth(&payload, sig_val, f.transfer_context(&to, 10_0000000));

    assert_eq!(result, Err(Ok(Error::UnknownSigner)));
}

#[test]
fn a_tampered_signature_from_the_real_owner_key_is_refused_by_the_host_itself() {
    // The public key matches — this passes our own `UnknownSigner` check —
    // but the signature bytes don't correspond to this payload.
    // `ed25519_verify` has no fallible return of its own: the host aborts the
    // whole invocation, which `try_invoke_contract_check_auth` surfaces as
    // `InvokeError::Abort`, never as one of `Error`'s own variants. Same
    // fail-closed direction as everywhere else in this project (`B-1`), just
    // enforced by the host instead of a typed `Result`.
    let f = Fixture::setup();
    let to = Address::generate(&f.env);
    let payload = payload_bytes(&f.env, 1);
    let signed_a_different_payload = f.sign(&payload_bytes(&f.env, 2));
    let sig_val = f.signature_val_from(&f.owner, &signed_a_different_payload);

    let result = f.check_auth(&payload, sig_val, f.transfer_context(&to, 10_0000000));

    assert_eq!(result, Err(Err(InvokeError::Abort)));
}
