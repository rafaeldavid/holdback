// T-216: the round's keys. No network; the command runs as its own Node process on a temporary file, never on .env.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ROLES, SEED_VAR, roundAddresses, roundKey } from './e2e-keys.ts';

const cli = fileURLToPath(new URL('./e2e-keys.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'e2e-keys-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** `node examples/e2e-keys.ts <args>` with only PATH and `env` in its environment. */
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } });
const seedLines = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith(`${SEED_VAR}=`));

describe('the round keys', () => {
  const seed = `0x${'11'.repeat(32)}`;

  it('derive one distinct key per role, the same every time', () => {
    const keys = ROLES.map((r) => roundKey(seed, r));
    expect(new Set(keys).size).toBe(ROLES.length);
    expect(ROLES.map((r) => roundKey(seed, r))).toEqual(keys);
    expect(roundKey(`0x${'22'.repeat(32)}`, 'master')).not.toBe(roundKey(seed, 'master'));
  });

  it('refuse a seed that is not 32 bytes of hex', () => {
    expect(() => roundKey('0x1234', 'master')).toThrow(RangeError);
    expect(() => roundKey('11'.repeat(32), 'master')).toThrow(RangeError);
  });

  it('init writes a fresh secret once, never prints it, and prints the master it derives', () => {
    const file = join(dir, 'env');
    const first = run(['init', file]);
    expect(first.status).toBe(0);
    const [line] = seedLines(file);
    const written = line!.slice(SEED_VAR.length + 1);
    expect(written).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.stdout + first.stderr).not.toContain(written.slice(2));
    expect(first.stdout).toContain(roundAddresses(written).master);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = run(['init', file]);
    expect(again.status).toBe(2);
    expect(seedLines(file)).toHaveLength(1);
  });

  it('init and address read the secret from the environment, and address refuses without one', () => {
    const file = join(dir, 'untouched');
    const loaded = run(['init', file], { [SEED_VAR]: seed });
    expect(loaded.status).toBe(0);
    expect(loaded.stdout).toContain('nothing written');
    expect(() => statSync(file)).toThrow();

    const out = run(['address'], { [SEED_VAR]: seed });
    expect(out.status).toBe(0);
    for (const a of Object.values(roundAddresses(seed))) expect(out.stdout).toContain(a);
    expect(out.stdout).not.toContain('11'.repeat(32));
    expect(run(['address']).status).toBe(1);
  });
});
