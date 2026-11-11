// The ABIs a live chain imports (abis.json, written by scripts/evm-abis.mjs) must be the ones forge builds from
// contracts/: a stale copy would encode calls the deployed contracts do not take. Skipped without forge output.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import abis from './abis.json' with { type: 'json' };

const root = join(import.meta.dirname, '..', '..', '..');
const SOURCES: Record<string, [string, string]> = {
  rules: ['HoldbackRules.sol', 'HoldbackRules'],
  token: ['TestUSDC.sol', 'TestUSDC'],
  escrow: ['AuthCaptureEscrow.sol', 'AuthCaptureEscrow'],
  multicall: ['LocalMulticall3.sol', 'LocalMulticall3'],
  collector: ['ERC3009PaymentCollector.sol', 'ERC3009PaymentCollector'],
};
const out = (file: string, name: string) => join(root, 'contracts', 'out', file, `${name}.json`);
const ready = Object.values(SOURCES).every(([f, n]) => existsSync(out(f, n)));

describe.skipIf(!ready)(`abis.json${ready ? '' : ' (SKIPPED: needs forge build output in contracts/out)'}`, () => {
  it('matches contracts/out; regenerate with node scripts/evm-abis.mjs', () => {
    for (const [k, [f, n]] of Object.entries(SOURCES)) expect((abis as Record<string, unknown>)[k], k).toEqual(JSON.parse(readFileSync(out(f, n), 'utf8')).abi);
  });
});
