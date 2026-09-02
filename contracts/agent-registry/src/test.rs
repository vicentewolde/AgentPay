#![cfg(test)]

use super::{AgentRegistry, AgentRegistryClient, STORAGE_SCHEMA_VERSION};
use soroban_sdk::Env;

#[test]
fn reports_its_storage_schema_version() {
    let env = Env::default();
    let contract_id = env.register(AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &contract_id);

    assert_eq!(client.schema_version(), STORAGE_SCHEMA_VERSION);
}
