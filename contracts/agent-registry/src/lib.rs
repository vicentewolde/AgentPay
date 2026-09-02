#![no_std]
//! AgentPass registry.
//!
//! Credentials never go on-chain. This contract stores only the SHA-256 of the
//! compact JWS, its status, and the set of authorised issuers.
//!
//! The full surface — `register_issuer`, `deactivate_issuer`, `anchor`,
//! `revoke`, `status` — lands in T5. This scaffold carries the storage schema
//! version only, so the workspace builds and `cargo test` is meaningful.

use soroban_sdk::{contract, contractimpl, Env};

/// Bumped whenever the persistent storage layout changes incompatibly.
pub const STORAGE_SCHEMA_VERSION: u32 = 1;

#[contract]
pub struct AgentRegistry;

#[contractimpl]
impl AgentRegistry {
    pub fn schema_version(_env: Env) -> u32 {
        STORAGE_SCHEMA_VERSION
    }
}

mod test;
