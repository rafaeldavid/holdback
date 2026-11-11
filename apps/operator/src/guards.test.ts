// Hard rule "no real money": the operator refuses to start with a live Stripe key or off a test chain.
// Chain IDs are an allowlist (local chains and named testnets), so an unknown mainnet fails closed.
import { MAINNET_CHAIN_IDS as CORE_MAINNET_CHAIN_IDS } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { MAINNET_CHAIN_IDS, startupGuards, TEST_CHAIN_IDS } from './guards.js';

describe('startup guards: Stripe keys', () => {
  it('starts with no Stripe key, or with test keys', () => {
    expect(() => startupGuards({ env: {}, chainId: 31337 })).not.toThrow();
    expect(() => startupGuards({ env: { STRIPE_SECRET_KEY: 'sk_test_abc' }, chainId: 84532 })).not.toThrow();
  });

  it.each(['sk_live_abc', 'rk_live_abc', 'rk_test_abc', 'pk_test_abc', 'abc', ''])('refuses STRIPE_SECRET_KEY=%j', (key) => {
    expect(() => startupGuards({ env: { STRIPE_SECRET_KEY: key }, chainId: 31337 })).toThrow(/sk_test_/);
  });

  it('checks every Stripe secret key variable', () => {
    expect(() => startupGuards({ env: { STRIPE_API_KEY: 'sk_live_x' }, chainId: 31337 })).toThrow(/STRIPE_API_KEY/);
  });

  it.each([
    ['STRIPE_RESTRICTED', 'rk_live_x'],
    ['STRIPE_OTHER_TOKEN', 'sk_live_x'],
    ['STRIPE_PUBLISHABLE_KEY', 'pk_live_x'],
    ['STRIPE_KEY_BACKUP', 'sk_abc'],
  ])('refuses a live or non-test key in any STRIPE_* variable: %s', (name, value) => {
    expect(() => startupGuards({ env: { [name]: value }, chainId: 31337 })).toThrow(new RegExp(name));
  });

  it('accepts a publishable test key and non-key Stripe settings', () => {
    expect(() => startupGuards({ env: { STRIPE_PUBLISHABLE_KEY: 'pk_test_x', STRIPE_SECRET_KEY: 'sk_test_y', STRIPE_ACCOUNT_COUNTRY: 'NL' }, chainId: 31337 })).not.toThrow();
  });
});

describe('startup guards: chain IDs', () => {
  // Anvil/Hardhat/SimChain, Ganache, Sepolia, Holesky, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Polygon Amoy.
  const TESTNETS = [31337, 1337, 11155111, 17000, 84532, 421614, 11155420, 80002];

  it.each(TESTNETS)('starts on local or named testnet chain %i', (chainId) => {
    expect(() => startupGuards({ env: {}, chainId })).not.toThrow();
  });

  it('allowlists no chain beyond those testnets', () => {
    expect([...TEST_CHAIN_IDS].filter((id) => !TESTNETS.includes(id))).toEqual([]);
  });

  it.each([1, 10, 56, 137, 8453, 42161, 43114])('refuses mainnet chain ID %i', (chainId) => {
    expect(() => startupGuards({ env: {}, chainId })).toThrow(/mainnet/);
  });

  // T-313: the backstop reads the 21 IDs in @holdback/core; its own list had 10. Gnosis, Fantom, Mantle, Celo, Blast
  // and Polygon zkEVM answered "allowlist" before and answer "mainnet" now; either way the operator does not start.
  it.each([100, 250, 5000, 42220, 81457, 1101])('refuses mainnet chain ID %i, which only the longer list names', (chainId) => {
    expect(() => startupGuards({ env: {}, chainId })).toThrow(new RegExp(`refusing to start on mainnet chain ID ${chainId}; hard rule: no real money`));
  });

  it('refuses the list in @holdback/core, each ID with the mainnet answer', () => {
    expect([...MAINNET_CHAIN_IDS]).toEqual([...CORE_MAINNET_CHAIN_IDS]);
    expect(MAINNET_CHAIN_IDS.size).toBe(21);
    for (const chainId of CORE_MAINNET_CHAIN_IDS) expect(() => startupGuards({ env: {}, chainId })).toThrow(/mainnet/);
  });

  // Mainnets on no list (Sonic, World Chain, Metis, Sei, Kava, Berachain) and an unknown ID: the allowlist refuses them.
  it.each([146, 480, 1088, 1329, 2222, 80094, 999_999])('fails closed on chain ID %i, which is not an allowlisted test chain', (chainId) => {
    expect(() => startupGuards({ env: {}, chainId })).toThrow(/allowlist/);
  });

  it('starts on another testnet only when HOLDBACK_ALLOW_TEST_CHAIN_IDS names it', () => {
    expect(() => startupGuards({ env: { HOLDBACK_ALLOW_TEST_CHAIN_IDS: '999999,123' }, chainId: 999_999 })).not.toThrow();
    expect(() => startupGuards({ env: { HOLDBACK_ALLOW_TEST_CHAIN_IDS: '123' }, chainId: 999_999 })).toThrow(/allowlist/);
  });

  it('never lets the opt-in admit a known mainnet', () => {
    expect(() => startupGuards({ env: { HOLDBACK_ALLOW_TEST_CHAIN_IDS: '1,8453' }, chainId: 8453 })).toThrow(/mainnet/);
  });

  it('never lets the opt-in admit a mainnet that only the longer list names (Gnosis)', () => {
    expect(() => startupGuards({ env: { HOLDBACK_ALLOW_TEST_CHAIN_IDS: '100' }, chainId: 100 })).toThrow(/mainnet chain ID 100/);
    expect(() => startupGuards({ env: { HOLDBACK_ALLOW_TEST_CHAIN_IDS: '100', HOLDBACK_CHAIN_ID: '100' }, chainId: 31337 })).toThrow(/mainnet chain ID 100/);
  });

  it('refuses a malformed opt-in list', () => {
    expect(() => startupGuards({ env: { HOLDBACK_ALLOW_TEST_CHAIN_IDS: 'sepolia' }, chainId: 31337 })).toThrow(/HOLDBACK_ALLOW_TEST_CHAIN_IDS/);
  });

  it('refuses a mainnet chain ID given through the environment', () => {
    expect(() => startupGuards({ env: { HOLDBACK_CHAIN_ID: '1' }, chainId: 31337 })).toThrow(/mainnet/);
  });

  it('refuses a chain ID that is not a positive integer', () => {
    expect(() => startupGuards({ env: {}, chainId: 0 })).toThrow(/chain ID/);
    expect(() => startupGuards({ env: { HOLDBACK_CHAIN_ID: 'mainnet' }, chainId: 31337 })).toThrow(/chain ID/);
  });
});
