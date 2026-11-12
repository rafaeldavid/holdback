// The record's copies (scripts/record-copies.mjs, T-383): run on a copy of the repository's tracked files with a
// made-up new record, the command leaves no old address or hash behind outside the history files, and it fails when a
// file outside its list still pins one.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script with no types
import { changes, literal, recordCopies, regenerateDeployments, substitute, trackedFiles } from '../scripts/record-copies.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OLD_NAME = 'contracts/deployments/sepolia-2026-11-04-domain-0.7.json';
type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A new address or hash: the old one's length, from a counter, so no two collide and none is a real deployment's. */
let n = 0;
const fresh = (old: string) => `0x${(++n).toString(16).padStart(old.length - 2, 'e')}`;

/** A phase-one record made up from the 2026-11-04 one: new addresses and hashes, no vault, no Permit2 collector. */
function madeUp(old: J): J {
  const map = new Map<string, string>();
  const swap = (v: string) => {
    const k = v.toLowerCase();
    if (k === old.multicall.toLowerCase()) return v;
    if (!map.has(k)) map.set(k, fresh(v));
    return map.get(k)!;
  };
  const r: J = structuredClone(old);
  for (const k of ['escrow', 'erc3009Collector', 'rules', 'beacon']) r[k] = swap(r[k]);
  r.token.address = swap(r.token.address);
  r.token.tx = swap(r.token.tx);
  r.token.domainSeparator = swap(r.token.domainSeparator);
  r.commit = 'f'.repeat(40);
  r.beaconMarginSec = 29;
  delete r.bonds;
  delete r.permit2Collector;
  delete r.permit2;
  delete r.checks.permit2CodeHash;
  delete r.contracts.Permit2PaymentCollector;
  delete r.contracts.HoldbackBonds;
  for (const c of Object.values(r.contracts) as J[]) {
    c.address = swap(c.address);
    c.tx = swap(c.tx);
    if (c.tokenStoreImplementation) c.tokenStoreImplementation = swap(c.tokenStoreImplementation);
    c.args = c.args.map((a: string) => (/^0x/.test(a) ? swap(a) : a));
  }
  r.contracts.HoldbackRules.args = [r.escrow, r.erc3009Collector, '86400', r.beacon, r.token.address, '29'];
  return r;
}

describe('the pieces', () => {
  const old = JSON.parse(readFileSync(join(root, 'contracts/deployments/sepolia.json'), 'utf8'));

  it('pairs values by field name, never by position, and retires the cut contracts only', () => {
    const neu = madeUp(old);
    const { pairs, retired } = changes(old, neu);
    expect(pairs.get(old.rules.toLowerCase())).toBe(neu.rules);
    expect(pairs.get(old.token.address.toLowerCase())).toBe(neu.token.address);
    expect(pairs.has(old.multicall.toLowerCase())).toBe(false);
    expect(retired.has(old.bonds.toLowerCase())).toBe(true);
    expect(retired.has(old.permit2Collector.toLowerCase())).toBe(true);
    // Permit2 is an outside contract the old record named; it is not this deployment's to retire.
    expect(retired.has(old.permit2.toLowerCase())).toBe(false);
  });

  it('writes each replacement in the letter case it found', () => {
    const neu = madeUp(old);
    const { pairs } = changes(old, neu);
    const text = `${old.rules} ${old.rules.toLowerCase()} ${old.rules.toUpperCase().replace('0X', '0x')} ${old.rules}ff`;
    const { text: out, count } = substitute(text, pairs, old);
    expect(count).toBe(3);
    expect(out).toBe(`${neu.rules} ${neu.rules.toLowerCase()} 0x${neu.rules.slice(2).toUpperCase()} ${old.rules}ff`);
  });

  it('refuses a record that maps one old value to two new ones', () => {
    const neu = madeUp(old);
    neu.contracts.HoldbackRules.address = fresh(old.rules);
    expect(() => changes(old, neu)).toThrow(/becomes both/);
  });

  it('regenerates the SEPOLIA constant whole, in the repository style', () => {
    const neu = madeUp(old);
    const ts = regenerateDeployments(readFileSync(join(root, 'examples/deployments.ts'), 'utf8'), neu);
    expect(ts).toContain(`export const SEPOLIA: DeploymentFile | null = ${literal(neu)};`);
    expect(ts).not.toContain(old.rules);
    expect(ts).toContain('the contracts at\n * fffffff.');
  });
});

describe('the command on a copy of the repository', () => {
  let copy: string;
  let neu: J;
  let old: J;
  let lines: string[];
  let code: number;

  beforeAll(() => {
    copy = realpathSync(mkdtempSync(join(tmpdir(), 't383-copies-')));
    for (const file of trackedFiles(root)) {
      const from = join(root, file);
      if (!existsSync(from) || statSync(from).isDirectory()) continue; // a submodule
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      cpSync(from, join(copy, file));
    }
    // The site build bundles examples/try.ts with the workspace's packages: link the installed ones.
    for (const dir of ['', 'examples', 'site']) {
      const nm = join(root, dir, 'node_modules');
      if (existsSync(nm)) symlinkSync(nm, join(copy, dir, 'node_modules'));
    }
    old = JSON.parse(readFileSync(join(copy, 'contracts/deployments/sepolia.json'), 'utf8'));
    writeFileSync(join(copy, OLD_NAME), readFileSync(join(copy, 'contracts/deployments/sepolia.json')));
    neu = madeUp(old);
    writeFileSync(join(copy, 'contracts/deployments/sepolia.json'), `${JSON.stringify(neu, null, 2)}\n`);
    lines = [];
    code = recordCopies({ root: copy, oldPath: OLD_NAME, newPath: 'contracts/deployments/sepolia.json', log: (l: string) => lines.push(l) });
  }, 300_000);

  afterAll(() => rmSync(copy, { recursive: true, force: true }));

  it('passes, and names what it replaced; or fails only on the lines the words package still owes', () => {
    const out = lines.join('\n');
    // site/llms.txt still names the cut vault in two lines that the words package (AL-2) removes before the cutover
    // (cutover checklist, step 3). Until it has, the sweep must fail on exactly those lines, and on nothing else.
    const vault = old.bonds.toLowerCase();
    const owed = readFileSync(join(root, 'site/llms.txt'), 'utf8').split('\n').flatMap((l, i) => (l.toLowerCase().includes(vault) ? [`site/llms.txt:${i + 1}: ${vault}`] : []));
    if (owed.length === 0) {
      expect(out, out).toMatch(/record-copies: pass: \d+ value\(s\) replaced, 3 retired/);
      expect(code).toBe(0);
    } else {
      expect(code).toBe(1);
      const left = lines.filter((l) => l.startsWith('  ')).map((l) => l.trim());
      expect(left, out).toEqual(owed);
    }
  });

  it('leaves every pin naming the new record', () => {
    const llms = readFileSync(join(copy, 'site/llms.txt'), 'utf8');
    expect(llms).toContain(neu.rules.toLowerCase());
    expect(llms).not.toContain(old.rules.toLowerCase());
    expect(JSON.parse(readFileSync(join(copy, 'packages/settlement/evm/accepted-tokens.json'), 'utf8'))['11155111'].address).toBe(neu.token.address);
    expect(readFileSync(join(copy, 'site/try.mjs'), 'utf8')).toContain(neu.rules);
  });

  it('fails when a file outside its list still pins an old value, and names the line', () => {
    writeFileSync(join(copy, 'apps/operator/src/stray-pin.ts'), `export const RULES = '${old.rules}';\n`);
    const again: string[] = [];
    // The copy already names the new record, so the second run's old record is the new one's predecessor again.
    const c = recordCopies({ root: copy, oldPath: OLD_NAME, newPath: 'contracts/deployments/sepolia.json', build: false, log: (l: string) => again.push(l) });
    expect(c).toBe(1);
    expect(again.join('\n')).toContain(`apps/operator/src/stray-pin.ts:1: ${old.rules}`);
  });
});
