// Source scan: the judgment package must not execute code from inputs, call the network, read
// secrets, or put nondeterminism into its outputs. ESLint enforces no-eval repo-wide; this adds
// the judgment-specific bans.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = new URL('.', import.meta.url).pathname;
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && e.name !== '_helpers.ts' ? [join(dir, e.name)] : [],
  );
}

const BANNED: Array<[RegExp, string]> = [
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\bFunction\s*\(/, 'Function()'],
  [/\bMath\.random\b/, 'Math.random'],
  [/\bDate\.now\b/, 'Date.now'],
  [/\bnew\s+Date\b/, 'new Date'],
  [/\bfetch\s*\(/, 'fetch'],
  [/node:(http|https|net|tls|dgram|child_process|vm|worker_threads)\b/, 'network, process or vm module'],
  [/process\.env\b/, 'process.env'],
  [/\bnew\s+RegExp\b/, 'RegExp built from data'],
];

describe('judgment source', () => {
  const sources = files(srcDir);
  it('finds the source files', () => expect(sources.length).toBeGreaterThan(5));
  it('is ASCII only (no literal invisible or lookalike characters in patterns; write \\u escapes)', () => {
    const hits = sources.filter((f) => /[^\x00-\x7f]/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('has no open-ended counted loops ({n,}) in regex literals, which overflow V8 on long runs', () => {
    const hits = sources.filter((f) => /\{\d+,\}/.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')));
    expect(hits).toEqual([]);
  });
  for (const [pattern, name] of BANNED) {
    it(`never uses ${name}`, () => {
      const hits = sources.filter((f) => pattern.test(readFileSync(f, 'utf8')));
      expect(hits).toEqual([]);
    });
  }
});
