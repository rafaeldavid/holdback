// <beat>.md: the narrated transcript a reader can follow without the docs.
import { labelOf } from './cast.js';
import { closing } from './closing.js';
import { formatAmount } from './money.js';
import { formatMs, header, narrate } from './narrate.js';
import type { BeatTranscript, DemoEvent } from './types.js';

type Of<K extends DemoEvent['kind']> = Extract<DemoEvent, { kind: K }>;
export const eventsOf = <K extends DemoEvent['kind']>(t: BeatTranscript, kind: K): Of<K>[] => t.events.filter((e): e is Of<K> => e.kind === kind);

const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderMarkdown(t: BeatTranscript): string {
  const out: string[] = [`# Beat ${t.beat}: ${t.title}`, '', t.summary, '', ...header(t).map((l) => `> ${l}`), ''];
  if (t.commitmentId) out.push(`Commitment \`${t.commitmentId}\`.`, '');

  out.push('## Timeline', '', ...t.events.filter((e) => e.kind !== 'balances').map((e) => `- ${narrate(e)}`), '');

  for (const p of eventsOf(t, 'panel')) {
    out.push('## Panel', '', `Seed ${p.seed} (${p.seedSource}); threshold ${p.threshold}; outcome ${p.outcome}.`, '');
    out.push('| Seat | Pinned model ID | Family | Verdict | Score |', '| --- | --- | --- | --- | --- |');
    for (const j of p.judges) out.push(`| ${j.seat} | \`${cell(j.model)}\` | ${cell(j.family)} | ${j.verdict} | ${j.score ?? '-'} |`);
    out.push('');
  }

  const neutrality = eventsOf(t, 'neutrality');
  if (neutrality.length) out.push('## Neutrality events', '', ...neutrality.map((e) => `- ${narrate(e)}`), '');

  const balances = eventsOf(t, 'balances');
  if (balances.length) {
    out.push('## Balances', '');
    for (const b of balances) {
      out.push(`**${b.label}** (${formatMs(b.atMs)}):`, '','| Party | Balance | Reserved |', '| --- | ---: | ---: |');
      for (const r of b.rows) out.push(`| ${cell(labelOf(r.who))} | ${formatAmount(r.amount)} | ${r.reserved ? formatAmount(r.reserved) : '-'} |`);
      out.push('');
    }
  }

  for (const s of eventsOf(t, 'signed')) {
    out.push('## Signed message', '', `${s.messageType}, signed by ${labelOf(s.actor)} (${s.signer}).`, '', '```json', JSON.stringify({ ...s.body, signature: s.signature }, null, 2), '```', '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export function renderClosingMarkdown(): string {
  const c = closing();
  return [
    '# Closing',
    '',
    '## Finality',
    '',
    ...c.finality.map((l) => `- ${l}`),
    '',
    '## What remains centralized',
    '',
    'Residual control points, from `docs/neutrality.md`:',
    '',
    ...c.residuals.map((r) => `${r.n}. **${r.title}.** ${r.line}`),
    '',
    '## What an AI lab could add',
    '',
    ...c.asks.map((a) => `- ${a}`),
    '',
  ].join('\n');
}
