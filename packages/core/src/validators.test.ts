// T-233: the parsers run validators compiled ahead of time (validators.generated.ts) instead of compiling
// spec/schemas with Ajv when core is imported. These tests pin that the swap changed nothing. The checked-in module
// is what the schemas generate today. On every spec example, and on many mutations of each, the precompiled
// validators give the same result and the same errors as the runtime compile parse.ts used before, kept here as
// the oracle, for the signed and the plain set.
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { UNTRUSTED } from './parse.js';
import { schemaFiles, UNTRUSTED_KEYWORD, validatorsSource } from './validators-codegen.js';
import { plainValidators, signedTimestamp, signedValidators, type SchemaValidator } from './validators.js';

const GENERATED = new URL('./validators.generated.ts', import.meta.url);
const EXAMPLES = new URL('../../../spec/examples/', import.meta.url);

/** parse.ts's compile before T-233, unchanged: the behaviour the generated validators must keep. */
function runtimeCompile(signed: boolean): Map<string, SchemaValidator> {
  const ajv = new Ajv2020.default({ strict: true, allErrors: false, validateSchema: false, code: { optimize: false } });
  ajv.addKeyword({ keyword: UNTRUSTED, schemaType: 'boolean' });
  if (signed) {
    addFormats.default(ajv, ['uri']);
    ajv.addFormat('date-time', signedTimestamp);
  } else {
    addFormats.default(ajv);
  }
  const schemas = schemaFiles();
  for (const { schema } of schemas) ajv.addSchema(schema);
  return new Map(schemas.map(({ name, schema }) => [name, ajv.getSchema(schema.$id) as SchemaValidator]));
}

type Path = (string | number)[];
const DELETE = Symbol('delete');
/** What each value in an example is swapped for: wrong types, edge numbers, and timestamps the two sets read differently. */
const SWAPS: unknown[] = [DELETE, null, 0, -1, 1.5, 2 ** 53, '', 'x', '0x', [], {}, true, '2026-11-06T12:00:00Z', '2026-11-06T12:00:00.500Z', '2026-11-06 12:00:00'];

function paths(value: unknown, at: Path = [], out: Path[] = []): Path[] {
  if (at.length > 0) out.push(at);
  if (Array.isArray(value)) value.forEach((v, i) => paths(v, [...at, i], out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) paths(v, [...at, k], out);
  return out;
}

function swapped(root: unknown, path: Path, swap: unknown): unknown {
  const copy = structuredClone(root);
  let parent = copy as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) parent = parent[k] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (swap !== DELETE) parent[last] = structuredClone(swap);
  else if (Array.isArray(parent)) parent.splice(last as number, 1);
  else delete parent[last];
  return copy;
}

/** Every example, by the schema its file name starts with, and the mutations of it. */
function cases(): { schema: string; label: string; value: unknown }[] {
  const out: { schema: string; label: string; value: unknown }[] = [];
  for (const file of readdirSync(EXAMPLES).filter((f) => f.endsWith('.example.json')).sort()) {
    const schema = file.split('.')[0]!;
    const example: unknown = JSON.parse(readFileSync(new URL(file, EXAMPLES), 'utf8'));
    out.push({ schema, label: file, value: example });
    for (const value of [null, 'x', 1, [], {}]) out.push({ schema, label: `${file} as ${JSON.stringify(value)}`, value });
    for (const path of paths(example)) for (const swap of SWAPS) out.push({ schema, label: `${file} /${path.join('/')} = ${swap === DELETE ? '(removed)' : JSON.stringify(swap)}`, value: swapped(example, path, swap) });
  }
  return out;
}

describe('validators.generated.ts', () => {
  it('is what spec/schemas generate today', () => {
    const fresh = readFileSync(GENERATED, 'utf8') === validatorsSource();
    expect(fresh, 'packages/core/src/validators.generated.ts is stale: run node packages/core/scripts/validators.ts').toBe(true);
  });

  it('marks untrusted strings with the keyword parse.ts exports', () => {
    expect(UNTRUSTED_KEYWORD).toBe(UNTRUSTED);
  });

  it('has one validator per schema file in each set', () => {
    const names = schemaFiles()
      .map((s) => s.name)
      .sort();
    expect(Object.keys(signedValidators).sort()).toEqual(names);
    expect(Object.keys(plainValidators).sort()).toEqual(names);
  });
});

describe('the precompiled validators', () => {
  const all = cases();
  for (const [set, precompiled, signed] of [['signed', signedValidators, true], ['plain', plainValidators, false]] as const) {
    it(`match the runtime compile on every example and mutation (${set} set)`, () => {
      const oracle = runtimeCompile(signed);
      const mismatches: string[] = [];
      let refused = 0;
      for (const c of all) {
        const want = oracle.get(c.schema)!;
        const got = precompiled[c.schema]!;
        const ok = want(c.value);
        if (!ok) refused++;
        const a = JSON.stringify({ ok, errors: want.errors });
        const b = JSON.stringify({ ok: got(c.value), errors: got.errors });
        if (a !== b) mismatches.push(`${c.label}: runtime ${a}, precompiled ${b}`);
      }
      expect(mismatches.slice(0, 5)).toEqual([]);
      // The mutations reach the refusals, not only the happy path.
      expect(refused).toBeGreaterThan(all.length / 2);
    });
  }

  it('read date-time differently in the two sets, as before', () => {
    // A signed timestamp is whole seconds; the plain set takes the schema's wider date-time.
    const t = '2026-11-06T12:00:00.500Z';
    expect(signedTimestamp(t)).toBe(false);
    const record = JSON.parse(readFileSync(new URL('event.example.json', EXAMPLES), 'utf8')) as { at?: string };
    expect(typeof record.at).toBe('string');
    expect(plainValidators.event!({ ...record, at: t })).toBe(true);
    expect(signedValidators.event!({ ...record, at: t })).toBe(false);
  });
});
