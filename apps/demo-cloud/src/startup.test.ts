// T-233: Cloudflare counts a Worker's start-up (its global scope) against a CPU limit of 1 s and refuses an upload
// above it (code 10021). Compiling every JSON Schema with Ajv when core was imported took most of that start-up
// (measured, T-233), so core now loads validators compiled ahead of time. This test keeps the cost out: it imports
// the built Worker in Node with code generation from strings disallowed, the rule workerd applies inside a request,
// then runs every core parser on the spec examples. A module that compiles a schema at import, or calls `eval` or
// `new Function` there for any other reason, fails it. It reads apps/demo-cloud/dist and packages/core/dist, so
// `pnpm build` (or `pnpm typecheck`) runs first, as in CI.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const worker = new URL('../dist/worker.js', import.meta.url);
const core = new URL('../../../packages/core/dist/index.js', import.meta.url);
const examples = new URL('../../../spec/examples/', import.meta.url);

/** Imports the Worker, then parses each example with the parser named by its file name; prints what ran. */
const script = `
import { readdirSync, readFileSync } from 'node:fs';
const worker = await import(${JSON.stringify(worker.href)});
if (typeof worker.World !== 'function' || typeof worker.default?.fetch !== 'function') throw new Error('the Worker module exports no World and no fetch handler');
const { parsers } = await import(${JSON.stringify(core.href)});
const dir = new URL(${JSON.stringify(examples.href)});
const ran = new Set();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.example.json')).sort()) {
  const name = file.split('.')[0];
  if (!(name in parsers)) continue;
  const r = parsers[name](JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
  if (typeof r.ok !== 'boolean') throw new Error(file + ': the parser returned no result');
  ran.add(name);
}
for (const [name, parse] of Object.entries(parsers)) if (parse({}).ok) throw new Error(name + ' accepted an empty object');
process.stdout.write(JSON.stringify({ parsers: Object.keys(parsers).sort(), ran: [...ran].sort() }));
`;

const built = existsSync(fileURLToPath(worker)) && existsSync(fileURLToPath(core));

describe('the Worker start-up', () => {
  it('imports and parses with code generation disallowed', () => {
    expect(built, 'apps/demo-cloud/dist/worker.js or packages/core/dist is missing: run pnpm build').toBe(true);
    const r = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60_000 });
    expect(r.stderr, 'the import or a parser generated code (or failed); see stderr').toBe('');
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { parsers: string[]; ran: string[] };
    // Every parser ran on at least one example, so none was left to compile on first use.
    expect(out.ran).toEqual(out.parsers);
  });
});
