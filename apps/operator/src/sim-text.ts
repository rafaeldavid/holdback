// What `pnpm sim` prints when its world is up (sim-bin.ts), as a pure function so a test pins it for each profile.
// The phase-one profile (T-378, D57) has no bonds and no party appeals, so its text names no bond or appeal figure;
// the full profile keeps both. The operator fee line is what the world's nodes publish as fees.operator (ADR-0023).
import { operatorFeeRule, type OperatorFeeSchedule } from '@holdback/core';
import type { SimInfo } from './sim-world.js';
import { formatTusd } from './units.js';

/** The operator fee in one line, from the schedule the nodes publish (or none). */
export function operatorFeeLine(fee: OperatorFeeSchedule | null): string {
  if (!fee) return 'Operator fee: none (the nodes publish no fees.operator): a buyer pays the price plus the adjudication fee.';
  if (fee.bps === 0 && fee.min === '0') return 'Operator fee: 0 (fees.operator published at 0): a buyer pays the price plus the adjudication fee; no fee signature is asked for.';
  return `Operator fee: ${operatorFeeRule(fee, (a) => formatTusd(a))}, paid to ${fee.to} with the funded agreement, outside the hold and not refunded (fees.operator).`;
}

export function simStartText(info: SimInfo, simUrl: string, o: { profile: 'full' | 'phase_one'; fee: OperatorFeeSchedule | null }): string {
  const e = info.economics;
  const pct = (bps: string) => `${Number(bps) / 100}%`;
  const phaseOne = o.profile === 'phase_one';
  const lines = [
    'Holdback sim: SimChain (chain 31337), test token tUSD with 6 decimals. Fake judges. No real money.',
    ...(phaseOne ? ["Phase-one rules, as the contracts on chain: no bonds and no party appeals; the first decision, by the primary or the fallback adjudicator, is final."] : []),
    operatorFeeLine(o.fee),
    '',
    ...info.operators.map((u, i) => `  operator ${i + 1}    ${u}   REST API; start at GET ${u}/.well-known/holdback.json`),
    `  sim service   ${simUrl}   test accounts with keys (GET /), clock (GET /clock, POST /advance)`,
    `  club          ${info.clubId}   rules at GET ${info.operators[0]}/v1/clubs/${info.clubId}`,
    '',
    'EIP-712 domain to pin in your agent (verify every prepared message against it, not against an operator):',
    `  name Holdback, version ${info.domain.version}, chainId ${info.domain.chainId}, verifyingContract ${info.domain.verifyingContract}`,
    '',
    'Adjudicators (test adjudicators; fake judges, no model runs):',
    ...info.adjudicators.map((a) => `  ${a.role.padEnd(9)} ${a.name.padEnd(32)} ${a.address}`),
    phaseOne ? `  minimum fee ${formatTusd(e['adjudicationFeeMin']!)} each` : `  each bonded ${formatTusd(e['adjudicatorBond']!)}, minimum fee ${formatTusd(e['adjudicationFeeMin']!)}`,
    '',
    `Funded test accounts. TEST KEYS ONLY: each derives from a public label. Encryption keys at GET ${simUrl}/`,
    ...info.accounts.map((a) => `  ${a.label.padEnd(9)} ${a.address}  ${formatTusd(a.balance)}  signing key ${a.privateKey}`),
    '',
    'Economics (club rulebook):',
    `  the adjudication fee is paid on a judged refund: the buyer gets the price back, not the fee`,
    ...(phaseOne
      ? ['  default outcome (no adjudicator decided in time): the buyer gets the price and the adjudication fee back; nothing compensates the seller']
      : [
          `  appeal: bond ${pct(e['appealBondRateBps']!)} of the price (rounded up) plus a ${formatTusd(e['appealFee']!)} fee`,
          `  default outcome (no adjudicator decided in time): the buyer gets the price and the adjudication fee back, and the seller is compensated ${pct(e['defaultOutcomeSellerCompensationRateBps']!)} of the price from the bond`,
        ]),
    '',
    `Fresh funded accounts: POST ${simUrl}/accounts. Work containing FAIL-ME fails the fake judges. Silence an adjudicator: POST ${simUrl}/adjudicators/primary {"silent": true}.`,
    '',
    'Run an example in another terminal: pnpm example buy-dataset  (docs/quickstart.md). Ctrl-C stops the sim.',
  ];
  return lines.join('\n');
}
