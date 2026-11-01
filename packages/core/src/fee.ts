// The operator fee rule (ADR-0023, D33). An operator publishes a schedule; the fee for relaying a funded
// agreement is max(min, ceil(price x bps / 10000)), then capped at max when one is published, in base units of
// the price token (ADR-0022 rule 1: a requirement rounds up). A schedule in another token charges nothing.
import { mulBps, type BaseUnits } from './money/index.js';
import type { OperatorFeeSchedule, TokenAmount } from './types.js';

export type { OperatorFeeSchedule } from './types.js';

/** The fee an operator with schedule `s` asks for relaying a funded agreement at `price`. */
export function operatorFeeDue(price: TokenAmount, s: OperatorFeeSchedule): TokenAmount {
  const zero = { token: price.token, amount: '0' as BaseUnits };
  if (price.token !== s.token) return zero;
  const share = mulBps(price, BigInt(s.bps), 'ceil');
  if (!share.ok) throw new RangeError(`operator fee schedule: ${share.error.kind}`);
  let fee = BigInt(share.value.amount);
  if (fee < BigInt(s.min)) fee = BigInt(s.min);
  if (s.max !== null && fee > BigInt(s.max)) fee = BigInt(s.max);
  return { token: price.token, amount: fee.toString() as BaseUnits };
}

/** "1 bp of the price, at least 0.010000 tUSD", for check text and problem details. `fmt` renders base units. */
export function operatorFeeRule(s: OperatorFeeSchedule, fmt: (amount: string) => string): string {
  const cap = s.max === null ? '' : `, at most ${fmt(s.max)}`;
  return `${s.bps} bp of the price rounded up, at least ${fmt(s.min)}${cap}`;
}
