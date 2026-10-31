// D26: both parties hold the same record. The comparison is measured: any difference between the two copies
// turns `match` false, and the narration says the copies differ.
import type { CommitmentStateView, Hex32, Judgment, Receipt, SettlementEvent } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { sharedRecordEvent, type PartyView } from './record.js';

const ID = `0x${'87'.repeat(32)}` as Hex32;
const H = (b: string) => `0x${b.repeat(32)}` as Hex32;

function view(over: Partial<PartyView> = {}): PartyView {
  const events = [
    { seq: 0, commitmentId: ID, type: 'commitment.offered', actor: '0x01', payload: {} },
    { seq: 1, commitmentId: ID, type: 'judgment.decided', actor: '0x02', payload: { recordHash: H('b1') } },
  ] as unknown as SettlementEvent[];
  const receipts = [0, 1].map((seq) => ({ operator: '0x03', eventSeq: seq, eventHash: H(seq ? 'de' : 'aa'), commitmentId: ID, signature: '0xsig' })) as unknown as Receipt[];
  return {
    commitment: { commitmentId: ID, escrowState: 'Released' } as unknown as CommitmentStateView,
    events,
    receipts,
    judgment: { recordHash: H('b1') } as unknown as Judgment,
    ...over,
  };
}

describe('sharedRecordEvent', () => {
  it('matches when both copies are equal, and names the judgment record and the decision', () => {
    const e = sharedRecordEvent(7, [
      { who: 'buyer', view: view() },
      { who: 'seller', view: view() },
    ]);
    expect(e).toMatchObject({ kind: 'shared-record', match: true, events: 2, receipts: 2, judgmentRecord: H('b1'), decision: H('de') });
    expect(e.kind === 'shared-record' && e.parties[0]!.hash).toBe(e.kind === 'shared-record' && e.parties[1]!.hash);
  });

  it('does not match when one copy is missing a receipt', () => {
    const short = view();
    const e = sharedRecordEvent(7, [
      { who: 'buyer', view: view() },
      { who: 'seller', view: { ...short, receipts: short.receipts.slice(0, 1) } },
    ]);
    expect(e.kind === 'shared-record' && e.match).toBe(false);
  });

  it('does not match when the judgment record is not the one the decision event names', () => {
    const e = sharedRecordEvent(7, [
      { who: 'buyer', view: view() },
      { who: 'seller', view: view({ judgment: { recordHash: H('c2') } as unknown as Judgment }) },
    ]);
    expect(e.kind === 'shared-record' && e.match).toBe(false);
  });
});
