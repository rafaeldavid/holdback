import { describe, expect, it } from 'vitest';
import { standInSource } from '../source/stand-in.js';
import { CAST } from './cast.js';
import { header, MARKETING_WORDS, narrate } from './narrate.js';
import type { BeatTranscript, DemoEvent } from './types.js';

async function allTranscripts(): Promise<BeatTranscript[]> {
  const source = standInSource();
  return Promise.all(source.beats().map((b) => source.run(b)));
}

describe('narrate', () => {
  it('states a number on every line: amount, milliseconds, model ID or hash prefix', async () => {
    for (const t of await allTranscripts()) {
      for (const e of t.events) {
        const line = narrate(e);
        expect(line, `${t.beat}/${e.kind}`).toMatch(/\d/);
        expect(line, `${t.beat}/${e.kind}`).toMatch(/^\+\d[\d,]* ms /);
      }
    }
  });

  it('names actors by their cast names, never by cast key', async () => {
    const lines = (await allTranscripts()).flatMap((t) => t.events.map(narrate)).join('\n');
    expect(lines).toContain('Ledger');
    expect(lines).toContain('Tide-7');
    expect(lines).toContain('Clearfield Adjudication');
    expect(lines).not.toMatch(/\b(benchA|benchB|benchC|op1|op2)\b/);
  });

  it('uses no marketing language', async () => {
    const lines = (await allTranscripts()).flatMap((t) => [...header(t), ...t.events.map(narrate)]).join('\n').toLowerCase();
    for (const word of MARKETING_WORDS) expect(lines).not.toContain(word);
  });

  it('lists every judge with its pinned model ID and family', () => {
    const panel: DemoEvent = {
      kind: 'panel',
      atMs: 900,
      actor: 'benchA',
      seed: '0xabcdef0123456789',
      seedSource: 'commit-reveal',
      threshold: '2/3',
      judges: [
        { seat: 1, model: 'model-one-20260601', family: 'familyA', verdict: 'pass', score: 380 },
        { seat: 2, model: 'model-two-001', family: 'familyB', verdict: 'fail', score: 120 },
      ],
      outcome: 'accept',
    };
    const line = narrate(panel);
    expect(line).toContain('model-one-20260601');
    expect(line).toContain('model-two-001');
    expect(line).toContain('2 families');
    expect(line).toContain('0xabcdef01');
  });

  it('says when a neutrality failure happened and what the transaction did instead', () => {
    const line = narrate({ kind: 'neutrality', atMs: 12, actor: 'buyer', target: 'op1', failure: 'refused', consequence: 'the SDK failed over to op-2', via: 'op2' });
    expect(line).toContain('op-1');
    expect(line).toContain('refused');
    expect(line).toContain('failed over to op-2');
  });
});

describe('header', () => {
  it('says recorded verdicts in recorded mode, and names a stand-in source', async () => {
    for (const t of await allTranscripts()) {
      const h = header(t).join('\n');
      expect(h).toContain('recorded verdicts');
      expect(h).toContain(t.source.note);
      expect(h).toMatch(/stand-in/i);
    }
  });

  it('introduces the cast with principals', () => {
    expect(CAST.buyer.name).toBe('Ledger');
    expect(CAST.buyer.org).toBe('Atlas Research');
    expect(CAST.buyer.principal).toBe('Priya Raman');
    expect(CAST.seller.principal).toBe('Marcus Oyelaran');
  });
});
