import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, parseArgs } from './cli.js';

let out: string;
let logs: string[];
let errs: string[];
const io = () => ({ outDir: out, log: (s: string) => void logs.push(s), error: (s: string) => void errs.push(s) });

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 't013-demo-'));
  logs = [];
  errs = [];
});
afterEach(() => rmSync(out, { recursive: true, force: true }));

describe('parseArgs', () => {
  it('reads --live, --beat n and --out', () => {
    expect(parseArgs([])).toEqual({ live: false });
    expect(parseArgs(['--live'])).toEqual({ live: true });
    expect(parseArgs(['--beat', '4'])).toEqual({ live: false, beat: 4 });
    expect(parseArgs(['--beat=4', '--out', 'x'])).toEqual({ live: false, beat: 4, out: 'x' });
  });

  it('refuses unknown flags and a non-integer beat', () => {
    expect(() => parseArgs(['--fast'])).toThrow(/--fast/);
    expect(() => parseArgs(['--beat', 'four'])).toThrow(/beat/);
    expect(() => parseArgs(['--beat'])).toThrow(/beat/);
  });
});

describe('pnpm demo', () => {
  it('writes <beat>.md, <beat>.json for every beat, closing.md and index.html', async () => {
    expect(await main([], io())).toBe(0);
    const files = readdirSync(out).sort();
    for (const b of [1, 2, 3, 4, 5, 6, 7, 10]) {
      expect(files).toContain(`beat-${b}.md`);
      expect(files).toContain(`beat-${b}.json`);
    }
    expect(files).toContain('closing.md');
    expect(files).toContain('index.html');
    const one = readFileSync(join(out, 'beat-1.md'), 'utf8');
    expect(one).toContain('Mode: scripted');
    expect(one).not.toContain('recorded verdicts');
    expect(one).toContain('measured on SimChain');
    const seven = readFileSync(join(out, 'beat-7.md'), 'utf8');
    expect(seven).toContain('measured on SimChain');
    for (const b of [1, 2, 3, 4, 5, 6, 7, 10]) expect(readFileSync(join(out, `beat-${b}.md`), 'utf8')).not.toMatch(/stand-in/i);
    expect(logs.join('\n')).toMatch(/first transcript after \d+ ms/);
  }, 60_000);

  it('prints the narration to stdout', async () => {
    await main(['--beat', '7'], io());
    const printed = logs.join('\n');
    expect(printed).toContain('Beat 7');
    expect(printed).toMatch(/op-1/);
  });

  it('--beat 4 writes only beat 4, plus the viewer and closing', async () => {
    expect(await main(['--beat', '4'], io())).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['beat-4.json', 'beat-4.md', 'closing.md', 'index.html']);
  }, 30_000);

  it('--beat with a beat that has no runner exits 2 and writes nothing', async () => {
    expect(await main(['--beat', '9'], io())).toBe(2);
    expect(errs.join('\n')).toMatch(/beat 9.*available: 1, 2, 3, 4, 5, 6, 7, 10/);
    expect(readdirSync(out)).toEqual([]);
  });

  it('--live refuses cleanly: two model-family keys are needed, nothing is written', async () => {
    expect(await main(['--live'], io())).toBe(2);
    expect(errs.join('\n')).toMatch(/two model families/);
    expect(errs.join('\n')).toMatch(/pnpm demo/);
    expect(readdirSync(out)).toEqual([]);
  });

  it('an unknown flag exits 2 with usage', async () => {
    expect(await main(['--fast'], io())).toBe(2);
    expect(errs.join('\n')).toMatch(/usage/i);
  });

  it('creates the output directory when missing', async () => {
    rmSync(out, { recursive: true, force: true });
    expect(await main(['--beat', '1'], io())).toBe(0);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
  }, 30_000);
});

describe('secrets', () => {
  it('the demo CLI and the agents it imports never read the environment or an env file', () => {
    // apps/demo/src (the CLI) and apps/demo/agents (T-012's beats it runs). The operators the agents start get
    // `env: {}` from world.ts, so the operator's startup guard sees no keys either.
    const dirs = [new URL('.', import.meta.url).pathname, new URL('../agents/', import.meta.url).pathname];
    let count = 0;
    for (const dir of dirs) {
      const sources = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'));
      count += sources.length;
      for (const f of sources) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/process\.env|\.env\b|dotenv/);
    }
    expect(count).toBeGreaterThan(15);
    expect(readFileSync(new URL('../agents/world.ts', import.meta.url), 'utf8')).toMatch(/env: \{\}/);
  });
});
