import { MAINNET_CHAIN_IDS as CORE_MAINNET_CHAIN_IDS } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { assertLocalRpc, assertSafeChain, MAINNET_CHAIN_IDS } from './guard.js';

describe('startup guard (hard rule: no real money)', () => {
  it('refuses Ethereum, the major L2s, the sidechains and every other listed mainnet', () => {
    expect(() => assertSafeChain(1)).toThrow(/mainnet chain id 1/);
    for (const id of [1, 10, 56, 100, 137, 324, 8453, 42161, 43114, 59144, 534352, ...MAINNET_CHAIN_IDS]) expect(() => assertSafeChain(id)).toThrow(RangeError);
  });

  // T-313: one list, in @holdback/core, for this guard, SimChain and the operator.
  it('refuses the list in @holdback/core, under the name this module always exported', () => {
    expect(MAINNET_CHAIN_IDS).toBe(CORE_MAINNET_CHAIN_IDS);
    expect(MAINNET_CHAIN_IDS).toHaveLength(21);
    expect(() => assertSafeChain(100)).toThrow(/the EVM settlement adapter refuses mainnet chain id 100 \(hard rule: no real money\)/);
    expect(() => assertSafeChain(100n)).toThrow(RangeError);
  });

  it('accepts anvil (31337)', () => {
    expect(() => assertSafeChain(31337)).not.toThrow();
  });

  it("refuses an RPC URL that is not this machine's for kind local", () => {
    expect(() => assertLocalRpc('http://127.0.0.1:8545')).not.toThrow();
    expect(() => assertLocalRpc('http://localhost:8545')).not.toThrow();
    expect(() => assertLocalRpc('https://eth.llamarpc.com')).toThrow(/not a local RPC/);
    expect(() => assertLocalRpc('http://10.0.0.5:8545')).toThrow(/not a local RPC/);
  });
});
