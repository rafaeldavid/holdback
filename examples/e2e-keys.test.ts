// T-216: the round's keys. No network; the command runs as its own Node process on a temporary file, never on .env.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
/** Neither the secret nor any key derived from it appears in what a command printed. */
const expectNoSecret = (out: { stdout: string; stderr: string }, seed: string) => {
  const printed = out.stdout + out.stderr;
  expect(printed).not.toContain(seed.slice(2));
  for (const r of ROLES) expect(printed).not.toContain(roundKey(seed, r).slice(2));
};

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
    expectNoSecret(first, written);
    expect(first.stdout).toContain(roundAddresses(written).master);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = run(['init', file]);
    expect(again.status).toBe(2);
    expect(seedLines(file)).toHaveLength(1);
  });

  it('init appends to an existing file, keeps its lines, and warns when others can read it', () => {
    const file = join(dir, 'existing');
    writeFileSync(file, 'OTHER=1\nKEPT=two', { mode: 0o644 });
    chmodSync(file, 0o644);
    const out = run(['init', file]);
    expect(out.status).toBe(0);
    expect(out.stderr).toContain('readable by other users');
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith('OTHER=1\nKEPT=two\n')).toBe(true);
    expect(seedLines(file)).toHaveLength(1);
    expectNoSecret(out, seedLines(file)[0]!.slice(SEED_VAR.length + 1));
  });

  it('init refuses a file that sets the secret in another form', () => {
    for (const line of [`export ${SEED_VAR}=0x${'33'.repeat(32)}`, `  ${SEED_VAR} = 0x${'33'.repeat(32)}`]) {
      const file = join(dir, `form-${line.length}`);
      writeFileSync(file, `A=1\n${line}\n`, { mode: 0o600 });
      expect(run(['init', file]).status).toBe(2);
      expect(readFileSync(file, 'utf8')).toBe(`A=1\n${line}\n`);
    }
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
    expectNoSecret(out, seed);
    expectNoSecret(loaded, seed);
    expect(run(['address']).status).toBe(1);
  });
});
