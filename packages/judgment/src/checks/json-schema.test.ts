import { describe, expect, it } from 'vitest';
import { compileJsonSchema } from './json-schema.js';

const v = (schema: unknown) => {
  const r = compileJsonSchema(schema);
  if (!r.ok) throw new Error(r.error);
  return (x: unknown) => r.value(x) === undefined;
};

describe('declarative JSON Schema subset', () => {
  it('type, including integer and arrays of types', () => {
    expect(v({ type: 'integer' })(3)).toBe(true);
    expect(v({ type: 'integer' })(3.5)).toBe(false);
    expect(v({ type: 'number' })(3.5)).toBe(true);
    expect(v({ type: ['string', 'null'] })(null)).toBe(true);
    expect(v({ type: ['string', 'null'] })(1)).toBe(false);
    expect(v({ type: 'object' })([])).toBe(false);
    expect(v({ type: 'array' })([])).toBe(true);
  });
  it('properties, required, additionalProperties', () => {
    const s = { type: 'object', required: ['a'], properties: { a: { type: 'string' } }, additionalProperties: false };
    expect(v(s)({ a: 'x' })).toBe(true);
    expect(v(s)({})).toBe(false);
    expect(v(s)({ a: 'x', b: 1 })).toBe(false);
    expect(v({ additionalProperties: { type: 'number' } })({ z: 1 })).toBe(true);
    expect(v({ additionalProperties: { type: 'number' } })({ z: 'q' })).toBe(false);
  });
  it('does not treat inherited names as properties', () => {
    expect(v({ type: 'object', required: ['constructor'] })({})).toBe(false);
    expect(v({ type: 'object', required: ['__proto__'] })(JSON.parse('{"__proto__": 1}'))).toBe(true);
  });
  it('items, minItems, maxItems, uniqueItems', () => {
    expect(v({ items: { type: 'integer' }, minItems: 1, maxItems: 2 })([1, 2])).toBe(true);
    expect(v({ items: { type: 'integer' }, minItems: 1 })([])).toBe(false);
    expect(v({ maxItems: 1 })([1, 2])).toBe(false);
    expect(v({ uniqueItems: true })([{ a: 1 }, { a: 1 }])).toBe(false);
    expect(v({ uniqueItems: true })([{ a: 1, b: 2 }, { b: 2, a: 3 }])).toBe(true);
  });
  it('numbers and strings', () => {
    expect(v({ minimum: 1, maximum: 2 })(2)).toBe(true);
    expect(v({ exclusiveMaximum: 2 })(2)).toBe(false);
    expect(v({ exclusiveMinimum: 0 })(0)).toBe(false);
    expect(v({ minLength: 2, maxLength: 3 })('ab')).toBe(true);
    expect(v({ maxLength: 1 })('\u{1F600}')).toBe(true);
    expect(v({ pattern: 'b+' })('abba')).toBe(true);
    expect(v({ pattern: '^b+$' })('abba')).toBe(false);
  });
  it('enum, const, anyOf, allOf, oneOf, not', () => {
    expect(v({ enum: [1, 'a', { x: 1 }] })({ x: 1 })).toBe(true);
    expect(v({ enum: [1] })(2)).toBe(false);
    expect(v({ const: [1, 2] })([1, 2])).toBe(true);
    expect(v({ anyOf: [{ type: 'string' }, { type: 'integer' }] })(1)).toBe(true);
    expect(v({ allOf: [{ minimum: 1 }, { maximum: 1 }] })(2)).toBe(false);
    expect(v({ oneOf: [{ minimum: 0 }, { maximum: 10 }] })(5)).toBe(false);
    expect(v({ not: { type: 'string' } })(1)).toBe(true);
  });
  it('ignores annotation keywords', () => {
    expect(v({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 't', description: 'd', type: 'array' })([])).toBe(true);
  });
  it('refuses anything that could fetch, reference or run something', () => {
    for (const s of [{ $ref: '#/x' }, { $id: 'x' }, { $dynamicRef: 'x' }, { format: 'email' }, { patternProperties: {} }, { if: {} }, { unevaluatedProperties: false }]) {
      expect(compileJsonSchema(s).ok, JSON.stringify(s)).toBe(false);
    }
  });
  it('refuses unsafe patterns and over-deep schemas', () => {
    expect(compileJsonSchema({ pattern: '(a)\\1' }).ok).toBe(false);
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 40; i++) deep = { items: deep };
    expect(compileJsonSchema(deep).ok).toBe(false);
  });
  it('refuses non-object schemas and malformed keyword values', () => {
    expect(compileJsonSchema('x').ok).toBe(false);
    expect(compileJsonSchema({ required: 'a' }).ok).toBe(false);
    expect(compileJsonSchema({ type: 'tuple' }).ok).toBe(false);
  });
});
