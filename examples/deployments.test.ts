// The Sepolia deployment the examples pin (deployments.ts) is a copy of contracts/deployments/sepolia.json, the file
// the testnet deployment writes: an agent must sign for the contracts that were deployed, and only those.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEPOLIA } from './deployments.ts';

const file = fileURLToPath(new URL('../contracts/deployments/sepolia.json', import.meta.url));

describe('the pinned Sepolia deployment', () => {
  it('is the deployment file, or null while there is none', () => {
    if (!existsSync(file)) return expect(SEPOLIA).toBeNull();
    expect(SEPOLIA).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });
});
