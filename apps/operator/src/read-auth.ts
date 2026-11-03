// Private reads (ADR-0024 §3). At disclosure level private or judgment, an operator serves a deal's bodies,
// envelopes, judgment records and full events only to a party or an involved adjudicator holding a ReadToken it
// signed. No token: the settlement projection. A token that fails any check: 401 unauthorized. The token proves
// who reads; it guards metadata at an honest operator, while the bodies themselves stay ciphertext to the operator.
import { isAddressEqual } from 'viem';
import { parseReadTokenHeader, problem, verifyMessage, type Address, type CommitmentStateView, type Hex32, type HoldbackDomain, type Problem, type ReadToken, type Timestamp } from '@holdback/core';

export interface DealParties {
  buyer: Address;
  seller: Address;
  adjudicator: Address;
  fallbackAdjudicator: Address;
  appealAdjudicator: Address;
}

export type Reader = { kind: 'anonymous' } | { kind: 'party' | 'adjudicator'; viewer: Address; token: ReadToken };

/** Fallback and appeal adjudicators read once they are involved (ADR-0024 §3); the primary always. */
export function involvedAdjudicators(p: DealParties, state: Pick<CommitmentStateView, 'escrowState' | 'appealState'> | null): Address[] {
  const out = [p.adjudicator];
  const s = state?.escrowState;
  if (s === 'FallbackJudging' || s === 'Defaulted') out.push(p.fallbackAdjudicator);
  if (s === 'Escalated' || (state && state.appealState !== 'none')) out.push(p.appealAdjudicator);
  return out;
}

export interface ReadCheck {
  domain: HoldbackDomain;
  /** This operator's receipt-signer address: a token naming another audience is refused here. */
  operator: Address;
  /** Settlement-layer time. */
  now: Timestamp;
  /** The commitment the route reads. */
  commitmentId: Hex32;
  parties: DealParties;
  state: Pick<CommitmentStateView, 'escrowState' | 'appealState'> | null;
}

/** Who is reading: anonymous without a header, else the token's verified viewer, or a 401 problem. */
export async function readerOf(header: string | undefined, c: ReadCheck): Promise<{ ok: true; reader: Reader } | { ok: false; problem: Problem }> {
  if (header === undefined || header === '') return { ok: true, reader: { kind: 'anonymous' } };
  const no = (detail: string) => ({ ok: false as const, problem: problem('unauthorized', detail) });
  const parsed = parseReadTokenHeader(header);
  if (!parsed.ok) return { ok: false, problem: parsed.error };
  const t = parsed.value;
  if (t.commitmentId !== c.commitmentId) return no(`the read token is for ${t.commitmentId}, not ${c.commitmentId}`);
  if (t.audience !== undefined && !isAddressEqual(t.audience, c.operator)) return no(`the read token is for operator ${t.audience}, not this one (${c.operator}); sign one for this operator`);
  if (!(Date.parse(c.now) < Date.parse(t.expiresAt))) return no(`the read token expired at ${t.expiresAt}`);
  if (!(await verifyMessage(c.domain, t, t.viewer))) return no('the read token signature does not recover to its viewer');
  const p = c.parties;
  if (isAddressEqual(t.viewer, p.buyer) || isAddressEqual(t.viewer, p.seller)) return { ok: true, reader: { kind: 'party', viewer: t.viewer, token: t } };
  if (involvedAdjudicators(p, c.state).some((a) => isAddressEqual(a, t.viewer))) return { ok: true, reader: { kind: 'adjudicator', viewer: t.viewer, token: t } };
  return no(`${t.viewer} is not a party or an involved adjudicator of ${c.commitmentId}`);
}
