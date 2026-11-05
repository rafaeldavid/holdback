#!/usr/bin/env node
// Checks a metrics file against its JSON Schema (2020-12, Ajv strict), as `pnpm validate:spec` checks spec/examples.
// The schemas describe Crow Control's inputs, not the API, so they live here and not in spec/ (T-066).
//
//   node scripts/metrics/check.mjs deal-timing reports/scratch/deal-timing.json
//   names: one-click, deal-timing, throughput, ops-cost, model-prices, ops-cost-prices
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT, isMain } from './lib.mjs';

export const SCHEMA_DIR = join(ROOT, 'scripts/metrics/schemas');

/** One Ajv with every metrics schema loaded; `validator(name)` returns its compiled check. */
export function loadSchemas() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const ids = new Map();
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort()) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'));
    ajv.addSchema(schema);
    ids.set(file.replace('.schema.json', ''), schema.$id);
  }
  return {
    names: [...ids.keys()].filter((n) => n !== 'common'),
    validator(name) {
      const id = ids.get(name);
      if (!id || name === 'common') throw new Error(`no schema named ${name}`);
      return ajv.getSchema(id);
    },
    errorsText: (errors) => ajv.errorsText(errors, { separator: '\n' }),
  };
}

/** { ok, errors[] } for a parsed value. */
export function check(name, value, schemas = loadSchemas()) {
  const validate = schemas.validator(name);
  const ok = validate(value);
  return { ok: !!ok, errors: ok ? [] : schemas.errorsText(validate.errors).split('\n') };
}

if (isMain(import.meta.url)) {
  const [name, file] = process.argv.slice(2);
  const schemas = loadSchemas();
  if (!name || !file || !schemas.names.includes(name)) {
    console.error(`usage: node scripts/metrics/check.mjs <${schemas.names.join('|')}> <file>`);
    process.exit(2);
  }
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    console.error(`FAIL ${file}: not readable JSON`);
    process.exit(1);
  }
  const r = check(name, value, schemas);
  console.log(r.ok ? `ok   ${file} (${name})` : `FAIL ${file} (${name})\n     ${r.errors.join('\n     ')}`);
  process.exit(r.ok ? 0 : 1);
}
