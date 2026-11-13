// The runtime code hash of HoldbackRules and DrandQuicknetBeacon at one or more commits (T-352, R10), built from
// contracts/src alone with the metadata tail off (bytecode_hash = "none", cbor_metadata = false), so a comment-only
// change cannot move it, and hashed with `cast keccak`. Each commit is built in its own scratch copy.
//   node contracts/scripts/runtime-hashes.mjs <commit> <commit>
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareCopy } from './scratch.mjs';

const keccak256 = (hex) => execFileSync('cast', ['keccak', hex], { encoding: 'utf8' }).trim();

const refs = process.argv.slice(2);
if (refs.length === 0) throw new Error('give one or more commits');
const names = ['HoldbackRules', 'DrandQuicknetBeacon'];
const table = {};
for (const ref of refs) {
  const { contracts, commit } = prepareCopy(`runtime-${ref.slice(0, 12)}`, ref);
  const toml = join(contracts, 'foundry.toml');
  writeFileSync(toml, readFileSync(toml, 'utf8').replace('[profile.default]', '[profile.default]\nbytecode_hash = "none"\ncbor_metadata = false'));
  const t0 = Date.now();
  const b = spawnSync('forge', ['build', '--root', contracts, '--skip', 'test', '--skip', 'script', '--color', 'never'], { encoding: 'utf8' });
  if (b.status !== 0) throw new Error(`forge build at ${ref} failed:\n${b.stdout}\n${b.stderr}`);
  table[ref] = { commit, seconds: Math.round((Date.now() - t0) / 1000) };
  for (const n of names) {
    const art = JSON.parse(readFileSync(join(contracts, 'out', `${n}.sol`, `${n}.json`), 'utf8'));
    const code = art.deployedBytecode.object;
    table[ref][n] = { hash: keccak256(code), bytes: (code.length - 2) / 2 };
  }
}
process.stdout.write(`${JSON.stringify(table, null, 2)}\n`);
const [a, b] = refs;
if (b) {
  for (const n of names) process.stdout.write(`${n}: ${table[a][n].hash === table[b][n].hash ? 'equal' : 'DIFFERENT'} at ${a} and ${b}\n`);
}
