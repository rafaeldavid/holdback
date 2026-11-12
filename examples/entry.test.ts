// examples/entry.ts (T-390 part 3): a file runs its main only when it is the program, also inside a bundle that
// inlines it, and a command names its siblings as the bundle says or, unbundled, by their paths as before.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { command, isMain } from './entry.ts';

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const g = globalThis as unknown as { crowEntry?: unknown; crowCommands?: unknown };
afterEach(() => {
  delete g.crowEntry;
  delete g.crowCommands;
});
const run = (script: string) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
  const dir = mkdtempSync(join(tmpdir(), 't390-entry-'));
  const file = join(dir, 'as-bundled.mjs');
  writeFileSync(file, script);
  const child = spawn(process.execPath, [file], { env: process.env });
  let out = '', err = '';
  child.stdout.on('data', (x: Buffer) => (out += x.toString()));
  child.stderr.on('data', (x: Buffer) => (err += x.toString()));
  child.on('exit', (code) => (rmSync(dir, { recursive: true, force: true }), resolve({ code, out, err })));
});

describe('entry.ts: which file is the program, and how commands name each other', () => {
  it('unbundled: a file is the program when node was given it, and only then', () => {
    const argv1 = process.argv[1];
    try {
      process.argv[1] = here('./deal-record.ts');
      expect(isMain(pathToFileURL(here('./deal-record.ts')).href, 'deal-record')).toBe(true);
      expect(isMain(pathToFileURL(here('./buyer-signer.ts')).href, 'buyer-signer')).toBe(false);
    } finally {
      process.argv[1] = argv1!;
    }
  });

  it('in a bundle that names its entry, only that command is the program, though every inlined file has the bundle\'s URL', () => {
    const argv1 = process.argv[1];
    try {
      const bundle = pathToFileURL(here('./buy.mjs')).href; // in a bundle, every inlined module's import.meta.url is the bundle's
      process.argv[1] = here('./buy.mjs');
      g.crowEntry = 'buy-with-signer';
      expect(isMain(bundle, 'deal-record')).toBe(false);
      expect(isMain(bundle, 'buy-with-signer')).toBe(true);
    } finally {
      process.argv[1] = argv1!;
    }
  });

  it('a command names a sibling by its path, as before, or by the words a bundle declares', () => {
    expect(command('pay-from-wallet', import.meta.url)).toBe('node examples/pay-from-wallet.ts'); // the tests run from the repository's root
    g.crowCommands = { 'pay-from-wallet': 'node buy.mjs pay', 'buy-with-signer': 'node buy.mjs' };
    expect(command('pay-from-wallet', import.meta.url)).toBe('node buy.mjs pay');
    expect(command('buy-with-signer', import.meta.url)).toBe('node buy.mjs');
    g.crowCommands = { 'buy-with-signer': 'node buy.mjs' };
    expect(command('deal-record', import.meta.url)).toBe('node examples/deal-record.ts'); // a name the bundle does not declare
  });

  it('deal-record.ts runs its main as the program, and not when a program that declared another entry imports it', async () => {
    const url = pathToFileURL(here('./deal-record.ts')).href;
    // As a bundle would: process.argv[1] is the very file whose code runs, and the entry is declared first.
    const asBundle = await run(`process.argv[1] = ${JSON.stringify(here('./deal-record.ts'))};\nglobalThis.crowEntry = 'buy-with-signer';\nawait import(${JSON.stringify(url)});\nconsole.log('imported, no main');\n`);
    expect(asBundle, asBundle.err).toMatchObject({ code: 0, out: 'imported, no main\n' });
    expect(asBundle.err).not.toMatch(/usage: node examples\/deal-record\.ts/);
    // Unbundled, as before: the same import with no declared entry runs the record's main, which prints its usage.
    const asProgram = await run(`process.argv[1] = ${JSON.stringify(here('./deal-record.ts'))};\nawait import(${JSON.stringify(url)});\n`);
    expect(asProgram.code).toBe(2);
    expect(asProgram.err).toMatch(/usage: node examples\/deal-record\.ts <commitmentId> --as buyer\|seller/);
  });
});
