// <beat>.md: the narrated transcript a reader can follow without the docs.
import { labelOf } from './cast.js';
import { closing } from './closing.js';
import { formatAmount } from './money.js';
import { formatMs, formatScore, header, narrate } from './narrate.js';
import type { BeatTranscript, DemoEvent } from './types.js';
import { fenced, mdText, plain, safeJson } from './untrusted.js';

type Of<K extends DemoEvent['kind']> = Extract<DemoEvent, { kind: K }>;
export const eventsOf = <K extends DemoEvent['kind']>(t: BeatTranscript, kind: K): Of<K>[] => t.events.filter((e): e is Of<K> => e.kind === kind);

/** A code span for an identifier: plain text with backticks removed, so it cannot close early. */
const code = (s: string) => `\`${plain(s).replaceAll('`', '')}\``;
const mark = (e: { standIn?: true }) => (e.standIn ? ' [stand-in]' : '');

// Every string that reaches Markdown goes through mdText (escaped, one line) or code; check details, screen
// details, aggregate reasons and the seller's terms can carry deliverable or party text (docs/team.md).
export function renderMarkdown(t: BeatTranscript): string {
  const out: string[] = [`# Beat ${t.beat}: ${mdText(t.title)}`, '', mdText(t.summary), '', ...header(t).map((l) => `> ${mdText(l)}`), ''];
  if (t.commitmentId) out.push(`Commitment ${code(t.commitmentId)}.`, '');

  out.push('## Timeline', '', ...t.events.filter((e) => e.kind !== 'balances').map((e) => `- ${mdText(narrate(e))}`), '');

  for (const p of eventsOf(t, 'panel')) {
    out.push(`## Panel${mark(p)}`, '', `${p.standIn ? '\\[stand-in\\] ' : ''}Seed ${code(p.seed)} (${mdText(p.seedSource)}); ${mdText(p.rule)}; outcome ${mdText(p.outcome)}.`, '');
    out.push('| Seat | Pinned model ID | Family | Verdict | Score |', '| --- | --- | --- | --- | --- |');
    for (const j of p.judges) out.push(`| ${j.seat} | ${code(j.model)} | ${mdText(j.family)} | ${mdText(j.verdict)} | ${j.score === undefined ? '-' : formatScore(j.score)} |`);
    out.push('');
  }

  const neutrality = eventsOf(t, 'neutrality');
  if (neutrality.length) out.push('## Neutrality events', '', ...neutrality.map((e) => `- ${mdText(narrate(e))}`), '');

  const balances = eventsOf(t, 'balances');
  if (balances.length) {
    out.push('## Balances', '');
    for (const b of balances) {
      out.push(`**${mdText(b.label)}**${mark(b)} (${formatMs(b.atMs)}):`, '', '| Party | Balance | Reserved |', '| --- | ---: | ---: |');
      for (const r of b.rows) out.push(`| ${mdText(labelOf(r.who))} | ${formatAmount(r.amount)} | ${r.reserved ? formatAmount(r.reserved) : '-'} |`);
      out.push('');
    }
  }

  for (const s of eventsOf(t, 'signed')) {
    out.push(`## Signed message${mark(s)}`, '', `${mdText(s.messageType)}, signed by ${mdText(labelOf(s.actor))} (${code(s.signer)}).`, '', fenced('json', safeJson({ ...s.body, signature: s.signature })), '');
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
