// Hard rule "no real money": the operator refuses to start with a live Stripe key or a mainnet chain ID.
import { describe, expect, it } from 'vitest';
import { startupGuards } from './guards.js';

describe('startup guards', () => {
  it('starts on SimChain with no Stripe key, or with a test key', () => {
    expect(() => startupGuards({ env: {}, chainId: 31337 })).not.toThrow();
    expect(() => startupGuards({ env: { STRIPE_SECRET_KEY: 'sk_test_abc' }, chainId: 84532 })).not.toThrow();
  });

  it.each(['sk_live_abc', 'rk_live_abc', 'rk_test_abc', 'pk_test_abc', 'abc', ''])('refuses the Stripe key %j', (key) => {
    expect(() => startupGuards({ env: { STRIPE_SECRET_KEY: key }, chainId: 31337 })).toThrow(/sk_test_/);
  });

  it('checks every Stripe key variable', () => {
    expect(() => startupGuards({ env: { STRIPE_API_KEY: 'sk_live_x' }, chainId: 31337 })).toThrow(/STRIPE_API_KEY/);
  });

  it.each([1, 10, 56, 137, 8453, 42161, 43114])('refuses mainnet chain ID %i', (chainId) => {
    expect(() => startupGuards({ env: {}, chainId })).toThrow(/mainnet/);
  });

  it('refuses a mainnet chain ID given through the environment', () => {
    expect(() => startupGuards({ env: { HOLDBACK_CHAIN_ID: '1' }, chainId: 31337 })).toThrow(/mainnet/);
  });

  it('refuses a chain ID that is not a positive integer', () => {
    expect(() => startupGuards({ env: {}, chainId: 0 })).toThrow(/chain ID/);
    expect(() => startupGuards({ env: { HOLDBACK_CHAIN_ID: 'mainnet' }, chainId: 31337 })).toThrow(/chain ID/);
  });
});
