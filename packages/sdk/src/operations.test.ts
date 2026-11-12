// One table maps each operation to its HTTP route and to the settlement submissions it becomes, so the
// operator and the SDK's direct path submit the identical messages under the identical idempotency keys.
import type { Hex32 } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { operationOf, requestOf, submissionKeys, submissionsOf, unsigned, type Operation } from './operations.js';

const ID = `0x${'cd'.repeat(32)}` as Hex32;
const m = (type: string, extra: Record<string, unknown> = {}) => ({ type, commitmentId: ID, signature: '0xsig', ...extra }) as never;

const cases: Array<[Operation, string, string[]]> = [
  [{ kind: 'offer', commitment: { id: ID } as never }, '/v1/commitments', ['offer']],
  [{ kind: 'acceptance', message: m('AdjudicatorAcceptance') }, `/v1/commitments/${ID}/acceptance`, ['adjudicator_accept']],
  [{ kind: 'agree', message: m('Agree') }, `/v1/commitments/${ID}/agree`, ['agree']],
  [{ kind: 'agree', message: m('Agree'), fund: m('FundingAuthorization') }, `/v1/commitments/${ID}/agree`, ['agree_and_fund']],
  [{ kind: 'hold', commitment: { id: ID } as never, acceptance: m('AdjudicatorAcceptance'), agree: m('Agree'), funding: m('FundingAuthorization') }, '/v1/holds', ['offer', 'adjudicator_accept', 'agree_and_fund']],
  [{ kind: 'fund', message: m('FundingAuthorization') }, `/v1/commitments/${ID}/fund`, ['fund']],
  [{ kind: 'deliver', delivery: m('x') }, `/v1/commitments/${ID}/deliveries`, ['deliver']],
  [{ kind: 'early_accept', message: m('EarlyAccept') }, `/v1/commitments/${ID}/accept`, ['early_accept']],
  [{ kind: 'decide', message: m('Decision') }, `/v1/commitments/${ID}/decisions`, ['decide']],
  // SimChain only: party appeals and bonds stay in the full protocol (ADR-0031 §8).
  [{ kind: 'appeal', appeal: m('x') }, `/v1/commitments/${ID}/appeals`, ['appeal']],
  [{ kind: 'settle', message: m('MutualSettlement') }, `/v1/commitments/${ID}/settlements`, ['mutual_settle']],
  // T-378: the late work's delivery travels beside the settlement and reaches the settlement layer with it (SC-5b).
  [{ kind: 'settle', message: m('MutualSettlement'), delivery: m('x') }, `/v1/commitments/${ID}/settlements`, ['mutual_settle']],
  // SimChain only: party appeals and bonds stay in the full protocol (ADR-0031 §8).
  [{ kind: 'trigger', commitmentId: ID, timeout: 'appeal_expiry' }, `/v1/commitments/${ID}/triggers/appeal-expiry`, ['trigger']],
];

describe('operations', () => {
  it.each(cases)('%#: routes and submissions', (op, path, kinds) => {
    const req = requestOf(op);
    expect(req.path).toBe(path);
    expect(submissionsOf(op).map((s) => s.kind)).toEqual(kinds);
    // The operator parses the same request back into the same operation.
    const back = operationOf(path.split('/').filter(Boolean), req.body);
    expect(back.ok && submissionsOf(back.value)).toEqual(submissionsOf(op));
  });

  it('a settlement carries its late delivery as `delivery` beside its own fields, and the submission takes it (T-378)', () => {
    const op: Operation = { kind: 'settle', message: m('MutualSettlement'), delivery: m('x', { attempt: 1 }) };
    const req = requestOf(op);
    expect(req.body).toMatchObject({ type: 'MutualSettlement', delivery: { type: 'x', attempt: 1 } });
    expect(submissionsOf(op)).toEqual([{ kind: 'mutual_settle', message: m('MutualSettlement'), delivery: m('x', { attempt: 1 }) }]);
    const back = operationOf(['v1', 'commitments', ID, 'settlements'], req.body);
    expect(back.ok && back.value).toEqual(op);
    const bad = operationOf(['v1', 'commitments', ID, 'settlements'], { ...(m('MutualSettlement') as object), delivery: 'late' });
    expect(bad.ok || bad.error.type).toBe('invalid_terms');
  });

  it('refuses a body whose commitment does not match the path', () => {
    const other = `0x${'ef'.repeat(32)}`;
    const r = operationOf(['v1', 'commitments', other, 'accept'], m('EarlyAccept'));
    expect(r.ok || r.error.type).toBe('invalid_terms');
  });

  it('refuses an unknown trigger kind as not_found', () => {
    const r = operationOf(['v1', 'commitments', ID, 'triggers', 'steal'], {});
    expect(r.ok || r.error.type).toBe('not_found');
  });

  it('derives one idempotency key per submission, unchanged for a single submission', () => {
    expect(submissionKeys('k', 1)).toEqual(['k']);
    expect(submissionKeys('k', 3)).toEqual(['k#0', 'k#1', 'k#2']);
  });

  it('carries the operator fee (ADR-0023) from the agree body into the one agree-and-fund submission', () => {
    const op: Operation = { kind: 'agree', message: m('Agree'), fund: m('FundingAuthorization'), operatorFee: m('TransferAuthorization') };
    const req = requestOf(op);
    expect(req.body).toMatchObject({ fund: { type: 'FundingAuthorization' }, operatorFee: { type: 'TransferAuthorization' } });
    const back = operationOf(req.path.split('/').filter(Boolean), req.body);
    expect(back.ok && back.value).toEqual(op);
    const subs = submissionsOf(op);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ kind: 'agree_and_fund', operatorFee: { type: 'TransferAuthorization' } });
    expect(JSON.stringify(unsigned(op))).not.toContain('0xsig');
  });

  it('refuses an operator fee without funding: the fee is paid with the funded agreement only', () => {
    const r = operationOf(['v1', 'commitments', ID, 'agree'], { ...(m('Agree') as object), operatorFee: m('TransferAuthorization') });
    expect(r.ok || r.error.type).toBe('invalid_terms');
  });

  it('unsigned() removes every signature a party message carries', () => {
    const hold = unsigned({
      kind: 'hold',
      commitment: { id: ID, signatures: { seller: '0x1', buyer: '0x2' } } as never,
      acceptance: m('AdjudicatorAcceptance'),
      agree: m('Agree'),
      funding: m('FundingAuthorization'),
    });
    const text = JSON.stringify(hold);
    expect(text).not.toContain('0x1');
    expect(text).not.toContain('0x2');
    // An adjudicator's acceptance keeps its signature: it is previewed only when signed (ADR-0017 §7).
    expect(hold.kind === 'hold' && hold.acceptance.signature).toBe('0xsig');
    expect(hold.kind === 'hold' && 'signature' in hold.agree).toBe(false);
    expect(JSON.stringify(unsigned({ kind: 'decide', message: m('Decision') }))).toContain('0xsig');
  });
});
