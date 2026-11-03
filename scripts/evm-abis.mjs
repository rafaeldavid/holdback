// Writes packages/settlement/evm/abis.json: the ABIs a live chain needs (D41), from `forge build` output in
// contracts/out. A Worker has no file system, so the live settlement imports them from the package instead.
// The token ABI is TestUSDC's (contracts/script/TestUSDC.sol), the Sepolia demo's tUSDC (D42): open mint, ERC-3009
// receive and transfer, authorizationState.
// `packages/settlement/evm/abis.test.ts` fails when the file is stale against contracts/out.
//
//   node scripts/evm-abis.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
export const SOURCES = {
  rules: ['HoldbackRules.sol', 'HoldbackRules'],
  bonds: ['HoldbackBonds.sol', 'HoldbackBonds'],
  token: ['TestUSDC.sol', 'TestUSDC'],
  escrow: ['AuthCaptureEscrow.sol', 'AuthCaptureEscrow'],
  multicall: ['LocalMulticall3.sol', 'LocalMulticall3'],
  collector: ['ERC3009PaymentCollector.sol', 'ERC3009PaymentCollector'],
};

const abis = Object.fromEntries(Object.entries(SOURCES).map(([k, [file, name]]) => [k, JSON.parse(readFileSync(join(root, 'contracts', 'out', file, `${name}.json`), 'utf8')).abi]));
writeFileSync(join(root, 'packages', 'settlement', 'evm', 'abis.json'), `${JSON.stringify(abis)}\n`);
console.log(`wrote packages/settlement/evm/abis.json (${Object.keys(abis).join(', ')})`);
