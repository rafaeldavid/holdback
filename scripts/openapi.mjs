// `pnpm openapi`: builds spec/openapi.json (OpenAPI 3.1) from spec/schemas and the hand-written paths file
// spec/openapi/paths.json (ADR-0017 §11, T-015). No body schema is written twice:
// - every spec schema becomes components.schemas.<PascalCase file name> and every $defs entry
//   components.schemas.<def name>, with each $ref rewritten to a local #/components/schemas/... pointer;
// - a paths-file schema with `x-holdback-extends: <Name>` is that schema deep-merged with the paths file's
//   additions (`null` deletes a key, `required` lists are joined), for operator answers such as a commitment
//   state plus a receipt, which spec schemas close with additionalProperties: false;
// - every operation gets the problem responses its `x-holdback-errors` lists, plus 500, and every response
//   the Request-Id and Holdback-Schema-Version headers.
// `pnpm validate:spec` rebuilds it in memory and fails when the committed file differs (`checkOpenApi`).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { API_PROBLEM_TYPES } from '../apps/operator/src/problems.ts';

const root = new URL('..', import.meta.url).pathname;
export const OPENAPI_FILE = join(root, 'spec/openapi.json');
const PATHS_FILE = join(root, 'spec/openapi/paths.json');
const SCHEMA_DIR = join(root, 'spec/schemas');
const SCHEMAS = '#/components/schemas/';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const pascal = (file) => file.replace('.schema.json', '').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');

/** Applies `f` to every $ref string under `node`, returning a copy. */
function mapRefs(node, f) {
  if (Array.isArray(node)) return node.map((x) => mapRefs(x, f));
  if (!isObject(node)) return node;
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === '$ref' && typeof v === 'string' ? f(v) : mapRefs(v, f)]));
}

/** spec/schemas as flat components: top-level bodies by file name, $defs by their own names. */
export function schemaComponents(dir = SCHEMA_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
  const out = {};
  const add = (name, schema, from) => {
    if (out[name]) throw new Error(`two spec schemas are both named ${name} (${from}); rename one or teach scripts/openapi.mjs to prefix`);
    out[name] = schema;
  };
  let version;
  for (const file of files) {
    const { $schema, $id, $defs = {}, ...body } = readJson(join(dir, file));
    void $schema;
    const v = /\/schemas\/v(\d+\.\d+)\//.exec($id)?.[1];
    if (!v || (version && v !== version)) throw new Error(`${file}: $id ${$id} does not carry the same vN.N as the other schemas`);
    version = v;
    const rewrite = (ref) => {
      const [target, pointer = ''] = ref.split('#');
      const owner = target === '' ? file : target;
      if (!files.includes(owner)) throw new Error(`${file}: $ref ${ref} names no file in spec/schemas`);
      const def = /^\/\$defs\/([^/]+)(.*)$/.exec(pointer);
      return def ? `${SCHEMAS}${def[1]}${def[2]}` : `${SCHEMAS}${pascal(owner)}${pointer}`;
    };
    for (const [name, def] of Object.entries($defs)) add(name, mapRefs(def, rewrite), file);
    // A file of $defs only (common.schema.json) has no body of its own.
    if (Object.keys(body).some((k) => !['title', 'description'].includes(k))) add(pascal(file), mapRefs(body, rewrite), file);
  }
  return { schemas: out, version };
}

/** Deep merge for x-holdback-extends: objects merge, `null` deletes, `required` lists join, other values replace. */
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else if (k === 'required' && Array.isArray(out[k]) && Array.isArray(v)) out[k] = [...new Set([...out[k], ...v])];
    else if (isObject(v) && isObject(out[k])) out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}

const PROBLEM_STATUSES = [400, 401, 402, 403, 404, 409, 413, 422, 429];

export function buildOpenApi() {
  const paths = readJson(PATHS_FILE);
  const { schemas: specSchemas, version } = schemaComponents();
  const own = paths.components.schemas;
  const schemas = { ...specSchemas };
  for (const [name, schema] of Object.entries(own)) {
    if (schemas[name]) throw new Error(`spec/openapi/paths.json defines ${name}, which spec/schemas already defines`);
    const base = schema['x-holdback-extends'];
    if (base !== undefined && !specSchemas[base]) throw new Error(`${name} extends ${base}, which is not a spec schema`);
    schemas[name] = base === undefined ? schema : { ...merge(specSchemas[base], schema) };
  }
  // The operator's problem table (apps/operator/src/problems.ts): core's types plus internal and not_implemented.
  schemas.Problem = merge(schemas.Problem, { properties: { type: { enum: [...API_PROBLEM_TYPES] } } });

  const common = { 'Request-Id': { $ref: '#/components/headers/RequestId' }, 'Holdback-Schema-Version': { $ref: '#/components/headers/SchemaVersion' } };
  const outPaths = {};
  for (const [path, item] of Object.entries(paths.paths)) {
    outPaths[path] = {};
    for (const [method, op] of Object.entries(item)) {
      const { 'x-holdback-errors': errors, ...rest } = op;
      if (!Array.isArray(errors)) throw new Error(`${method.toUpperCase()} ${path} needs x-holdback-errors (the problem statuses it can answer)`);
      for (const s of errors) if (!PROBLEM_STATUSES.includes(s)) throw new Error(`${method.toUpperCase()} ${path}: no Problem${s} response`);
      const responses = { ...rest.responses };
      for (const s of [...errors, 500]) responses[String(s)] = { $ref: `#/components/responses/Problem${s}` };
      outPaths[path][method] = { ...rest, responses };
    }
  }
  // Response objects and response components alike carry the two headers every response has.
  const withHeaders = (r) => (r.$ref ? r : { ...r, headers: { ...common, ...(r.headers ?? {}) } });
  for (const item of Object.values(outPaths)) for (const op of Object.values(item)) op.responses = Object.fromEntries(Object.entries(op.responses).map(([s, r]) => [s, withHeaders(r)]));
  const responses = Object.fromEntries(Object.entries(paths.components.responses).map(([n, r]) => [n, withHeaders(r)]));

  const doc = {
    openapi: paths.openapi,
    info: { ...paths.info, 'x-holdback-schema-version': version },
    externalDocs: paths.externalDocs,
    servers: paths.servers,
    tags: paths.tags,
    paths: outPaths,
    components: { ...paths.components, responses, schemas },
    'x-holdback-planned': paths['x-holdback-planned'],
    'x-holdback-generated': 'Generated by `pnpm openapi` from spec/schemas and spec/openapi/paths.json. Do not edit by hand.',
  };
  checkRefs(doc);
  return doc;
}

/** Every $ref in the document must resolve to a node inside it. */
export function checkRefs(doc) {
  const missing = [];
  mapRefs(doc, (ref) => {
    if (!ref.startsWith('#/')) missing.push(`${ref} (not a local reference)`);
    else if (resolvePointer(doc, ref.slice(1)) === undefined) missing.push(ref);
    return ref;
  });
  if (missing.length) throw new Error(`unresolved $ref in the OpenAPI document:\n  ${[...new Set(missing)].join('\n  ')}`);
}

export function resolvePointer(doc, pointer) {
  let node = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(node) && !Array.isArray(node)) return undefined;
    node = node[key];
    if (node === undefined) return undefined;
  }
  return node;
}

export const serialize = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

/** Every schema object in the document: components, parameters, headers, bodies; keyed by JSON pointer. */
export function schemaObjects(doc) {
  const out = {};
  for (const [name, s] of Object.entries(doc.components.schemas)) out[`/components/schemas/${name}`] = s;
  const esc = (k) => k.replace(/~/g, '~0').replace(/\//g, '~1');
  const visit = (node, pointer) => {
    if (Array.isArray(node)) return node.forEach((x, i) => visit(x, `${pointer}/${i}`));
    if (!isObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'schema' || k === 'x-holdback-item-schema') && isObject(v)) out[`${pointer}/${esc(k)}`] = v;
      else visit(v, `${pointer}/${esc(k)}`);
    }
  };
  visit(doc.paths, '/paths');
  for (const part of ['parameters', 'headers', 'responses']) visit(doc.components[part], `/components/${part}`);
  return out;
}

/**
 * Ajv 2020-12 in strict mode, with formats and the two Holdback annotation keywords, holding every schema of
 * the document under one `$defs` (references rewritten to it). Returns the Ajv instance and the `$defs` key of
 * each schema pointer; `getSchema(`${OPENAPI_SCHEMA_ID}#/$defs/${key}`)` gives a validator.
 */
export const OPENAPI_SCHEMA_ID = 'urn:holdback:openapi';
export function openApiValidators(doc, { strict = true } = {}) {
  const ajv = new Ajv2020({ strict, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-holdback-untrusted', schemaType: 'boolean' });
  ajv.addKeyword({ keyword: 'x-holdback-extends', schemaType: 'string' });
  const objects = schemaObjects(doc);
  const keys = {};
  const defs = {};
  Object.keys(objects).forEach((pointer, i) => {
    const key = pointer.startsWith('/components/schemas/') ? pointer.slice('/components/schemas/'.length) : `inline-${i}`;
    keys[pointer] = key;
    defs[key] = objects[pointer];
  });
  const rewritten = mapRefs(defs, (ref) => {
    const m = /^#\/components\/schemas\/([^/]+)(.*)$/.exec(ref);
    if (!m) throw new Error(`a schema references ${ref}, which is not under #/components/schemas`);
    return `#/$defs/${m[1]}${m[2]}`;
  });
  ajv.addSchema({ $id: OPENAPI_SCHEMA_ID, $defs: rewritten });
  return { ajv, keys, validator: (pointer) => ajv.getSchema(`${OPENAPI_SCHEMA_ID}#/$defs/${keys[pointer]}`) };
}

/** For validate:spec: the committed document equals a fresh build, and each of its schemas compiles strictly. */
export function checkOpenApiDocument({ file = OPENAPI_FILE } = {}) {
  let doc;
  try {
    doc = buildOpenApi();
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
  const errors = [];
  let committed = '';
  try {
    committed = readFileSync(file, 'utf8');
  } catch {
    errors.push('spec/openapi.json is missing; run pnpm openapi');
  }
  if (committed && committed !== serialize(doc)) errors.push('spec/openapi.json is stale: it differs from a fresh build of spec/schemas and spec/openapi/paths.json; run pnpm openapi and commit the result');
  const ids = new Map();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const where = `${method.toUpperCase()} ${path}`;
      for (const field of ['operationId', 'summary', 'description']) if (typeof op[field] !== 'string' || op[field].length === 0) errors.push(`${where} has no ${field}`);
      if (ids.has(op.operationId)) errors.push(`${where} reuses operationId ${op.operationId} (${ids.get(op.operationId)})`);
      ids.set(op.operationId, where);
      const declared = (op.parameters ?? []).map((p) => (p.$ref ? resolvePointer(doc, p.$ref.slice(1)) : p)).filter((p) => p.in === 'path').map((p) => p.name);
      for (const name of path.match(/\{[^}]+\}/g)?.map((m) => m.slice(1, -1)) ?? []) if (!declared.includes(name)) errors.push(`${where} declares no path parameter ${name}`);
    }
  }
  let compiled = 0;
  try {
    const { validator, keys } = openApiValidators(doc);
    for (const pointer of Object.keys(keys)) {
      validator(pointer);
      compiled++;
    }
  } catch (e) {
    errors.push(`a schema does not compile under Ajv strict: ${e.message}`);
  }
  return { ok: errors.length === 0, errors, summary: `${ids.size} operations, ${compiled} schemas compiled strictly, fresh` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const doc = buildOpenApi();
  writeFileSync(OPENAPI_FILE, serialize(doc));
  const ops = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  console.log(`wrote spec/openapi.json: ${ops} operations, ${Object.keys(doc.components.schemas).length} schemas (schema v${doc.info['x-holdback-schema-version']})`);
}
