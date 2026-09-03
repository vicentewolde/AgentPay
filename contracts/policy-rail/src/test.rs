#![cfg(test)]

use super::{Error, PolicyRail, Signature, STORAGE_SCHEMA_VERSION};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{auth::Context, vec, Address, BytesN, Env, IntoVal, InvokeError, Val, Vec};

fn generate_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

fn public_key_bytes(env: &Env, key: &SigningKey) -> BytesN<32> {
    BytesN::from_array(env, &key.verifying_key().to_bytes())
}

fn payload_bytes(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn sign(env: &Env, key: &SigningKey, payload: &BytesN<32>) -> BytesN<64> {
    let signature = key.sign(&payload.to_array());
    BytesN::from_array(env, &signature.to_bytes())
}

fn signature_val(env: &Env, public_key: &BytesN<32>, signature: &BytesN<64>) -> Val {
    let sig = Signature {
        public_key: public_key.clone(),
        signature: signature.clone(),
    };
    let sigs: Vec<Signature> = vec![env, sig];
    sigs.into_val(env)
}

fn deploy(env: &Env, owner: &BytesN<32>) -> Address {
    env.register(PolicyRail, (owner.clone(),))
}

fn no_contexts(env: &Env) -> Vec<Context> {
    vec![env]
}

#[test]
fn reports_its_schema_version() {
    let env = Env::default();
    assert_eq!(STORAGE_SCHEMA_VERSION, 1);
    let owner = public_key_bytes(&env, &generate_key());
    let contract_id = deploy(&env, &owner);
    let client = super::PolicyRailClient::new(&env, &contract_id);

    assert_eq!(client.schema_version(), STORAGE_SCHEMA_VERSION);
    assert_eq!(client.owner(), owner);
}

#[test]
fn a_valid_signature_from_the_owner_is_accepted() {
    let env = Env::default();
    let key = generate_key();
    let owner = public_key_bytes(&env, &key);
    let contract_id = deploy(&env, &owner);

    let payload = payload_bytes(&env, 1);
    let signature = sign(&env, &key, &payload);
    let sig_val = signature_val(&env, &owner, &signature);

    let result = env.try_invoke_contract_check_auth::<Error>(
        &contract_id,
        &payload,
        sig_val,
        &no_contexts(&env),
    );

    assert_eq!(result, Ok(()));
}

#[test]
fn a_signature_from_a_key_that_is_not_the_owner_is_rejected_without_touching_crypto() {
    // The stranger's signature is genuine — over the right payload, with a
    // real key — and still refused, because `public_key != owner` is checked
    // before `ed25519_verify` ever runs. A forged signer identity is caught
    // by comparison, not by a cryptographic failure that happens to also work.
    let env = Env::default();
    let owner_key = generate_key();
    let owner = public_key_bytes(&env, &owner_key);
    let contract_id = deploy(&env, &owner);

    let stranger_key = generate_key();
    let stranger_public_key = public_key_bytes(&env, &stranger_key);
    let payload = payload_bytes(&env, 2);
    let stranger_signature = sign(&env, &stranger_key, &payload);
    let sig_val = signature_val(&env, &stranger_public_key, &stranger_signature);

    let result = env.try_invoke_contract_check_auth::<Error>(
        &contract_id,
        &payload,
        sig_val,
        &no_contexts(&env),
    );

    assert_eq!(result, Err(Ok(Error::UnknownSigner)));
}

#[test]
fn no_signatures_at_all_is_rejected() {
    let env = Env::default();
    let owner = public_key_bytes(&env, &generate_key());
    let contract_id = deploy(&env, &owner);
    let payload = payload_bytes(&env, 3);
    let empty: Vec<Signature> = vec![&env];
    let sig_val: Val = empty.into_val(&env);

    let result = env.try_invoke_contract_check_auth::<Error>(
        &contract_id,
        &payload,
        sig_val,
        &no_contexts(&env),
    );

    assert_eq!(result, Err(Ok(Error::UnknownSigner)));
}

#[test]
fn more_than_one_signature_is_rejected_even_if_one_of_them_is_the_owner_s() {
    // Not a real threat model yet — this account has one signer — but
    // silently accepting extra, unchecked signatures riding along with a
    // valid one is exactly the kind of gap that stops mattering only once
    // someone relies on it.
    let env = Env::default();
    let owner_key = generate_key();
    let owner = public_key_bytes(&env, &owner_key);
    let contract_id = deploy(&env, &owner);

    let payload = payload_bytes(&env, 4);
    let owner_signature = sign(&env, &owner_key, &payload);
    let extra_key = generate_key();
    let extra_public_key = public_key_bytes(&env, &extra_key);
    let extra_signature = sign(&env, &extra_key, &payload);

    let sigs: Vec<Signature> = vec![
        &env,
        Signature {
            public_key: owner.clone(),
            signature: owner_signature,
        },
        Signature {
            public_key: extra_public_key,
            signature: extra_signature,
        },
    ];
    let sig_val: Val = sigs.into_val(&env);

    let result = env.try_invoke_contract_check_auth::<Error>(
        &contract_id,
        &payload,
        sig_val,
        &no_contexts(&env),
    );

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
    let env = Env::default();
    let key = generate_key();
    let owner = public_key_bytes(&env, &key);
    let contract_id = deploy(&env, &owner);

    let payload = payload_bytes(&env, 5);
    let signed_a_different_payload = sign(&env, &key, &payload_bytes(&env, 6));
    let sig_val = signature_val(&env, &owner, &signed_a_different_payload);

    let result = env.try_invoke_contract_check_auth::<Error>(
        &contract_id,
        &payload,
        sig_val,
        &no_contexts(&env),
    );

    assert_eq!(result, Err(Err(InvokeError::Abort)));
}
