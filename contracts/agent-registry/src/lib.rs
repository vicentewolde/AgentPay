#![no_std]
//! AgentPass registry.
//!
//! Credentials never go on-chain. This contract stores only the SHA-256 of the
//! compact JWS, its status, and the set of authorised issuers. That is what
//! makes authorisation revocable from outside the agent: the principal calls
//! `revoke`, and every later verification fails. The agent cannot prevent it,
//! cannot detect it from its own state, and no prompt can undo it.

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env};

/// Bumped whenever the persistent storage layout changes incompatibly.
pub const STORAGE_SCHEMA_VERSION: u32 = 1;

const LEDGERS_PER_DAY: u32 = 17_280; // ~5s per ledger

/// Persistent entries are extended on every write. Without this the state is
/// archived and the deployment silently stops answering within weeks.
const ENTRY_TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
const ENTRY_TTL_EXTEND_TO: u32 = 90 * LEDGERS_PER_DAY;
const INSTANCE_TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
const INSTANCE_TTL_EXTEND_TO: u32 = 90 * LEDGERS_PER_DAY;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum Error {
    /// The contract was deployed without an admin. Should be unreachable.
    NotInitialized = 1,
    /// No issuer record exists for this address.
    IssuerNotRegistered = 2,
    /// The issuer exists but has been deactivated.
    IssuerInactive = 3,
    /// This credential hash is already anchored. Re-anchoring is refused so a
    /// revoked credential can never be reset to active.
    CredentialAlreadyAnchored = 4,
    /// No credential is anchored under this hash.
    CredentialUnknown = 5,
    /// The caller is not the issuer that anchored this credential.
    NotCredentialIssuer = 6,
}

#[contracttype]
#[derive(Clone)]
pub struct IssuerRecord {
    pub active: bool,
    pub meta_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct CredRecord {
    pub issuer: Address,
    pub subject: Address,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum CredStatus {
    Unknown,
    Active,
    Revoked,
    Expired,
}

/// Topics: `("agentpass", "anchored", issuer, subject)`.
#[contractevent(topics = ["agentpass", "anchored"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Anchored {
    #[topic]
    pub issuer: Address,
    #[topic]
    pub subject: Address,
    pub cred_hash: BytesN<32>,
    pub expires_at: u64,
}

/// Topics: `("agentpass", "revoked", issuer)`.
#[contractevent(topics = ["agentpass", "revoked"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Revoked {
    #[topic]
    pub issuer: Address,
    pub cred_hash: BytesN<32>,
}

/// Topics: `("agentpass", "issuer_on", issuer)`.
#[contractevent(topics = ["agentpass", "issuer_on"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerRegistered {
    #[topic]
    pub issuer: Address,
    pub meta_hash: BytesN<32>,
}

/// Topics: `("agentpass", "issuer_off", issuer)`.
#[contractevent(topics = ["agentpass", "issuer_off"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerDeactivated {
    #[topic]
    pub issuer: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Issuer(Address),
    Cred(BytesN<32>),
}

#[contract]
pub struct AgentRegistry;

#[contractimpl]
impl AgentRegistry {
    /// Runs atomically with deployment, so there is no window in which the
    /// contract exists without an admin.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    pub fn schema_version(_env: Env) -> u32 {
        STORAGE_SCHEMA_VERSION
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Registers, or re-activates, an issuer. Admin only.
    pub fn register_issuer(env: Env, issuer: Address, meta_hash: BytesN<32>) -> Result<(), Error> {
        Self::require_admin(&env)?;

        let key = DataKey::Issuer(issuer.clone());
        env.storage().persistent().set(
            &key,
            &IssuerRecord {
                active: true,
                meta_hash: meta_hash.clone(),
            },
        );
        Self::extend_entry(&env, &key);
        Self::extend_instance(&env);

        IssuerRegistered { issuer, meta_hash }.publish(&env);
        Ok(())
    }

    /// Deactivates an issuer. Admin only.
    ///
    /// Credentials already anchored keep their own status: deactivating an
    /// issuer stops new anchors, it does not retroactively revoke. The SDK
    /// checks both, which is why the third verification check reads
    /// "status is Active **and** the issuer is active".
    pub fn deactivate_issuer(env: Env, issuer: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;

        let key = DataKey::Issuer(issuer.clone());
        let mut record: IssuerRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::IssuerNotRegistered)?;

        record.active = false;
        env.storage().persistent().set(&key, &record);
        Self::extend_entry(&env, &key);
        Self::extend_instance(&env);

        IssuerDeactivated { issuer }.publish(&env);
        Ok(())
    }

    pub fn get_issuer(env: Env, issuer: Address) -> Option<IssuerRecord> {
        env.storage().persistent().get(&DataKey::Issuer(issuer))
    }

    /// Anchors a credential hash. Only an active, registered issuer may call.
    ///
    /// `expires_at` is stored as given and is deliberately **not** validated
    /// against the current time: anchoring an already-expired credential is
    /// legal, and `status` simply reports `Expired`.
    pub fn anchor(
        env: Env,
        issuer: Address,
        cred_hash: BytesN<32>,
        subject: Address,
        expires_at: u64,
    ) -> Result<(), Error> {
        issuer.require_auth();

        let issuer_key = DataKey::Issuer(issuer.clone());
        let record: IssuerRecord = env
            .storage()
            .persistent()
            .get(&issuer_key)
            .ok_or(Error::IssuerNotRegistered)?;
        if !record.active {
            return Err(Error::IssuerInactive);
        }

        let cred_key = DataKey::Cred(cred_hash.clone());
        if env.storage().persistent().has(&cred_key) {
            return Err(Error::CredentialAlreadyAnchored);
        }

        env.storage().persistent().set(
            &cred_key,
            &CredRecord {
                issuer: issuer.clone(),
                subject: subject.clone(),
                issued_at: env.ledger().timestamp(),
                expires_at,
                revoked: false,
            },
        );

        Self::extend_entry(&env, &cred_key);
        Self::extend_entry(&env, &issuer_key);
        Self::extend_instance(&env);

        Anchored {
            issuer,
            subject,
            cred_hash,
            expires_at,
        }
        .publish(&env);
        Ok(())
    }

    /// Revokes a credential. Only the issuer that anchored it may call.
    ///
    /// Deliberately still permitted for a **deactivated** issuer: revocation is
    /// a safety operation, and removing the ability to revoke would be the
    /// wrong failure direction. Idempotent — revoking twice is not an error and
    /// emits nothing the second time.
    pub fn revoke(env: Env, issuer: Address, cred_hash: BytesN<32>) -> Result<(), Error> {
        issuer.require_auth();

        let cred_key = DataKey::Cred(cred_hash.clone());
        let mut record: CredRecord = env
            .storage()
            .persistent()
            .get(&cred_key)
            .ok_or(Error::CredentialUnknown)?;

        if record.issuer != issuer {
            return Err(Error::NotCredentialIssuer);
        }
        if record.revoked {
            return Ok(());
        }

        record.revoked = true;
        env.storage().persistent().set(&cred_key, &record);
        Self::extend_entry(&env, &cred_key);
        Self::extend_instance(&env);

        Revoked { issuer, cred_hash }.publish(&env);
        Ok(())
    }

    /// Revocation outranks expiry: a credential that is both reads `Revoked`,
    /// because that is the stronger statement about it.
    ///
    /// The boundary is inclusive — at exactly `expires_at` the credential is
    /// still `Active` — matching `validUntil` in the off-chain check.
    pub fn status(env: Env, cred_hash: BytesN<32>) -> CredStatus {
        let Some(record) = env
            .storage()
            .persistent()
            .get::<DataKey, CredRecord>(&DataKey::Cred(cred_hash))
        else {
            return CredStatus::Unknown;
        };

        if record.revoked {
            return CredStatus::Revoked;
        }
        if record.expires_at < env.ledger().timestamp() {
            return CredStatus::Expired;
        }
        CredStatus::Active
    }

    pub fn get_credential(env: Env, cred_hash: BytesN<32>) -> Option<CredRecord> {
        env.storage().persistent().get(&DataKey::Cred(cred_hash))
    }

    fn require_admin(env: &Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    fn extend_entry(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND_TO);
    }

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }
}

mod test;
