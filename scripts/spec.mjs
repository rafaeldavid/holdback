// Loads spec/schemas into one Ajv instance and pairs each example with the schema named by its first dot-segment
// (`messages.decision.example.json` validates against `messages.schema.json`).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = new URL('..', import.meta.url).pathname;
const schemaDir = join(root, 'spec/schemas');
const exampleDir = join(root, 'spec/examples');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function loadSpec() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  // ADR-0017 §9: marks party-authored strings; annotation only, no validation effect.
  ajv.addKeyword({ keyword: 'x-holdback-untrusted', schemaType: 'boolean' });
  const schemas = new Map();
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'))) {
    const schema = readJson(join(schemaDir, file));
    ajv.addSchema(schema);
    schemas.set(file.replace('.schema.json', ''), schema.$id);
  }
  const examples = readdirSync(exampleDir)
    .filter((f) => f.endsWith('.example.json'))
    .map((file) => ({ file, name: file.replace('.example.json', ''), data: readJson(join(exampleDir, file)) }));
  return { ajv, schemas, examples };
}

export function validateExamples() {
  const { ajv, schemas, examples } = loadSpec();
  return examples.map(({ file, name, data }) => {
    const id = schemas.get(name.split('.')[0]);
    if (!id) return { file, ok: false, errors: [`no schema named ${name.split('.')[0]}.schema.json`] };
    const validate = ajv.getSchema(id);
    const ok = validate(data);
    return { file, ok, errors: ok ? [] : ajv.errorsText(validate.errors).split(', ') };
  });
}
