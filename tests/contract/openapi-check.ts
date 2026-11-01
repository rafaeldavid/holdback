// Checks one HTTP exchange against spec/openapi.json (T-015): the route and method are documented, the status
// is one the operation lists, every required header is present and valid, the content type is a documented
// one, and a JSON body validates against its schema. With `request`, a JSON request body that the operator
// accepted is checked against the operation's request schema too, so a request schema tighter than the
// operator would show up (D31: no bounds the operator does not have).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain ESM helper without type declarations
import { openApiValidators, resolvePointer } from '../../scripts/openapi.mjs';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const DOC: J = JSON.parse(readFileSync(fileURLToPath(new URL('../../spec/openapi.json', import.meta.url)), 'utf8'));
const { validator, ajv } = openApiValidators(DOC) as { validator: (pointer: string) => (((v: unknown) => boolean) & { errors?: unknown }) | undefined; ajv: { errorsText(e: unknown): string } };

const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const METHODS = ['get', 'post'];

/** Literal templates first, so /v1/prepare/offer never matches a parameterized sibling. */
const ROUTES = Object.keys(DOC.paths)
  .map((template) => ({ template, params: (template.match(/\{/g) ?? []).length, re: new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '([^/]+)')}$`) }))
  .sort((a, b) => a.params - b.params);

export function routeOf(method: string, pathname: string): { template: string; op: J; pointer: string } | undefined {
  for (const r of ROUTES) {
    const op = DOC.paths[r.template][method.toLowerCase()];
    if (op && METHODS.includes(method.toLowerCase()) && r.re.test(pathname)) return { template: r.template, op, pointer: `/paths/${esc(r.template)}/${method.toLowerCase()}` };
  }
  return undefined;
}

/** Follows non-schema $refs (responses, headers); returns the node and the pointer it lives at. */
function deref(node: J, pointer: string): { node: J; pointer: string } {
  while (node && typeof node.$ref === 'string') {
    pointer = node.$ref.slice(1);
    node = resolvePointer(DOC, pointer);
  }
  return { node, pointer };
}

function validate(pointer: string, value: unknown, what: string, errors: string[]): void {
  const v = validator(pointer);
  if (!v) return void errors.push(`${what}: no schema at ${pointer}`);
  if (!v(value)) errors.push(`${what}: ${ajv.errorsText(v.errors)}`);
}

export interface Exchange {
  method: string;
  url: URL;
  status: number;
  headers: Headers;
  /** Undefined for a stream whose body is checked separately. */
  body?: Buffer;
  request?: { contentType?: string; body?: string };
}

export interface Checked {
  operationId?: string;
  template?: string;
  errors: string[];
}

export function checkExchange(x: Exchange): Checked {
  const errors: string[] = [];
  const route = routeOf(x.method, x.url.pathname);
  if (!route) return { errors: [`${x.method} ${x.url.pathname} is not in the document`] };
  const where = `${route.op.operationId} ${x.status}`;
  const declared = route.op.responses[String(x.status)];
  if (!declared) return { operationId: route.op.operationId, template: route.template, errors: [`${where}: status ${x.status} is not listed (${Object.keys(route.op.responses).join(', ')})`] };
  const res = deref(declared, `${route.pointer}/responses/${x.status}`);
  for (const [name, h] of Object.entries<J>(res.node.headers ?? {})) {
    const header = deref(h, `${res.pointer}/headers/${esc(name)}`);
    const value = x.headers.get(name);
    if (value === null) {
      if (header.node.required) errors.push(`${where}: missing required header ${name}`);
      continue;
    }
    validate(`${header.pointer}/schema`, value, `${where} header ${name}`, errors);
  }
  const mediaType = (x.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const content = res.node.content ?? {};
  if (!(mediaType in content)) errors.push(`${where}: content type ${mediaType || '(none)'} is not one of ${Object.keys(content).join(', ')}`);
  else if (x.body !== undefined && /json$/.test(mediaType)) {
    let body: unknown;
    try {
      body = JSON.parse(x.body.toString('utf8'));
    } catch {
      errors.push(`${where}: the body is not JSON`);
    }
    if (body !== undefined) {
      validate(`${res.pointer}/content/${esc(mediaType)}/schema`, body, `${where} body`, errors);
      if (mediaType === 'application/problem+json') {
        const p = body as { status?: number; instance?: string };
        if (p.status !== x.status) errors.push(`${where}: problem status ${p.status} differs from the HTTP status`);
        if (p.instance !== `urn:holdback:request:${x.headers.get('request-id')}`) errors.push(`${where}: problem instance does not repeat Request-Id`);
      }
    }
  }
  const dryRun = x.url.searchParams.get('validateOnly') === 'true';
  if (x.status < 300 && !dryRun && x.request?.body !== undefined && x.request.contentType?.startsWith('application/json')) {
    const schema = route.op.requestBody?.content?.['application/json'];
    if (!schema) errors.push(`${where}: sent JSON, but the operation documents no JSON request body`);
    else validate(`${route.pointer}/requestBody/content/application~1json/schema`, JSON.parse(x.request.body), `${where} request`, errors);
  }
  return { operationId: route.op.operationId, template: route.template, errors };
}

/** Validates a value against a schema pointer of the document (for stream items and unit checks). */
export function checkValue(pointer: string, value: unknown): string[] {
  const errors: string[] = [];
  validate(pointer, value, pointer, errors);
  return errors;
}

/** Every operation in the document as `METHOD template`, with its operationId. */
export const OPERATIONS: Array<{ key: string; operationId: string }> = Object.entries<J>(DOC.paths).flatMap(([template, item]) =>
  Object.entries<J>(item).map(([method, op]) => ({ key: `${method.toUpperCase()} ${template}`, operationId: op.operationId as string })),
);
