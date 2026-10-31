// D26: both parties hold the same complete record. At the end of each job, Ledger and Tide-7 each fetch their
// own copy through their own SDK client (commitment state, every settlement event, every operator receipt, and
// the judgment record the decision event names) and hash it. The comparison is measured, not asserted: any
// difference turns `match` false and the narration says the copies differ. The work itself is not in the record;
// the events carry only its hashes.
import { canonicalKeccak, type CommitmentStateView, type Hex32, type Judgment, type Page, type Receipt, type SettlementEvent } from '@holdback/core';
import type { Holdback } from '@holdback/sdk';
import type { CastKey, DemoEvent } from '../transcript/types.js';

export interface PartyView {
  commitment: CommitmentStateView | null;
  /** Oldest first. */
  events: SettlementEvent[];
  /** By event sequence. */
  receipts: Receipt[];
  /** The judgment record the decision event names, as published; absent when no adjudicator decided. */
  judgment?: Judgment;
}

async function all<T>(fetch: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetch(cursor);
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
}

/**
 * One party's copy, read through its own client. `records` resolves a judgment record by the hash the decision
 * event names (the adjudicator publishes it; in the demo, the bench directory holds what was published).
 */
export async function fetchPartyView(hb: Holdback, id: Hex32, records: (hash: string) => Judgment | undefined): Promise<PartyView> {
  const events = (await all((cursor) => hb.events(id, { limit: 200, ...(cursor ? { cursor } : {}) }))).sort((a, b) => a.seq - b.seq);
  const receipts = (await all((cursor) => hb.receipts(id, { limit: 200, ...(cursor ? { cursor } : {}) }))).sort((a, b) => a.eventSeq - b.eventSeq);
  const named = events.filter((e) => e.type === 'judgment.decided').at(-1)?.payload.recordHash;
  const judgment = typeof named === 'string' ? records(named) : undefined;
  return { commitment: await hb.commitment(id), events, receipts, ...(judgment ? { judgment } : {}) };
}

/** A copy is whole when every event has a receipt for it and the judgment record is the one its decision names. */
function whole(v: PartyView): boolean {
  const receipted = new Set(v.receipts.map((r) => r.eventSeq));
  const named = v.events.filter((e) => e.type === 'judgment.decided').at(-1)?.payload.recordHash;
  const recordOk = named === undefined ? v.judgment === undefined : v.judgment?.recordHash === named;
  return v.events.every((e) => receipted.has(e.seq)) && recordOk;
}

export function sharedRecordEvent(atMs: number, copies: { who: CastKey; view: PartyView }[]): DemoEvent {
  const hashes = copies.map((c) => ({ who: c.who, hash: canonicalKeccak(c.view) }));
  const first = copies[0]!.view;
  const decided = first.events.filter((e) => e.type === 'judgment.decided').at(-1);
  const decision = decided && first.receipts.find((r) => r.eventSeq === decided.seq)?.eventHash;
  return {
    kind: 'shared-record',
    atMs,
    actor: 'chain',
    parties: hashes,
    events: first.events.length,
    receipts: first.receipts.length,
    ...(first.judgment ? { judgmentRecord: first.judgment.recordHash } : {}),
    ...(decision ? { decision } : {}),
    match: copies.length > 1 && hashes.every((h) => h.hash === hashes[0]!.hash) && copies.every((c) => whole(c.view)),
  };
}
