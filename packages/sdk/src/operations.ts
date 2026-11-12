// The mutating calls of docs/api.md, as one table shared by the SDK and the operator. Each operation has one
// HTTP route and becomes one or more settlement submissions. The operator relays exactly those submissions, and
// the SDK's direct path (the escape hatch, ADR-0005) submits the same ones under the same idempotency keys, so a
// call that an operator half-relayed is completed, never doubled, by the direct path.
import {
  problem,
  type AdjudicatorAcceptance,
  type Agree,
  type Appeal,
  type AnyCommitment,
  type Commitment,
  type Decision,
  type Delivery,
  type EarlyAccept,
  type FundingAuthorization,
  type Hex32,
  type MutualSettlement,
  type Problem,
  type Result,
  type TransferAuthorization,
} from '@holdback/core';
import { TIMEOUT_KINDS, type DryRunSubmission, type Submission, type TimeoutKind } from '@holdback/settlement';

export type Operation =
  /** Either wire form; at private and judgment the bodies travel only as privateTerms ciphertext (ADR-0024). */
  | { kind: 'offer'; commitment: AnyCommitment }
  | { kind: 'acceptance'; message: AdjudicatorAcceptance }
  /** Agree, optionally funding in the same step (`Held` at once), and with funding an operator fee (ADR-0023). */
  | { kind: 'agree'; message: Agree; fund?: FundingAuthorization; operatorFee?: TransferAuthorization }
  /** One-shot hold: offer, adjudicator acceptance, agreement and funding. */
  | { kind: 'hold'; commitment: AnyCommitment; acceptance: AdjudicatorAcceptance; agree: Agree; funding: FundingAuthorization }
  | { kind: 'fund'; message: FundingAuthorization }
  | { kind: 'deliver'; delivery: Delivery }
  | { kind: 'early_accept'; message: EarlyAccept }
  | { kind: 'decide'; message: Decision }
  | { kind: 'appeal'; appeal: Appeal }
  /**
   * A mutual settlement. In Held it may carry the late work it names (SC-5b, T-357), the seller-signed delivery that was
   * never posted, so the settlement layer can release the buyer's envelope in it; the body carries it as `delivery`.
   */
  | { kind: 'settle'; message: MutualSettlement; delivery?: Delivery }
  | { kind: 'trigger'; commitmentId: Hex32; timeout: TimeoutKind };

/** Trigger kinds as they appear in a path: `expire-offer`, `appeal-expiry`, ... */
export const triggerPath = (t: TimeoutKind): string => t.replace(/_/g, '-');

export function commitmentIdOf(op: Operation): Hex32 {
  switch (op.kind) {
    case 'offer':
    case 'hold':
      return op.commitment.id;
    case 'deliver':
      return op.delivery.commitmentId;
    case 'appeal':
      return op.appeal.commitmentId;
    case 'trigger':
      return op.commitmentId;
    default:
      return op.message.commitmentId;
  }
}

/** The HTTP request for an operation: POST to `path` with `body` as JSON. */
export function requestOf(op: Operation): { path: string; body: unknown } {
  const c = (suffix: string) => `/v1/commitments/${commitmentIdOf(op)}/${suffix}`;
  switch (op.kind) {
    case 'offer':
      return { path: '/v1/commitments', body: op.commitment };
    case 'acceptance':
      return { path: c('acceptance'), body: op.message };
    case 'agree':
      return { path: c('agree'), body: op.fund ? { ...op.message, fund: op.fund, ...(op.operatorFee ? { operatorFee: op.operatorFee } : {}) } : op.message };
    case 'hold':
      return { path: '/v1/holds', body: { commitment: op.commitment, acceptance: op.acceptance, agree: op.agree, funding: op.funding } };
    case 'fund':
      return { path: c('fund'), body: op.message };
    case 'deliver':
      return { path: c('deliveries'), body: op.delivery };
    case 'early_accept':
      return { path: c('accept'), body: op.message };
    case 'decide':
      return { path: c('decisions'), body: op.message };
    case 'appeal':
      return { path: c('appeals'), body: op.appeal };
    case 'settle':
      return { path: c('settlements'), body: { ...op.message, ...(op.delivery ? { delivery: op.delivery } : {}) } };
    case 'trigger':
      return { path: c(`triggers/${triggerPath(op.timeout)}`), body: {} };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The operator's side of `requestOf`: path segments and a JSON body back to an operation. It checks the route and
 * that the body names the commitment in the path; the operator checks the bodies against spec/schemas.
 */
export function operationOf(segments: readonly string[], body: unknown): Result<Operation, Problem> {
  const fail = (type: Problem['type'], detail: string) => ({ ok: false as const, error: problem(type, detail) });
  if (segments[0] !== 'v1') return fail('not_found', 'no such route');
  if (!isObject(body)) return fail('invalid_terms', 'the body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (segments.length === 2 && segments[1] === 'commitments') return { ok: true, value: { kind: 'offer', commitment: b as unknown as AnyCommitment } };
  if (segments.length === 2 && segments[1] === 'holds') {
    for (const part of ['commitment', 'acceptance', 'agree', 'funding'] as const) if (!isObject(b[part])) return fail('invalid_terms', `a one-shot hold needs ${part}`);
    return {
      ok: true,
      value: { kind: 'hold', commitment: b['commitment'] as AnyCommitment, acceptance: b['acceptance'] as AdjudicatorAcceptance, agree: b['agree'] as Agree, funding: b['funding'] as FundingAuthorization },
    };
  }
  if (segments[1] !== 'commitments' || segments.length < 4) return fail('not_found', 'no such route');
  const id = segments[2] as Hex32;
  const action = segments[3];
  let op: Operation;
  if (action === 'triggers' && segments.length === 5) {
    const timeout = TIMEOUT_KINDS.find((t) => triggerPath(t) === segments[4]);
    if (!timeout) return fail('not_found', `no trigger ${segments[4]}`);
    return { ok: true, value: { kind: 'trigger', commitmentId: id, timeout } };
  }
  if (segments.length !== 4) return fail('not_found', 'no such route');
  switch (action) {
    case 'acceptance':
      op = { kind: 'acceptance', message: b as unknown as AdjudicatorAcceptance };
      break;
    case 'agree': {
      const { fund, operatorFee, ...message } = b as Record<string, unknown>;
      if (fund !== undefined && !isObject(fund)) return fail('invalid_terms', 'fund must be a funding authorization');
      if (operatorFee !== undefined && !isObject(operatorFee)) return fail('invalid_terms', 'operatorFee must be a transfer authorization');
      if (operatorFee !== undefined && fund === undefined) return fail('invalid_terms', 'operatorFee is paid with the funded agreement: send it with fund');
      op = fund
        ? { kind: 'agree', message: message as unknown as Agree, fund: fund as unknown as FundingAuthorization, ...(operatorFee ? { operatorFee: operatorFee as unknown as TransferAuthorization } : {}) }
        : { kind: 'agree', message: message as unknown as Agree };
      break;
    }
    case 'fund':
      op = { kind: 'fund', message: b as unknown as FundingAuthorization };
      break;
    case 'deliveries':
      op = { kind: 'deliver', delivery: b as unknown as Delivery };
      break;
    case 'accept':
      op = { kind: 'early_accept', message: b as unknown as EarlyAccept };
      break;
    case 'decisions':
      op = { kind: 'decide', message: b as unknown as Decision };
      break;
    case 'appeals':
      op = { kind: 'appeal', appeal: b as unknown as Appeal };
      break;
    case 'settlements': {
      // SC-5b (T-378): the late delivery travels beside the settlement's own fields, as `fund` does beside an Agree.
      const { delivery, ...message } = b as Record<string, unknown>;
      if (delivery !== undefined && !isObject(delivery)) return fail('invalid_terms', 'delivery, when given, is the seller-signed delivery the settlement names (delivery.schema.json)');
      op = { kind: 'settle', message: message as unknown as MutualSettlement, ...(delivery !== undefined ? { delivery: delivery as unknown as Delivery } : {}) };
      break;
    }
    default:
      return fail('not_found', 'no such route');
  }
  if (commitmentIdOf(op) !== id) return fail('invalid_terms', `the body names commitment ${String(commitmentIdOf(op))}, the path ${id}`);
  return { ok: true, value: op };
}

/** The settlement submissions an operation becomes, in order. */
export function submissionsOf(op: Operation): Submission[] {
  switch (op.kind) {
    case 'offer':
      return [{ kind: 'offer', commitment: op.commitment }];
    case 'acceptance':
      return [{ kind: 'adjudicator_accept', message: op.message }];
    case 'agree':
      return op.fund ? [{ kind: 'agree_and_fund', agree: op.message, funding: op.fund, ...(op.operatorFee ? { operatorFee: op.operatorFee } : {}) }] : [{ kind: 'agree', message: op.message }];
    case 'hold':
      return [
        { kind: 'offer', commitment: op.commitment },
        { kind: 'adjudicator_accept', message: op.acceptance },
        { kind: 'agree_and_fund', agree: op.agree, funding: op.funding },
      ];
    case 'fund':
      return [{ kind: 'fund', message: op.message }];
    case 'deliver':
      return [{ kind: 'deliver', delivery: op.delivery }];
    case 'early_accept':
      return [{ kind: 'early_accept', message: op.message }];
    case 'decide':
      return [{ kind: 'decide', message: op.message }];
    case 'appeal':
      return [{ kind: 'appeal', appeal: op.appeal }];
    case 'settle':
      return [{ kind: 'mutual_settle', message: op.message, ...(op.delivery ? { delivery: op.delivery } : {}) }];
    case 'trigger':
      return [{ kind: 'trigger', commitmentId: op.commitmentId, timeout: op.timeout }];
  }
}

/** One settlement idempotency key per submission. A single submission keeps the caller's key. */
export function submissionKeys(key: string, count: number): string[] {
  return count === 1 ? [key] : Array.from({ length: count }, (_, i) => `${key}#${i}`);
}

const drop = <T extends object>(o: T, ...keys: string[]): T => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T;

/**
 * The operation with every party signature removed, for a preview (ADR-0017 §7): an operator never receives an
 * authorization it could submit. Adjudicator messages keep theirs, because they are previewed only when signed.
 */
export function unsigned(op: Operation): Operation {
  switch (op.kind) {
    case 'offer':
      return { ...op, commitment: { ...op.commitment, signatures: {} as Commitment['signatures'] } };
    case 'hold':
      return {
        ...op,
        commitment: { ...op.commitment, signatures: {} as Commitment['signatures'] },
        agree: drop(op.agree, 'signature'),
        funding: drop(op.funding, 'signature'),
      };
    case 'agree':
      return op.fund
        ? { ...op, message: drop(op.message, 'signature'), fund: drop(op.fund, 'signature'), ...(op.operatorFee ? { operatorFee: drop(op.operatorFee, 'signature') } : {}) }
        : { ...op, message: drop(op.message, 'signature') };
    case 'fund':
    case 'early_accept':
      return { ...op, message: drop(op.message, 'signature') } as Operation;
    case 'deliver':
      return { ...op, delivery: drop(op.delivery, 'signature') };
    case 'appeal':
      return { ...op, appeal: drop(op.appeal, 'signature') };
    case 'settle':
      return { ...op, message: drop(op.message, 'buyerSignature', 'sellerSignature') };
    default:
      return op;
  }
}

/** A submission as Settlement.validate takes it; unsigned party messages are allowed there. */
export const asDryRun = (s: Submission): DryRunSubmission => s as DryRunSubmission;

/**
 * The submission a preview validates. Settlement.validate sees only committed state, so a one-shot hold previews
 * its first step not yet applied: the offer, then the acceptance, then agreement and funding.
 */
export function previewSubmission(op: Operation, current: string | null): Submission {
  const subs = submissionsOf(op);
  if (op.kind !== 'hold' || current === null) return subs[0]!;
  return current === 'Offered' ? subs[1]! : subs[2]!;
}
