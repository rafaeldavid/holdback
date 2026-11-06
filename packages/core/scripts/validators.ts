// Writes packages/core/src/validators.generated.ts from spec/schemas (T-233): the validators the parsers run,
// compiled ahead of time. Run it after any change to spec/schemas or to Ajv's version:
//
//   node packages/core/scripts/validators.ts
//
// packages/core/src/validators.test.ts fails while the checked-in file is stale.
import { writeFileSync } from 'node:fs';
import { schemaFiles, validatorsSource } from '../src/validators-codegen.ts';

const out = new URL('../src/validators.generated.ts', import.meta.url);
const source = validatorsSource();
writeFileSync(out, source);
console.log(`wrote packages/core/src/validators.generated.ts: ${schemaFiles().length} schemas, ${Math.round(source.length / 1024)} KiB`);
