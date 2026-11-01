import { canonicalKeccak } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { loadRegistryFile, loadRegistryYaml } from './registry-file.js';
import { liveRegistry } from './test-adjudicator.js';

const PATH = new URL('../../../config/judges.yaml', import.meta.url).pathname;
const LIVE_PATH = new URL('../../../config/judges-live.yaml', import.meta.url).pathname;

describe('config/judges.yaml', () => {
  const r = loadRegistryFile(PATH);
  it('loads, with pinned IDs only, and hashes the parsed document', () => {
    expect(r.ok ? 'ok' : r.error.detail).toBe('ok');
    if (!r.ok) return;
    expect(r.value.hash).toBe(canonicalKeccak(r.value.doc));
    for (const e of r.value.doc.judges) expect(e.model).not.toMatch(/latest/i);
  });
  it('can seat the appeal panel: five active judges over three families', () => {
    if (!r.ok) return;
    expect(r.value.active.length).toBeGreaterThanOrEqual(5);
    expect(new Set(r.value.active.map((e) => e.family)).size).toBeGreaterThanOrEqual(3);
  });
  it('refuses YAML with an alias model, an anchor merge or duplicate keys', () => {
    expect(loadRegistryYaml('version: 1\njudges:\n  - {id: a, provider: anthropic, family: claude, model: claude-latest, status: active}\n').ok).toBe(false);
    expect(loadRegistryYaml('version: 1\nversion: 2\njudges: []\n').ok).toBe(false);
    expect(loadRegistryYaml('version: 1\njudges:\n  - &x {id: a, provider: anthropic, family: claude, model: m-20260601, status: active}\n  - {<<: *x, id: b}\n').ok).toBe(false);
  });
  it('refuses a registry that does not hash to the bound hash', () => {
    const bad = loadRegistryFile(PATH, `0x${'00'.repeat(32)}`);
    expect(!bad.ok && bad.error.type).toBe('registry_mismatch');
  });
});

describe('config/judges-live.yaml (T-028)', () => {
  const r = loadRegistryFile(LIVE_PATH);
  it('loads with pinned, dated IDs and no placeholders', () => {
    expect(r.ok ? 'ok' : r.error.detail).toBe('ok');
    if (!r.ok) return;
    for (const e of r.value.doc.judges) {
      expect(e.model).toMatch(/@\d{4}-\d{2}-\d{2}$/);
      expect(e.model).not.toMatch(/placeholder|latest/i);
    }
    expect(liveRegistry().hash).toBe(r.value.hash);
  });
  it('seats a first-instance panel and a five-judge appeal panel from the two live families', () => {
    if (!r.ok) return;
    expect(r.value.active.length).toBeGreaterThanOrEqual(5);
    expect(new Set(r.value.active.map((e) => e.family))).toEqual(new Set(['claude', 'deepseek']));
    expect(new Set(r.value.active.map((e) => e.provider))).toEqual(new Set(['anthropic', 'openai-compatible']));
  });
});
