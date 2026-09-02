#![cfg(test)]

use super::{
    AgentRegistry, AgentRegistryClient, CredStatus, DataKey, Error, ENTRY_TTL_EXTEND_TO,
    INSTANCE_TTL_EXTEND_TO, LEDGERS_PER_DAY, STORAGE_SCHEMA_VERSION,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _, storage::Persistent as _, storage::Instance as _},
    vec, Address, BytesN, Env, IntoVal, Map, Symbol, Val,
};

const NOW: u64 = 1_772_000_000; // a fixed "now" so tests never depend on the clock
const HOUR: u64 = 3_600;

struct Fixture<'a> {
    env: Env,
    client: AgentRegistryClient<'a>,
    contract_id: Address,
    admin: Address,
    issuer: Address,
    subject: Address,
}

/// Auths are mocked by default; the auth tests below build their own env.
fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);

    let admin = Address::generate(&env);
    let contract_id = env.register(AgentRegistry, (admin.clone(),));
    let client = AgentRegistryClient::new(&env, &contract_id.clone());

    Fixture {
        issuer: Address::generate(&env),
        subject: Address::generate(&env),
        contract_id,
        env,
        client,
        admin,
    }
}

fn hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

impl Fixture<'_> {
    fn with_active_issuer(&self) -> &Self {
        self.client
            .register_issuer(&self.issuer, &hash(&self.env, 0xAA));
        self
    }
}

// ---------------------------------------------------------------- acceptance

#[test]
fn anchoring_a_credential_reads_active() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 1);

    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));

    assert_eq!(f.client.status(&cred), CredStatus::Active);
}

#[test]
fn revoking_a_credential_reads_revoked() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 2);
    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));

    f.client.revoke(&f.issuer, &cred);

    assert_eq!(f.client.status(&cred), CredStatus::Revoked);
}

#[test]
fn anchoring_without_the_issuer_s_authorisation_fails() {
    // No mock_all_auths: require_auth has nothing to satisfy it.
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    let admin = Address::generate(&env);
    let contract_id = env.register(AgentRegistry, (admin.clone(),));
    let client = AgentRegistryClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);

    env.mock_all_auths();
    client.register_issuer(&issuer, &hash(&env, 0xAA));
    env.set_auths(&[]);

    let outcome = client.try_anchor(&issuer, &hash(&env, 3), &subject, &(NOW + HOUR));

    assert!(outcome.is_err(), "an unauthorised anchor must not succeed");
    assert_eq!(client.status(&hash(&env, 3)), CredStatus::Unknown);
}

#[test]
fn anchoring_from_a_deactivated_issuer_fails() {
    let f = setup();
    f.with_active_issuer();
    f.client.deactivate_issuer(&f.issuer);
    let cred = hash(&f.env, 4);

    let outcome = f
        .client
        .try_anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));

    assert_eq!(outcome, Err(Ok(Error::IssuerInactive)));
    assert_eq!(f.client.status(&cred), CredStatus::Unknown);
}

#[test]
fn an_expiry_in_the_past_reads_expired() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 5);

    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW - HOUR));

    assert_eq!(f.client.status(&cred), CredStatus::Expired);
}

#[test]
fn an_unknown_hash_reads_unknown() {
    let f = setup();

    assert_eq!(f.client.status(&hash(&f.env, 0xFF)), CredStatus::Unknown);
}

// ------------------------------------------------------------------ the admin

#[test]
fn the_constructor_sets_the_admin_atomically_with_deployment() {
    let f = setup();

    assert_eq!(f.client.get_admin(), f.admin);
    assert_eq!(f.client.schema_version(), STORAGE_SCHEMA_VERSION);
}

#[test]
fn registering_an_issuer_without_admin_authorisation_fails() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(AgentRegistry, (admin,));
    let client = AgentRegistryClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);

    let outcome = client.try_register_issuer(&issuer, &hash(&env, 0xAA));

    assert!(outcome.is_err());
    assert!(client.get_issuer(&issuer).is_none());
}

#[test]
fn deactivating_an_issuer_without_admin_authorisation_fails() {
    let f = setup();
    f.with_active_issuer();
    f.env.set_auths(&[]);

    assert!(f.client.try_deactivate_issuer(&f.issuer).is_err());
    assert!(f.client.get_issuer(&f.issuer).unwrap().active);
}

#[test]
fn deactivating_an_unregistered_issuer_is_an_error() {
    let f = setup();

    assert_eq!(
        f.client.try_deactivate_issuer(&f.issuer),
        Err(Ok(Error::IssuerNotRegistered))
    );
}

#[test]
fn re_registering_reactivates_a_deactivated_issuer() {
    let f = setup();
    f.with_active_issuer();
    f.client.deactivate_issuer(&f.issuer);
    assert!(!f.client.get_issuer(&f.issuer).unwrap().active);

    f.client
        .register_issuer(&f.issuer, &hash(&f.env, 0xBB));

    assert!(f.client.get_issuer(&f.issuer).unwrap().active);
    assert_eq!(f.client.get_issuer(&f.issuer).unwrap().meta_hash, hash(&f.env, 0xBB));
}

// ---------------------------------------------------------------- anchoring

#[test]
fn anchoring_from_an_unregistered_issuer_fails() {
    let f = setup();
    let cred = hash(&f.env, 6);

    assert_eq!(
        f.client.try_anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR)),
        Err(Ok(Error::IssuerNotRegistered))
    );
}

#[test]
fn a_revoked_credential_can_never_be_reset_by_re_anchoring() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 7);
    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));
    f.client.revoke(&f.issuer, &cred);

    let outcome = f
        .client
        .try_anchor(&f.issuer, &cred, &f.subject, &(NOW + 10 * HOUR));

    assert_eq!(outcome, Err(Ok(Error::CredentialAlreadyAnchored)));
    assert_eq!(f.client.status(&cred), CredStatus::Revoked);
}

#[test]
fn the_stored_record_carries_issuer_subject_and_window() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 8);

    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));

    let record = f.client.get_credential(&cred).unwrap();
    assert_eq!(record.issuer, f.issuer);
    assert_eq!(record.subject, f.subject);
    assert_eq!(record.issued_at, NOW);
    assert_eq!(record.expires_at, NOW + HOUR);
    assert!(!record.revoked);
}

// ----------------------------------------------------------------- revoking

#[test]
fn only_the_anchoring_issuer_may_revoke() {
    let f = setup();
    f.with_active_issuer();
    let other = Address::generate(&f.env);
    f.client.register_issuer(&other, &hash(&f.env, 0xCC));
    let cred = hash(&f.env, 9);
    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));

    assert_eq!(
        f.client.try_revoke(&other, &cred),
        Err(Ok(Error::NotCredentialIssuer))
    );
    assert_eq!(f.client.status(&cred), CredStatus::Active);
}

#[test]
fn revoking_an_unknown_credential_is_an_error() {
    let f = setup();
    f.with_active_issuer();

    assert_eq!(
        f.client.try_revoke(&f.issuer, &hash(&f.env, 0xEE)),
        Err(Ok(Error::CredentialUnknown))
    );
}

#[test]
fn revoking_twice_is_idempotent() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 10);
    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));

    f.client.revoke(&f.issuer, &cred);
    f.client.revoke(&f.issuer, &cred);

    assert_eq!(f.client.status(&cred), CredStatus::Revoked);
}

#[test]
fn a_deactivated_issuer_can_still_revoke() {
    // Revocation is a safety operation. Losing it would be the wrong failure
    // direction, so deactivation deliberately does not remove it.
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 11);
    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));
    f.client.deactivate_issuer(&f.issuer);

    f.client.revoke(&f.issuer, &cred);

    assert_eq!(f.client.status(&cred), CredStatus::Revoked);
}

// ------------------------------------------------------------------- status

#[test]
fn revocation_outranks_expiry() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 12);
    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));
    f.client.revoke(&f.issuer, &cred);

    f.env.ledger().set_timestamp(NOW + 10 * HOUR);

    assert_eq!(f.client.status(&cred), CredStatus::Revoked);
}

#[test]
fn the_expiry_boundary_is_inclusive_matching_the_off_chain_check() {
    let f = setup();
    f.with_active_issuer();
    let cred = hash(&f.env, 13);
    let expires_at = NOW + HOUR;
    f.client.anchor(&f.issuer, &cred, &f.subject, &expires_at);

    f.env.ledger().set_timestamp(expires_at);
    assert_eq!(f.client.status(&cred), CredStatus::Active);

    f.env.ledger().set_timestamp(expires_at + 1);
    assert_eq!(f.client.status(&cred), CredStatus::Expired);
}

// ------------------------------------------------------------------- events

#[test]
fn the_emitted_topics_are_exactly_the_specified_ones() {
    // `all()` returns the events of the most recent invocation, so each call is
    // asserted on its own.
    let f = setup();
    let meta = hash(&f.env, 0xAA);
    let cred = hash(&f.env, 14);
    let expires_at = NOW + HOUR;

    f.client.register_issuer(&f.issuer, &meta);
    assert_eq!(
        f.env.events().all(),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                (
                    symbol_short!("agentpass"),
                    symbol_short!("issuer_on"),
                    f.issuer.clone(),
                )
                    .into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [(symbol_short!("meta_hash"), meta.into_val(&f.env))],
                )
                .into_val(&f.env),
            ),
        ]
    );

    f.client.anchor(&f.issuer, &cred, &f.subject, &expires_at);
    assert_eq!(
        f.env.events().all(),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                (
                    symbol_short!("agentpass"),
                    symbol_short!("anchored"),
                    f.issuer.clone(),
                    f.subject.clone(),
                )
                    .into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [
                        (symbol_short!("cred_hash"), cred.clone().into_val(&f.env)),
                        (Symbol::new(&f.env, "expires_at"), expires_at.into_val(&f.env)),
                    ],
                )
                .into_val(&f.env),
            ),
        ]
    );

    f.client.revoke(&f.issuer, &cred);
    assert_eq!(
        f.env.events().all(),
        vec![
            &f.env,
            (
                f.contract_id.clone(),
                (
                    symbol_short!("agentpass"),
                    symbol_short!("revoked"),
                    f.issuer.clone(),
                )
                    .into_val(&f.env),
                Map::<Symbol, Val>::from_array(
                    &f.env,
                    [(symbol_short!("cred_hash"), cred.into_val(&f.env))],
                )
                .into_val(&f.env),
            ),
        ]
    );
}

// ---------------------------------------------------------------------- TTL

#[test]
fn anchoring_extends_the_ttl_of_the_persistent_entries() {
    // The brief is explicit about this: without extending the TTL the state is
    // archived and the deployment silently stops answering within weeks. This
    // test is the only thing standing between that comment and a real guarantee.
    let f = setup();
    f.env.ledger().set_max_entry_ttl(ENTRY_TTL_EXTEND_TO + LEDGERS_PER_DAY);
    f.with_active_issuer();
    let cred = hash(&f.env, 20);

    f.client.anchor(&f.issuer, &cred, &f.subject, &(NOW + HOUR));

    let (cred_ttl, issuer_ttl, instance_ttl) = f.env.as_contract(&f.contract_id, || {
        (
            f.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Cred(cred.clone())),
            f.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Issuer(f.issuer.clone())),
            f.env.storage().instance().get_ttl(),
        )
    });

    assert!(
        cred_ttl >= ENTRY_TTL_EXTEND_TO,
        "credential entry was not extended: {cred_ttl} < {ENTRY_TTL_EXTEND_TO}"
    );
    assert!(
        issuer_ttl >= ENTRY_TTL_EXTEND_TO,
        "issuer entry was not extended: {issuer_ttl} < {ENTRY_TTL_EXTEND_TO}"
    );
    assert!(
        instance_ttl >= INSTANCE_TTL_EXTEND_TO,
        "instance was not extended: {instance_ttl} < {INSTANCE_TTL_EXTEND_TO}"
    );
}

// A test that anchored a credential and read it back 60 days later used to live
// here. It was removed: with TTL extension entirely disabled it still passed,
// because the test environment does not simulate archival. The real guarantee
// is the get_ttl assertion above, plus verification against the live network
// once the contract is deployed.
