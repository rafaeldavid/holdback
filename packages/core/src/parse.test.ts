import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCommitment, parseMessage, parsers } from './parse.js';

const exampleDir = new URL('../../../spec/examples/', import.meta.url);
const schemaDir = new URL('../../../spec/schemas/', import.meta.url);
const examples = readdirSync(exampleDir)
  .filter((f) => f.endsWith('.example.json'))
  .map((file) => ({ file, data: JSON.parse(readFileSync(new URL(file, exampleDir), 'utf8')) as unknown }));
const schemaNames = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.schema.json'))
  .map((f) => f.replace('.schema.json', ''));

function example(file: string): Record<string, unknown> {
  const found = examples.find((e) => e.file === file);
  if (!found) throw new Error(`missing example ${file}`);
  return structuredClone(found.data) as Record<string, unknown>;
}

describe('boundary parsers', () => {
  it('has a parser for every schema except the shared definitions', () => {
    expect(Object.keys(parsers).sort()).toEqual(schemaNames.filter((n) => n !== 'common').sort());
  });

  it('covers every example file', () => {
    expect(examples.length).toBeGreaterThanOrEqual(15);
  });

  it.each(examples.map((e) => [e.file, e.data] as const))('round-trips %s', (file, data) => {
    const parse = parsers[file.split('.')[0] as keyof typeof parsers];
    const first = parse(data);
    expect(first).toEqual({ ok: true, value: data });
    if (!first.ok) return;
    const again = parse(JSON.parse(JSON.stringify(first.value)));
    expect(again).toEqual(first);
  });

  it('refuses a fractional amount with invalid_terms and names the path', () => {
    const c = example('commitment.example.json');
    (c['price'] as Record<string, unknown>)['amount'] = '2000.5';
    const r = parseCommitment(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('invalid_terms');
      expect(r.error.detail).toContain('/price/amount');
    }
  });

  it('refuses non-objects', () => {
    expect(parseCommitment('nope').ok).toBe(false);
    expect(parseCommitment(null).ok).toBe(false);
  });

  it('refuses settle_after_window in Phase 1', () => {
    const c = example('commitment.example.json');
    (c['settlement'] as Record<string, unknown>)['mode'] = 'settle_after_window';
    const r = parseCommitment(c);
    expect(r).toMatchObject({ ok: false, error: { type: 'invalid_terms' } });
    if (!r.ok) expect(r.error.detail).toContain('guaranteed_on_decision');
  });

  it('refuses maxSubmissions above 1 in Phase 1', () => {
    const c = example('commitment.example.json');
    (c['timing'] as Record<string, unknown>)['maxSubmissions'] = 2;
    const r = parseCommitment(c);
    expect(r).toMatchObject({ ok: false, error: { type: 'invalid_terms' } });
    if (!r.ok) expect(r.error.detail).toContain('maxSubmissions');
  });

  it('narrows messages by type', () => {
    const r = parseMessage(example('messages.decision.example.json'));
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === 'Decision') expect(r.value.outcome).toBe('accept');
  });

  it('refuses a message with an unknown type', () => {
    const m = example('messages.decision.example.json');
    m['type'] = 'Steal';
    expect(parseMessage(m).ok).toBe(false);
  });
});
