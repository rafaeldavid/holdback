// <beat>.md: the narrated transcript a reader can follow without the docs.
import { labelOf } from './cast.js';
import { closing } from './closing.js';
import { formatAmount } from './money.js';
import { formatMs, formatScore, header, narrate } from './narrate.js';
import type { BeatTranscript, DemoEvent } from './types.js';
import { fenced, mdText, plain, safeJson } from '@holdback/testkit';

type Of<K extends DemoEvent['kind']> = Extract<DemoEvent, { kind: K }>;
export const eventsOf = <K extends DemoEvent['kind']>(t: BeatTranscript, kind: K): Of<K>[] => t.events.filter((e): e is Of<K> => e.kind === kind);

const sameRows = (a: Of<'balances'>, b: Of<'balances'>) => JSON.stringify(a.rows) === JSON.stringify(b.rows);

/**
 * The balance snapshots worth a table: each one that differs from the snapshot before it, plus the first
 * as the starting point. A beat that moved no money gets none.
 */
export function leanBalances(t: BeatTranscript): Of<'balances'>[] {
  const all = eventsOf(t, 'balances');
  const changed = all.filter((b, i) => i > 0 && !sameRows(b, all[i - 1]!));
  return changed.length ? [all[0]!, ...changed] : [];
}

/** One prompt or verdict line inside a fence: plain again, so a renderer is safe without the source's pass. */
const fenceBody = (lines: readonly string[]) => lines.map(plain).join('\n');

/** Seat, model, hashes, the prompt (head, omitted count, tail) and the verdict, each in its own fence. */
function judgeSection(j: Of<'judge-prompt'>): string[] {
  const u = j.prompt.user;
  const omitted = u.omitted ? ['', `\\[${u.omitted.toLocaleString('en-US')} line${u.omitted === 1 ? '' : 's'} of the data section omitted here; the input hash covers them.\\]`, '', fenced('text', fenceBody(u.tail))] : [];
  return [
    `## Judge prompt and verdict${mark(j)}`,
    '',
    `Seat ${j.seat} on ${mdText(labelOf(j.actor))}'s panel, ${code(j.model)} (${mdText(j.family)}). Input hash ${code(j.inputHash)}. ${j.scripted ? 'The verdict is scripted: a fake provider wrote it, and no model read this prompt.' : 'The verdict is the model\'s reply.'} The deliverable and the terms are quoted as the judge received them.`,
    '',
    `**System message** (${j.prompt.system.length} lines):`,
    '',
    fenced('text', fenceBody(j.prompt.system)),
    '',
    `**User message** (${u.lines.toLocaleString('en-US')} lines):`,
    '',
    fenced('text', fenceBody(u.head)),
    ...omitted,
    '',
    '**Verdict:**',
    '',
    j.verdict ? fenced('json', safeJson(verdictJson(j))) : 'No valid verdict.',
    '',
  ];
}

/** The verdict with its strings plain, for a fence or <pre>. */
export const verdictJson = (j: Of<'judge-prompt'>) =>
  j.verdict
    ? {
        ...j.verdict,
        criteria: j.verdict.criteria.map((c) => ({ id: plain(c.id), score: c.score, evidence: plain(c.evidence) })),
        ...(j.verdict.injectionEvidence === undefined ? {} : { injectionEvidence: plain(j.verdict.injectionEvidence) }),
        rationale: plain(j.verdict.rationale),
      }
    : null;

/** A code span for an identifier: plain text with backticks removed, so it cannot close early. */
const code = (s: string) => `\`${plain(s).replaceAll('`', '')}\``;
const mark = (e: { standIn?: true }) => (e.standIn ? ' [stand-in]' : '');

// Every string that reaches Markdown goes through mdText (escaped, one line) or code; check details, screen
// details, aggregate reasons and the seller's terms can carry deliverable or party text (docs/team.md).
export function renderMarkdown(t: BeatTranscript): string {
  const out: string[] = [`# Beat ${t.beat}: ${mdText(t.title)}`, '', mdText(t.summary), '', ...header(t).map((l) => `> ${mdText(l)}`), ''];
  if (t.commitmentId) out.push(`Commitment ${code(t.commitmentId)}.`, '');

  out.push('## Timeline', '', ...t.events.filter((e) => e.kind !== 'balances').map((e) => `- ${mdText(narrate(e))}`), '');

  if (t.adjudicators?.length) {
    // Registration names and profile text are party text: escaped like every other line.
    out.push('## Adjudicators considered', '', 'Judges are pinned registry model IDs; effort is what each bench declares (scripted judges apply none). History is role-play, invented for this demo.', '');
    const rules = eventsOf(t, 'adjudicator-proposal')[0]?.rules ?? [];
    if (rules.length) out.push('Rules applied by the buyer (club rulebook):', '', ...rules.map((r) => `- ${mdText(r)}`), '');
    for (const a of t.adjudicators) {
      out.push(`### ${mdText(a.name)}`, '', `${mdText(a.selected === 'declined' ? 'Considered and declined' : `Chosen as ${a.selected}`)}. ${mdText(a.tagline)}`, '');
      if (a.declinedBecause?.length) out.push(...a.declinedBecause.map((r) => `- Declined: ${mdText(r)}`), '');
      if (a.sellerChecks?.length) out.push(...a.sellerChecks.map((c) => `- Seller check: ${mdText(c)}`), '');
      out.push('| Judge | Pinned model ID | Family | Declared effort |', '| --- | --- | --- | --- |');
      for (const j of a.judges) out.push(`| ${mdText(j.id)} | ${code(j.model)} | ${mdText(j.family)} | ${mdText(j.effort)} |`);
      out.push('', ...a.harness.map((h) => `- Harness: ${mdText(h)}`), ...a.terms.map((x) => `- ${mdText(`${x.label}: ${x.value}`)}`), ...a.history.lines.map((h) => `- History (role-play): ${mdText(h)}`), '');
    }
  }

  // One section per panel; a job with an escalation has two (beat 6a: the primary's, then the appeal's).
  const panels = eventsOf(t, 'panel');
  for (const p of panels) {
    out.push(`## Panel${panels.length > 1 ? `: ${mdText(labelOf(p.actor))}` : ''}${mark(p)}`, '', `${p.standIn ? '\\[stand-in\\] ' : ''}Seed ${code(p.seed)} (${mdText(p.seedSource)}); ${mdText(p.rule)}; outcome ${mdText(p.outcome)}.`, '');
    out.push('| Seat | Pinned model ID | Family | Verdict | Score |', '| --- | --- | --- | --- | --- |');
    for (const j of p.judges) out.push(`| ${j.seat} | ${code(j.model)} | ${mdText(j.family)} | ${mdText(j.verdict)} | ${j.score === undefined ? '-' : formatScore(j.score)} |`);
    out.push('');
  }

  const neutrality = eventsOf(t, 'neutrality');
  if (neutrality.length) out.push('## Neutrality events', '', ...neutrality.map((e) => `- ${mdText(narrate(e))}`), '');

  const balances = leanBalances(t);
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
  // Last: the prompt keeps the deliverable's line breaks, inside fences only.
  for (const j of eventsOf(t, 'judge-prompt')) out.push(...judgeSection(j));
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
    `${c.residualsIntro}`,
    '',
    ...c.residuals.map((r) => `- **${r.title}** (residual ${r.n}). ${r.line}`),
    '',
    '## What an AI lab could add',
    '',
    ...c.asks.map((a) => `- ${a}`),
    '',
  ].join('\n');
}
