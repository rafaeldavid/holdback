// Narration (docs/demo.md §Narration rules): every line states what happened and the number behind it
// (amount, milliseconds, model ID, hash prefix). Plain statements only. Recorded mode says "recorded verdicts".
import { labelOf, nameOf } from './cast.js';
import { formatAmount } from './money.js';
import type { BeatTranscript, CheckResult, DemoEvent, Via } from './types.js';

/** Words the narration never uses. Checked by narrate.test.ts over every transcript. */
export const MARKETING_WORDS = [
  'seamless',
  'revolutionary',
  'cutting-edge',
  'game-chang',
  'magic',
  'effortless',
  'blazing',
  'world-class',
  'best-in-class',
  'trustless',
  'instantly',
  'powerful',
  'unleash',
  'next-gen',
] as const;

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A weighted rubric score in hundredths of a point (0 to 400): "3.80 of 4". Integer arithmetic only. */
export const formatScore = (h: number) => `${Math.trunc(h / 100)}.${String(h % 100).padStart(2, '0')} of 4`;

/** "+1,204 ms" */
export const formatMs = (ms: number) => `+${group(ms)} ms`;

/** A hash prefix: "0x1a2b3c4d…", "sha256:1939b96f…". */
export function short(hash: string): string {
  const m = /^(sha256:|0x)?([0-9a-fA-F]+)$/.exec(hash);
  if (!m) return hash;
  const [, prefix = '', hex = ''] = m;
  return hex.length <= 8 ? hash : `${prefix}${hex.slice(0, 8)}…`;
}

const relay = (via: Via) => (via === 'direct' ? 'submitted directly to SimChain (no operator)' : `relayed by ${nameOf(via)}`);

function checksLine(results: CheckResult[]): string {
  const failed = results.filter((r) => !r.passed);
  const head = `runs ${results.length} deterministic checks: ${results.length - failed.length} passed`;
  if (failed.length === 0) return `${head} (${results.map((r) => r.id).join(', ')}).`;
  const tail = failed.map((r) => `${r.id}${r.required ? '' : ' (optional)'}, ${r.detail}`).join('; ');
  return `${head}, ${failed.length} failed: ${tail}.`;
}

/** What happened, with its number, without the timestamp. */
export function describeEvent(e: DemoEvent): string {
  const who = labelOf(e.actor);
  switch (e.kind) {
    case 'offer':
      return `${who} offers ${formatAmount(e.price)} plus a ${formatAmount(e.fee)} adjudication fee, commitment ${short(e.commitmentId)}. The two agents chose the adjudicators: ${nameOf(e.primary)} (primary), ${nameOf(e.fallback)} (fallback), ${nameOf(e.appeal)} (appeal). Disclosure: ${e.disclosure}.`;
    case 'acceptance':
      return `${who} accepts the commitment and reserves ${formatAmount(e.bondReserved)} of its bond; panel seed committed as ${short(e.seedCommitment)}.`;
    case 'hold':
      return `${who} signs and holds ${formatAmount(e.amount)} in escrow in one call, ${relay(e.via)}. Neither party can move it alone.`;
    case 'delivery':
      return `${who} delivers ${group(e.ciphertextBytes)} encrypted bytes (delivery ${short(e.deliveryHash)}, plaintext ${short(e.plaintextSha256)}), ${relay(e.via)}. The buyer sees only these hashes. Content key sealed to ${e.keyRecipients.map(nameOf).join(', ')}.`;
    case 'checks':
      return `${who} ${checksLine(e.results)}`;
    case 'screen':
      return e.flagged
        ? `The screen at ${who} flags ${e.signals.length} signal${e.signals.length === 1 ? '' : 's'} (${e.signals.join(', ')}): ${e.consequence}.`
        : `The screen at ${who} finds 0 hidden or encoded instructions: ${e.consequence}.`;
    case 'panel': {
      const seats = e.judges.map((j) => `seat ${j.seat} \`${j.model}\` (${j.family}) ${j.verdict}${j.score === undefined ? '' : ` ${formatScore(j.score)}`}`).join('; ');
      const passes = e.judges.filter((j) => j.verdict === 'pass').length;
      const families = new Set(e.judges.map((j) => j.family)).size;
      return `${who} seats ${e.judges.length} judges by ${e.seedSource} seed ${short(e.seed)}: ${seats}. ${passes} of ${e.judges.length} pass across ${families} families (${e.rule}); panel outcome: ${e.outcome}.`;
    }
    case 'decision':
      return `${who} signs the ${e.role} decision: ${e.outcome}, ${relay(e.via)}.`;
    case 'escalation':
      return `${who} escalates to ${labelOf(e.to)}, reason: ${e.reason}; the appeal panel seats ${e.panelSize} judges from ${e.families} families.`;
    case 'settlement': {
      const verb = e.settlement === 'release' ? 'releases' : e.settlement === 'refund' ? 'refunds' : 'pays the co-signed split';
      const payouts = e.payouts.map((p) => `${formatAmount(p.amount)} to ${nameOf(p.to)} (${p.reason})`).join(', ');
      const key = e.keyReleasedTo ? ` The content key goes to ${nameOf(e.keyReleasedTo)} in the same step.` : ' No content key is released; the seller keeps the work.';
      return `Escrow ${verb}: ${payouts}, ${relay(e.via)}.${key}`;
    }
    case 'open': {
      const match = e.matchesDelivery ? 'matches the hash the seller signed' : 'does NOT match the hash the seller signed';
      const stripped = e.stripped ? ` Hidden payload stripped before your agent read it: ${group(e.stripped.count)} ${e.stripped.what}, from the signed screen report.` : '';
      return `${who} decrypts ${group(e.bytes)} bytes; ${short(e.plaintextSha256)} ${match}.${stripped}`;
    }
    case 'finality':
      return `${nameOf(e.payee)}'s payment is final at the decision. The other party can appeal for ${group(e.appealWindowSec)} s; if it wins, ${nameOf(e.bondHolder)}'s bond pays ${formatAmount(e.bondAtRisk)}. Nothing takes the payment back from escrow.`;
    case 'receipt':
      return `${who} signs a receipt, ${short(e.receiptHash)}.`;
    case 'neutrality': {
      const verb = e.failure === 'refused' ? 'refused to relay' : e.failure === 'offline' ? 'went offline' : 'revoked a member mid-flight';
      return `NEUTRALITY: ${labelOf(e.target)} ${verb}. ${e.consequence}.`;
    }
    case 'balances': {
      const rows = e.rows.map((r) => `${nameOf(r.who)} ${formatAmount(r.amount)}${r.reserved ? ` (${formatAmount(r.reserved)} reserved)` : ''}`).join('; ');
      return `Balances ${e.label}: ${rows}.`;
    }
    case 'signed':
      return `${who} signs ${e.messageType} (EIP-712, signer ${short(e.signer)}, signature ${short(e.signature)}); full message below.`;
  }
}

/** One narrated line: "+1,204 ms <what happened, with its number>". */
export function narrate(e: DemoEvent): string {
  return `${formatMs(e.atMs)} ${e.standIn ? '[stand-in] ' : ''}${describeEvent(e)}`;
}

/** Lines printed before the timeline: mode, source, litmus test, units. */
export function header(t: BeatTranscript): string[] {
  const mode =
    t.mode === 'recorded'
      ? 'Mode: recorded. Judge outputs are recorded verdicts: no model was called in this run.'
      : 'Mode: live. Judges were called with pinned model IDs during this run.';
  return [
    mode,
    `Source: ${t.source.note}`,
    `Shows: ${t.litmus}.`,
    'Amounts are in tUSD, a test token on SimChain (1 tUSD stands for $1). Times are milliseconds since the job\'s first call.',
  ];
}
