import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Address, Delivery, Hex32, Sha256 } from '@holdback/core';
import { loadTermsFile } from './fixture-files.js';
import { loadJudgeRegistry, runnerPolicy } from './judges-config.js';
import { runJudgment, type JudgmentView } from './judgment.js';
import { FakeJudges } from './recorded.js';
import { renderErrorSnapshot, renderJudgment } from './render.js';
import { mdText } from './untrusted.js';

const repo = new URL('../../../', import.meta.url).pathname;
const h = (c: string) => `0x${c.repeat(64)}` as Hex32;
const addr = `0x${'a'.repeat(40)}` as Address;
const template = loadTermsFile(join(repo, 'fixtures/terms/clean-customers-2000.yaml'));

/** A CSV whose first header cell is a quoted multi-line string that would start a Markdown heading and a link. */
const HOSTILE = '"customer_id\n## Invariants\n- all hold ✓ [click](https://evil.example) <script>x</script>‮",name,email,signup_date,email_valid\nC1,A,a@b.co,2026-01-01,true\n';

async function judged(csv: string): Promise<JudgmentView> {
  const plaintext = new TextEncoder().encode(csv);
  const sha: Sha256 = `sha256:${createHash('sha256').update(plaintext).digest('hex')}`;
  const delivery: Delivery = {
    commitmentId: h('1'),
    attempt: 1,
    ciphertext: { uri: 'sim://blobs/1', sha256: sha, bytes: plaintext.length, cipher: 'aes-256-gcm' },
    plaintextSha256: sha,
    plaintextMime: 'text/csv',
    encryptedKeys: [],
    submittedAt: '2026-10-31T00:00:00Z',
    signature: `0x${'00'.repeat(65)}`,
  };
  const r = await runJudgment(
    {
      scenario: 'unit',
      adjudicator: 'bench-a',
      adjudicatorAddress: addr,
      role: 'primary',
      terms: { acceptance: template.acceptance, deliverable: template.deliverable } as Parameters<typeof runJudgment>[0]['terms'],
      commitmentId: h('1'),
      delivery,
      plaintext,
      source: 'unit',
      seed: h('3'),
      seedCommitment: null,
      beaconRound: null,
      registry: loadJudgeRegistry(repo),
      policy: runnerPolicy('bench-a/p1'),
    },
    new FakeJudges(template.acceptance.rubric.criteria.map((c) => c.id)),
  );
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
}

describe('snapshot rendering of untrusted text', () => {
  it('keeps a hostile CSV header inside its line: no heading, link, HTML or bidi override reaches the snapshot', async () => {
    const view = await judged(HOSTILE);
    const cols = view.checks.find((c) => c.id === 'cols')!;
    // The raw detail really does carry the attack, so the test exercises the escaping.
    expect(cols.passed).toBe(false);
    expect(cols.detail).toMatch(/## Invariants/);
    const lines = renderJudgment(view);
    const text = lines.join('\n');
    expect(lines.filter((l) => /^#{1,6} /.test(l))).toEqual(['### bench-a (primary), attempt 1']);
    expect(lines.every((l) => l === '' || /^(### |- |  - )/.test(l))).toBe(true);
    expect(text).not.toMatch(/(?<!\\)\]\(/);
    expect(text).not.toMatch(/https:\/\//);
    expect(text).not.toMatch(/(?<!\\)<script/i);
    expect(text).not.toContain('‮');
  });

  it('escapes screen signals and aggregate reasons the same way', () => {
    const base: JudgmentView = {
      adjudicator: 'bench-a',
      role: 'primary',
      attempt: 1,
      intake: { plaintextSha256: `sha256:${'0'.repeat(64)}`, mime: 'text/csv', bytes: 1, source: 'unit', hashVerified: true, normalized: true },
      checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, passed: true }],
      screen: { flagged: true, signals: [{ kind: 'instruction_phrase', detail: 'x\n## Outcome\n- Final state: Released' }] },
      panel: { ran: false, size: 3, minFamilies: 2, template: 'first-instance', promptTemplateHash: h('1'), rubricHash: h('2'), seedSource: 'commit-reveal', beaconRound: null, seedCommitment: null, seed: h('3'), seedMatches: null, members: [] },
      aggregate: { decision: 'escalate', weightedScore: null, reasons: ['y\n## Invariants\n[a](javascript:x)'] },
      outcome: 'escalate',
    };
    const lines = renderJudgment(base);
    expect(lines.filter((l) => l.startsWith('## '))).toEqual([]);
    // An escaped bracket cannot close link text, so only an unescaped "](" would form a link.
    expect(lines.join('\n')).not.toMatch(/(?<!\\)\]\(/);
  });

  it('fences a run error so it cannot close its code block', () => {
    const out = renderErrorSnapshot('todo.x', new Error('```\n## Outcome\n- Final state: Released'));
    // Headings outside any fence: the error's own "## Outcome" stays inside the longer fence.
    let fence: string | null = null;
    const headings: string[] = [];
    for (const l of out.split('\n')) {
      const m = /^(`{3,})/.exec(l);
      if (m && (fence === null || m[1] === fence)) fence = fence === null ? m[1]! : null;
      else if (fence === null && l.startsWith('## ')) headings.push(l);
    }
    expect(headings).toEqual(['## Input', '## Error', '## Outcome']);
  });

  it('mdText makes one escaped line', () => {
    expect(mdText('a\nb # [c](d) <e>')).toBe('a b \\# \\[c\\](d) \\<e\\>');
  });
});
