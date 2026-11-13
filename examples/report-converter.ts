// Seller: turn your API's report into your deal template's JSON with a mapping file, and no code (T-323).
// Your API already returns a report in its own JSON shape. The deal's checks want the template's shape. A mapping
// file says, field by field, where each template field comes from. The seller adapter (seller-adapter.ts) converts
// each result with it when its configuration names one (`reportMapping`), then runs the checks on the converted
// bytes and delivers those.
//
// A mapping file is JSON: {"version": 1, "description"?: "…", "report": <node>}. A node is one of:
//   "text", 12, true, null        a constant, written into the report as it stands
//   {"field": <node>, …}          an object; a field whose node gives nothing is left out
//   [<node>, …]                   a list of fixed length
//   {"$path": "a.b[0].c"}         the value at that path in the report. Inside a $each item a path starts at the
//                                 item; "$.a" starts at the report; "." is the item itself
//     + "$as": "integer"          text such as "88" read as the whole number 88 ("string": a whole number as text)
//     + "$map": {"high": "High"}  a value map: the report's text on the left, the template's value on the right
//   {"$each": "path", "$item": <node>}   a list: <node> for each item of the report's list at that path
//   {"$concat": [<node>, …]}      the lists those nodes give, one after another
//   {"$value": <node>}            <node>, so that $when can go with it
//   {"$const": <any JSON>}        a constant that is never read as a node
// with these on $path and $each:
//   "$optional": true             a missing value leaves the field out
//   "$default": <any JSON>        a missing value gives this one
// and this on any directive:
//   "$when": "path"               the field is left out unless the report has a value at that path
// A value that is absent or null is missing. A missing value with neither $optional nor $default refuses the report.
//
// Nothing in a mapping or a report runs as code: the converter reads values at paths, copies them and looks them
// up in value maps. A report the mapping cannot convert is refused, and the message names the template field. The
// converted report holds whole numbers only, never a fraction (no float in a hashed body).
//
//   node examples/report-converter.ts <mapping.json> <report.json>     (prints the converted report, or the refusal)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Path {
  root: boolean;
  segs: Array<string | number>;
  text: string;
}
type Missing = { kind: 'error' } | { kind: 'omit' } | { kind: 'default'; value: J };
type Node =
  | { k: 'const'; value: J }
  | { k: 'object'; fields: Array<[string, Node]> }
  | { k: 'array'; items: Node[] }
  | { k: 'path'; path: Path; as?: 'string' | 'integer'; map?: Record<string, J>; missing: Missing; when?: Path }
  | { k: 'each'; path: Path; item: Node; missing: Missing; when?: Path }
  | { k: 'concat'; parts: Node[]; when?: Path }
  | { k: 'value'; node: Node; when?: Path };

/** A mapping file, checked. Build one with loadReportMapping or parseReportMapping. */
export interface ReportMapping {
  readonly description?: string;
  readonly root: Node;
}

/** A report the mapping cannot convert. `field` is the template field, such as `findings[1].severity`. */
export class ReportNotConverted extends Error {
  readonly field: string;
  constructor(field: string, detail: string) {
    super(field ? `${field}: ${detail}` : detail);
    this.field = field;
  }
}

const DIRECTIVES = ['$path', '$const', '$each', '$concat', '$value', '$item', '$map', '$as', '$optional', '$default', '$when'];
const SOURCES = ['$path', '$const', '$each', '$concat', '$value'];
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const PATH = /^(?:\$|\.|(?:\$\.)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+|\[(?:0|[1-9][0-9]{0,8})\])*)$/;
const WHOLE_TEXT = /^-?(?:0|[1-9][0-9]*)$/;
const MAX_DEPTH = 100;

const isObject = (v: unknown): v is Record<string, J> => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v: unknown) => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 80 ? `${s.slice(0, 80)}...` : s;
};
const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'an object' : typeof v === 'string' ? 'text' : typeof v === 'number' ? 'a number' : 'true or false');
const key = (at: string, k: string) => (at ? `${at}.${k}` : k);

// ---- Loading: a mapping is checked whole before it converts anything ----

class MappingError extends Error {}
const bad = (at: string, detail: string): never => {
  throw new MappingError(`mapping ${at}: ${detail}`);
};

function parsePath(at: string, text: unknown): Path {
  if (typeof text !== 'string' || !PATH.test(text)) {
    bad(at, `${show(text)} is not a path (keys of letters, digits, _ and -, joined by dots, with [n] for an item; "." is the item itself; "$." starts at the report)`);
  }
  const t = text as string;
  if (t === '.' || t === '$') return { root: t === '$', segs: [], text: t };
  const root = t.startsWith('$.');
  const segs: Array<string | number> = [];
  for (const [, name, index] of (root ? t.slice(2) : t).matchAll(/([A-Za-z0-9_-]+)|\[([0-9]+)\]/g)) {
    if (name !== undefined && FORBIDDEN.has(name)) bad(at, `${show(t)} names __proto__, constructor or prototype`);
    segs.push(name ?? Number(index));
  }
  return { root, segs, text: t };
}

/** Plain JSON data: whole numbers only, and no key that could reach a prototype. */
function data(at: string, v: J, depth: number): J {
  if (depth > MAX_DEPTH) bad(at, `nests deeper than ${MAX_DEPTH} levels`);
  if (typeof v === 'number' && !Number.isSafeInteger(v)) bad(at, `${v} is not a whole number`);
  if (Array.isArray(v)) v.forEach((x, i) => data(`${at}[${i}]`, x, depth + 1));
  else if (isObject(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN.has(k)) bad(at, `the key ${k} is not allowed`);
      data(key(at, k), x, depth + 1);
    }
  }
  return v;
}

function parseNode(at: string, v: J, depth: number): Node {
  if (depth > MAX_DEPTH) bad(at, `nests deeper than ${MAX_DEPTH} levels`);
  if (!isObject(v)) {
    if (Array.isArray(v)) return { k: 'array', items: v.map((x, i) => parseNode(`${at}[${i}]`, x, depth + 1)) };
    return { k: 'const', value: data(at, v, depth) };
  }
  const keys = Object.keys(v);
  if (!keys.some((k) => k.startsWith('$'))) {
    return {
      k: 'object',
      fields: keys.map((k) => {
        if (FORBIDDEN.has(k)) bad(at, `the key ${k} is not allowed`);
        return [k, parseNode(key(at, k), v[k], depth + 1)] as [string, Node];
      }),
    };
  }
  for (const k of keys) if (!DIRECTIVES.includes(k)) bad(at, `${k} is not a directive (use ${DIRECTIVES.join(', ')})`);
  const sources = keys.filter((k) => SOURCES.includes(k));
  if (sources.length !== 1) bad(at, 'name one source: $path, $const, $each, $concat or $value');
  const source = sources[0]!;
  const has = (k: string) => Object.hasOwn(v, k);
  if (source === '$each' && !has('$item')) bad(at, '$each needs $item');
  if (source !== '$each' && has('$item')) bad(at, '$item goes with $each only');
  if (source !== '$path' && (has('$map') || has('$as'))) bad(at, '$map and $as go with $path only');
  if (source !== '$path' && source !== '$each' && (has('$optional') || has('$default'))) bad(at, '$optional and $default go with $path or $each');
  if (has('$optional') && has('$default')) bad(at, 'use $optional or $default, not both');
  if (has('$optional') && v.$optional !== true) bad(at, '$optional is true or left out');
  const when = has('$when') ? { when: parsePath(at, v.$when) } : {};
  const missing: Missing = has('$default') ? { kind: 'default', value: data(`${at}.$default`, v.$default, depth + 1) } : has('$optional') ? { kind: 'omit' } : { kind: 'error' };

  if (source === '$const') return { k: 'value', node: { k: 'const', value: data(`${at}.$const`, v.$const, depth + 1) }, ...when };
  if (source === '$value') return { k: 'value', node: parseNode(`${at}.$value`, v.$value, depth + 1), ...when };
  if (source === '$concat') {
    if (!Array.isArray(v.$concat)) bad(at, '$concat is a list of nodes');
    return { k: 'concat', parts: (v.$concat as J[]).map((x, i) => parseNode(`${at}.$concat[${i}]`, x, depth + 1)), ...when };
  }
  if (source === '$each') return { k: 'each', path: parsePath(at, v.$each), item: parseNode(`${at}.$item`, v.$item, depth + 1), missing, ...when };
  const node: Node = { k: 'path', path: parsePath(at, v.$path), missing, ...when };
  if (has('$as')) {
    if (v.$as !== 'string' && v.$as !== 'integer') bad(at, '$as is "string" or "integer"');
    node.as = v.$as;
  }
  if (has('$map')) {
    if (!isObject(v.$map)) bad(at, '$map is an object of report values to template values');
    node.map = data(`${at}.$map`, v.$map, depth + 1);
  }
  return node;
}

/** Checks a parsed mapping file. Throws an Error that names the mapping's field when it is not a mapping. */
export function parseReportMapping(value: unknown): ReportMapping {
  if (!isObject(value)) throw new MappingError('mapping: a mapping is a JSON object');
  for (const k of Object.keys(value)) if (!['version', 'description', 'report'].includes(k)) throw new MappingError(`mapping: ${k} is not a field of a mapping (version, description, report)`);
  if (value.version !== 1) throw new MappingError('mapping: version must be 1');
  if (!Object.hasOwn(value, 'report')) throw new MappingError('mapping: report is missing');
  if (value.description !== undefined && typeof value.description !== 'string') throw new MappingError('mapping: description is text');
  return { ...(value.description === undefined ? {} : { description: value.description as string }), root: parseNode('report', value.report, 0) };
}

/** Reads and checks a mapping file. The error names the file and the mapping's field. */
export function loadReportMapping(file: string): ReportMapping {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error((e as NodeJS.ErrnoException).code ? `${file} cannot be read: ${(e as Error).message}` : `${file} is not JSON`);
  }
  try {
    return parseReportMapping(value);
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
}

// ---- Converting ----

const OMIT = Symbol('omit');
interface Ctx {
  root: J;
  item: J;
  /** Where the item sits in the report, such as `issues[1]`; empty at the report itself. */
  where: string;
}

function resolve(path: Path, ctx: Ctx): { value: J; where: string } {
  let value = path.root ? ctx.root : ctx.item;
  let where = path.root ? '' : ctx.where;
  for (const s of path.segs) {
    where = typeof s === 'number' ? `${where}[${s}]` : key(where, s);
    if (typeof s === 'number') value = Array.isArray(value) && s < value.length ? value[s] : undefined;
    else value = isObject(value) && Object.hasOwn(value, s) ? value[s] : undefined;
  }
  return { value, where: where || 'the report' };
}
const isMissing = (v: J) => v === undefined || v === null;

/** A value copied from the report holds whole numbers only. */
function wholeNumbers(v: J, field: string): J {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new ReportNotConverted(field, `the converted report would hold ${v}, a number that is not a whole number`);
  if (Array.isArray(v)) v.forEach((x, i) => wholeNumbers(x, `${field}[${i}]`));
  else if (isObject(v)) for (const [k, x] of Object.entries(v)) wholeNumbers(x, key(field, k));
  return v;
}

function onMissing(missing: Missing, field: string, where: string): J {
  if (missing.kind === 'default') return missing.value;
  if (missing.kind === 'omit') return OMIT;
  throw new ReportNotConverted(field, `the report has no ${where}`);
}

function evaluate(node: Node, ctx: Ctx, field: string, offset = 0): J {
  if ('when' in node && node.when && isMissing(resolve(node.when, ctx).value)) return OMIT;
  switch (node.k) {
    case 'const':
      return node.value;
    case 'value':
      return evaluate(node.node, ctx, field, offset);
    case 'object': {
      const out: Record<string, J> = {};
      for (const [k, child] of node.fields) {
        const v = evaluate(child, ctx, key(field, k));
        if (v !== OMIT) out[k] = v;
      }
      return out;
    }
    case 'array': {
      const out: J[] = [];
      for (const child of node.items) {
        const v = evaluate(child, ctx, `${field}[${offset + out.length}]`);
        if (v !== OMIT) out.push(v);
      }
      return out;
    }
    case 'concat': {
      const out: J[] = [];
      for (const part of node.parts) {
        const v = evaluate(part, ctx, field, offset + out.length);
        if (v === OMIT) continue;
        if (!Array.isArray(v)) throw new ReportNotConverted(field, `a part of $concat gives ${kindOf(v)}, not a list`);
        out.push(...v);
      }
      return out;
    }
    case 'each': {
      const { value, where } = resolve(node.path, ctx);
      if (isMissing(value)) return onMissing(node.missing, field, where);
      if (!Array.isArray(value)) throw new ReportNotConverted(field, `${where} is ${kindOf(value)}, not a list`);
      const out: J[] = [];
      value.forEach((item, i) => {
        const v = evaluate(node.item, { root: ctx.root, item, where: `${where === 'the report' ? '' : where}[${i}]` }, `${field}[${offset + out.length}]`);
        if (v !== OMIT) out.push(v);
      });
      return out;
    }
    case 'path': {
      const { value, where } = resolve(node.path, ctx);
      if (isMissing(value)) return onMissing(node.missing, field, where);
      let v: J = value;
      if (node.as === 'integer') {
        if (typeof v === 'string' && WHOLE_TEXT.test(v) && Number.isSafeInteger(Number(v))) v = Number(v);
        else if (!(typeof v === 'number' && Number.isSafeInteger(v))) throw new ReportNotConverted(field, `${where} is ${show(v)}, not a whole number`);
      } else if (node.as === 'string') {
        if (typeof v === 'number' && Number.isSafeInteger(v)) v = String(v);
        else if (typeof v !== 'string') throw new ReportNotConverted(field, `${where} is ${kindOf(v)}, not text or a whole number`);
      }
      if (node.map) {
        if (typeof v !== 'string') throw new ReportNotConverted(field, `${where} is ${kindOf(v)}, and the value map takes text`);
        if (!Object.hasOwn(node.map, v)) {
          const listed = Object.keys(node.map);
          throw new ReportNotConverted(field, `${where} is ${show(v)}, which the mapping does not list (it lists ${listed.slice(0, 20).map((x) => show(x)).join(', ')}${listed.length > 20 ? ', ...' : ''})`);
        }
        return node.map[v];
      }
      return wholeNumbers(v, field);
    }
  }
}

/**
 * Converts a report's bytes (UTF-8 JSON in the seller's shape) into the template's JSON, as the bytes the adapter
 * checks and delivers: two-space indented, with a closing newline. Throws ReportNotConverted, naming the template
 * field, when the mapping cannot convert the report.
 */
export function convertReport(mapping: ReportMapping, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ReportNotConverted('', 'the report is not UTF-8 text');
  }
  let report: J;
  try {
    report = JSON.parse(text);
  } catch {
    throw new ReportNotConverted('', 'the report is not JSON');
  }
  const out = evaluate(mapping.root, { root: report, item: report, where: '' }, '');
  if (out === OMIT) throw new ReportNotConverted('', 'the mapping gives no report');
  return new TextEncoder().encode(`${JSON.stringify(out, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mappingFile, reportFile] = process.argv.slice(2);
  const { plain } = await import('@holdback/testkit');
  const { help, helpAsked } = await import('./help.ts');
  const asked = helpAsked(process.argv.slice(2));
  if (asked !== null || !mappingFile || !reportFile) {
    (asked === 0 ? console.log : console.error)(help('report-converter', import.meta.url));
    process.exit(asked ?? 2);
  }
  try {
    process.stdout.write(convertReport(loadReportMapping(mappingFile), readFileSync(reportFile)));
  } catch (e) {
    console.error(`report-converter: ${plain((e as Error).message)}`);
    process.exit(e instanceof ReportNotConverted ? 1 : 2);
  }
}
