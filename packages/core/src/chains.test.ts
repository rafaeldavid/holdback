// Hard rule "no real money": one list of mainnet chain IDs, read by the EVM adapter's guard, SimChain and the operator.
import { describe, expect, it } from 'vitest';
import { MAINNET_CHAIN_IDS } from './index.js';

describe('the mainnet chain IDs every guard refuses (hard rule: no real money)', () => {
  it('lists 21 mainnets, each once, in ascending order', () => {
    expect(MAINNET_CHAIN_IDS).toHaveLength(21);
    expect(new Set(MAINNET_CHAIN_IDS).size).toBe(21);
    expect([...MAINNET_CHAIN_IDS].sort((a, b) => a - b)).toEqual([...MAINNET_CHAIN_IDS]);
  });

  it('names Ethereum, Base and the chains only the longest of the three old lists had (Gnosis, Celo, Blast)', () => {
    for (const id of [1, 8453, 100, 42220, 81457]) expect(MAINNET_CHAIN_IDS).toContain(id);
  });

  it('names no local chain and no testnet the operator starts on', () => {
    // Anvil, Ganache, Sepolia, Holesky, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Polygon Amoy.
    for (const id of [31337, 1337, 11155111, 17000, 84532, 421614, 11155420, 80002]) expect(MAINNET_CHAIN_IDS).not.toContain(id);
  });

  it('cannot be changed by code that imports it', () => {
    expect(Object.isFrozen(MAINNET_CHAIN_IDS)).toBe(true);
  });
});
