// An interpreter for a declarative JSON Schema subset, for the `json_schema` check. The schema comes
// from the commitment, so it is never compiled to code (Ajv generates JavaScript from schemas) and
// never resolves references: it is walked as data. Unknown keywords are refused, not ignored, so a
// schema cannot quietly mean less than the parties thought.
import { canonicalJson, err, ok, type Result } from '@holdback/core';
import { compileSafeRegex, type SafeRegex, type StepBudget } from './safe-regex.js';

export const MAX_SCHEMA_DEPTH = 32;
export const MAX_SCHEMA_NODES = 2000;

/** Returns undefined when valid, or a short reason. Spends one budget unit per subschema visit. */
export type Validator = (value: unknown, budget?: StepBudget) => string | undefined;

const ANNOTATIONS = new Set(['$schema', 'title', 'description', '$comment', 'examples', 'default']);
const TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);

class SchemaError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const count = (s: string) => [...s].length;

function num(v: unknown, k: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SchemaError(`${k} must be a number`);
  return v;
}
function nonNegInt(v: unknown, k: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new SchemaError(`${k} must be a non-negative integer`);
  return v;
}

function compile(schema: unknown, depth: number, budget: { nodes: number }): Validator {
  if (depth > MAX_SCHEMA_DEPTH) throw new SchemaError(`schema deeper than ${MAX_SCHEMA_DEPTH}`);
  if (++budget.nodes > MAX_SCHEMA_NODES) throw new SchemaError(`schema has more than ${MAX_SCHEMA_NODES} subschemas`);
  if (schema === true) return () => undefined;
  if (schema === false) return () => 'false schema';
  if (!isObject(schema)) throw new SchemaError('a schema must be an object or boolean');
  const sub = (s: unknown) => compile(s, depth + 1, budget);
  const checks: Validator[] = [];

  for (const [k, v] of Object.entries(schema)) {
    if (ANNOTATIONS.has(k)) continue;
    switch (k) {
      case 'type': {
        const ts = Array.isArray(v) ? v : [v];
        if (ts.length === 0 || !ts.every((t) => typeof t === 'string' && TYPES.has(t))) throw new SchemaError('type must name JSON types');
        checks.push((x) => (ts.some((t) => typeOf(x) === t || (t === 'integer' && Number.isInteger(x)) || (t === 'number' && typeof x === 'number')) ? undefined : `expected ${ts.join('|')}`));
        break;
      }
      case 'enum':
        if (!Array.isArray(v)) throw new SchemaError('enum must be an array');
        checks.push((x) => (v.some((e) => same(e, x)) ? undefined : 'not in enum'));
        break;
      case 'const':
        checks.push((x) => (same(v, x) ? undefined : 'not equal to const'));
        break;
      case 'properties': {
        if (!isObject(v)) throw new SchemaError('properties must be an object');
        const props = Object.entries(v).map(([name, s]) => [name, sub(s)] as const);
        checks.push((x, b) => {
          if (!isObject(x)) return undefined;
          for (const [name, val] of props) if (own(x, name)) {
            const e = val(x[name], b);
            if (e) return `/${name}: ${e}`;
          }
          return undefined;
        });
        break;
      }
      case 'required': {
        if (!Array.isArray(v) || !v.every((r) => typeof r === 'string')) throw new SchemaError('required must be an array of strings');
        checks.push((x) => (isObject(x) ? (v.find((r) => !own(x, r)) === undefined ? undefined : `missing ${v.find((r) => !own(x, r))}`) : undefined));
        break;
      }
      case 'additionalProperties': {
        const known = isObject(schema.properties) ? new Set(Object.keys(schema.properties)) : new Set<string>();
        const val = sub(v);
        checks.push((x, b) => {
          if (!isObject(x)) return undefined;
          for (const name of Object.keys(x)) if (!known.has(name)) {
            const e = val(x[name], b);
            if (e) return `/${name}: additional property ${e}`;
          }
          return undefined;
        });
        break;
      }
      case 'items': {
        const val = sub(v);
        checks.push((x, b) => {
          if (!Array.isArray(x)) return undefined;
          for (const [i, item] of x.entries()) {
            const e = val(item, b);
            if (e) return `/${i}: ${e}`;
          }
          return undefined;
        });
        break;
      }
      case 'minItems': {
        const n = nonNegInt(v, k);
        checks.push((x) => (Array.isArray(x) && x.length < n ? `fewer than ${n} items` : undefined));
        break;
      }
      case 'maxItems': {
        const n = nonNegInt(v, k);
        checks.push((x) => (Array.isArray(x) && x.length > n ? `more than ${n} items` : undefined));
        break;
      }
      case 'uniqueItems':
        if (typeof v !== 'boolean') throw new SchemaError('uniqueItems must be boolean');
        if (v) checks.push((x) => (Array.isArray(x) && new Set(x.map((i) => canonicalJson(i))).size !== x.length ? 'items not unique' : undefined));
        break;
      case 'minimum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x < n ? `below ${n}` : undefined));
        break;
      }
      case 'maximum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x > n ? `above ${n}` : undefined));
        break;
      }
      case 'exclusiveMinimum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x <= n ? `not above ${n}` : undefined));
        break;
      }
      case 'exclusiveMaximum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x >= n ? `not below ${n}` : undefined));
        break;
      }
      case 'minLength': {
        const n = nonNegInt(v, k);
        checks.push((x) => (typeof x === 'string' && count(x) < n ? `shorter than ${n}` : undefined));
        break;
      }
      case 'maxLength': {
        const n = nonNegInt(v, k);
        checks.push((x) => (typeof x === 'string' && count(x) > n ? `longer than ${n}` : undefined));
        break;
      }
      case 'pattern': {
        if (typeof v !== 'string') throw new SchemaError('pattern must be a string');
        const r = compileSafeRegex(v);
        if (!r.ok) throw new SchemaError(`pattern: ${r.error}`);
        const re: SafeRegex = r.value;
        checks.push((x, b) => (typeof x === 'string' && !re.search(x, b) ? 'does not match pattern' : undefined));
        break;
      }
      case 'anyOf':
      case 'allOf':
      case 'oneOf': {
        if (!Array.isArray(v) || v.length === 0) throw new SchemaError(`${k} must be a non-empty array`);
        const vals = v.map(sub);
        checks.push((x, b) => {
          const passing = vals.filter((val) => val(x, b) === undefined).length;
          if (k === 'allOf') return passing === vals.length ? undefined : 'allOf not satisfied';
          if (k === 'anyOf') return passing > 0 ? undefined : 'anyOf not satisfied';
          return passing === 1 ? undefined : `oneOf matched ${passing}`;
        });
        break;
      }
      case 'not': {
        const val = sub(v);
        checks.push((x, b) => (val(x, b) === undefined ? 'matches not' : undefined));
        break;
      }
      default:
        throw new SchemaError(`keyword ${k.slice(0, 40)} is not supported`);
    }
  }
  return (x, b) => {
    b?.spend(1);
    for (const c of checks) {
      const e = c(x, b);
      if (e) return e;
    }
    return undefined;
  };
}

export function compileJsonSchema(schema: unknown): Result<Validator, string> {
  try {
    return ok(compile(schema, 0, { nodes: 0 }));
  } catch (e) {
    if (e instanceof SchemaError) return err(e.message);
    throw e;
  }
}
