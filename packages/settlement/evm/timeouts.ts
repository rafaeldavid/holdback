// The operators send due timeouts on their own (T-231). Every timeout on HoldbackRules is permissionless: anyone may
// send it once its deadline passes, and the contract checks it against dealOf and the terms. Before T-231 the
// operators sent one only when a party asked (POST /v1/commitments/<id>/triggers/<kind>, T-228), so a deal whose parties
// went away waited for someone to come back. Now the world's pass sends each due timeout itself, at the relayer's
// gas, through that same relay path (EvmSettlement.trigger).
//
// - What it sends: the reclaim, the default (with the takeover it needs when the fallback stayed silent), the appeal
//   expiry and an accepted offer's expiry. Not the takeover before fallbackBy: that is the fallback adjudicator's own
//   turn, which it may decline (T-211). Not an offer no adjudicator accepted: nobody can fund it, and posting one is free.
// - When: the book says when each falls due. A deal behind the chain (T-218) is read from dealOf instead, since its book
//   stopped. The contract then answers at a pinned block, never before a block this node already applied (docs/team.md,
//   a chain read after a transaction), with an eth_call: a call it refuses there is not sent.
// - Guards on the relayer's gas: only books this node holds; only calls the contract accepts at that block; a cap per
//   pass on sends and on reads; a daily budget the world keeps; a back-off per deal after any refusal or failure,
//   which ends when the deal moves.
// - Once: each send carries an Idempotency-Key the world derives from its secret, so a retry or a restart replays its
//   answer (T-219's lane rows carry it), and a trigger that comes after the timeout ran sends nothing (EvmSettlement).
import type { EscrowState, Hex32, Timing } from '@holdback/core';
import { encodeFunctionData } from 'viem';
import type { TimeoutKind } from '../src/interface.js';
import { termsView } from './encode.js';
import { revertData, revertName } from './errors.js';
import type { EvmSettlement } from './evm-settlement.js';

/** One timeout the operators send for a deal: which, when it falls due (ms since the epoch), and what waits on it. */
export interface DueTimeout {
  kind: TimeoutKind;
  at: number;
  /** 0: the hold or a party's appeal bond waits on it. 1: only the decider's bond. 2: nothing is held (an accepted offer). */
  rank: 0 | 1 | 2;
}

/** A daily budget for the timeouts the operators send on their own. */
export interface TimeoutBudget {
  /**
   * Spends one send of `kind`, before it goes out, so a restart counts it. True, or when the budget opens again and
   * whether only offer expiries are closed.
   */
  take(kind: TimeoutKind): Promise<true | { opensAt: number; offersOnly: boolean }>;
}

export interface OperatorTimeoutsOptions {
  /** The operator ID each relayed timeout carries as `submittedVia`. */
  via: string;
  /** The Idempotency-Key of one deal's timeout. The world derives it from its secret, so no client can take it first. */
  key: (id: Hex32, kind: TimeoutKind) => string;
  /** Timeouts a pass sends at most. Default 4: each waits for its block, about 12 s on Sepolia. */
  perPass?: number;
  /** Chain reads a pass makes at most (dealOf for a deal behind the chain, and the contract's check). Default 16. */
  readsPerPass?: number;
  /** The daily budget. Absent: none. */
  budget?: TimeoutBudget;
  /** Told of each timeout this node sent: the world's telemetry counts them. */
  sent?: (kind: TimeoutKind) => void;
  /** Told of a send that failed with an error (an RPC down, a divergence): it is tried again after a back-off. */
  onError?: (e: Error) => void;
}

/** What one pass did. */
export interface TimeoutReport {
  /** The block the pass checked at, or null when nothing was due. */
  block: string | null;
  sent: Array<{ commitmentId: Hex32; kind: TimeoutKind }>;
  /** Refused by the contract at the pinned block, or by the relay: not sent, and backed off. */
  refused: Array<{ commitmentId: Hex32; kind: TimeoutKind; detail: string }>;
  /** Due and left for a later pass: the caps, the budget, a lane row still open, a block behind this node's view. */
  deferred: number;
  /** dealOf reads and contract checks made. */
  reads: number;
}

/** The contract function of each timeout this module sends. */
const FN: Partial<Record<TimeoutKind, string>> = { expire_offer: 'expireOffer', reclaim: 'reclaim', fallback: 'triggerFallback', default: 'triggerDefault', appeal_expiry: 'expireAppeal' };
/** HoldbackRules.Stage, as dealOf returns it. */
const STAGES = ['None', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Released', 'Refunded', 'Settled', 'Expired'] as const;
const PER_PASS = 4;
const READS_PER_PASS = 16;
/**
 * The back-offs, each doubling with every miss in a row for that deal. The first is for a block before a deadline the
 * wall clock already passed (TooEarly), about one Sepolia block. Any other refusal at the pinned block means the book
 * disagrees with the chain until the next sync. A failure is an RPC error. A send that reverted on chain cost gas.
 */
const BACKOFF = {
  early: { first: 12_000, max: 300_000 },
  refused: { first: 60_000, max: 3_600_000 },
  failed: { first: 30_000, max: 900_000 },
  reverted: { first: 3_600_000, max: 86_400_000 },
} as const;

/**
 * The next timeout the operators send for a book's state, and when it falls due; null when they send none for it again
 * (a later event of the deal asks once more).
 */
export function nextTimeout(s: EscrowState): DueTimeout | null {
  const t = s.terms.timing;
  switch (s.kind) {
    case 'AcceptedByAdjudicator':
    case 'Agreed':
      // After either deadline nothing can fund it (agreeAndFund reverts DeadlinePassed); the expiry records it.
      return { kind: 'expire_offer', at: Math.min(Date.parse(t.offerExpiresAt), Date.parse(t.fundBy)), rank: 2 };
    case 'Held':
      return { kind: 'reclaim', at: Date.parse(t.deliverBy), rank: 0 };
    case 'Delivered':
      // The default needs the takeover first. Before fallbackBy the takeover is the fallback adjudicator's own turn.
      return { kind: 'fallback', at: Date.parse(t.fallbackBy), rank: 0 };
    case 'FallbackJudging':
      return { kind: 'default', at: Date.parse(t.fallbackBy), rank: 0 };
    case 'Escalated':
      return { kind: 'default', at: Date.parse(s.escalation.appealDecideBy), rank: 0 };
    case 'Released':
    case 'Refunded': {
      if (s.via.kind !== 'first_instance') return null;
      const a = s.via.appeal;
      if (a.kind === 'none') return { kind: 'appeal_expiry', at: Date.parse(a.appealBy), rank: 1 };
      if (a.kind === 'open') return { kind: 'appeal_expiry', at: Date.parse(a.appealDecideBy), rank: 0 };
      return null;
    }
    default:
      return null;
  }
}

/**
 * The same for a deal behind the chain, from dealOf: its stage name, its appeal state (HoldbackRules.AppealState: 0
 * none, 1 open) and t1 in seconds (when it was decided or escalated), with the terms' timing.
 */
export function nextOnChain(d: { stage: string; appeal: number; t1: number }, t: Timing): DueTimeout | null {
  switch (d.stage) {
    case 'Held':
      return { kind: 'reclaim', at: Date.parse(t.deliverBy), rank: 0 };
    case 'Delivered':
      return { kind: 'fallback', at: Date.parse(t.fallbackBy), rank: 0 };
    case 'FallbackJudging':
      return { kind: 'default', at: Date.parse(t.fallbackBy), rank: 0 };
    case 'Escalated':
      return { kind: 'default', at: (d.t1 + t.appealDecideSec) * 1000, rank: 0 };
    case 'Released':
    case 'Refunded':
      if (d.appeal === 0) return { kind: 'appeal_expiry', at: (d.t1 + t.appealWindowSec) * 1000, rank: 1 };
      if (d.appeal === 1) return { kind: 'appeal_expiry', at: (d.t1 + t.appealWindowSec + t.appealDecideSec) * 1000, rank: 0 };
      return null;
    default:
      return null;
  }
}

/** One deal the pass may still send a timeout for. */
interface Watch {
  /** No check before this (ms): its due time, or a back-off. */
  notBefore: number;
  /** Misses in a row (refusals and failures), for the back-off. */
  misses: number;
  /** A deal behind the chain: its next timeout as dealOf last showed it (undefined until read). */
  onChain?: DueTimeout | null;
}

/**
 * The operators' own timeouts, over one settlement view. The world calls `run` once a pass, after the chain sync and its
 * own adjudicators, and asks `nextAt` when to set its next alarm.
 */
export class OperatorTimeouts {
  private readonly watched = new Map<Hex32, Watch>();
  /** Events read from the log so far. */
  private seq = 0;
  /** The highest block of any transaction in the log: every check reads there or later. */
  private logBlock = 0n;
  /** When the budget opens again (ms): for every send, and for offer expiries alone. */
  private readonly closed = { all: 0, offers: 0 };

  constructor(
    private readonly evm: EvmSettlement,
    private readonly o: OperatorTimeoutsOptions,
  ) {}

  private now(): number {
    return Date.parse(this.evm.now());
  }

  /** Reads the log's new events. Each brings its deal back with no back-off: a deal that moved is checked afresh. */
  private ingest(): void {
    if (this.evm.eventCount() <= this.seq) return;
    const log = this.evm.log();
    for (const e of log.slice(this.seq)) {
      const b = e.payload['block'];
      if ((typeof b === 'string' && /^[0-9]+$/.test(b)) || typeof b === 'number') {
        const n = BigInt(b);
        if (n > this.logBlock) this.logBlock = n;
      }
      if (e.commitmentId) this.watched.set(e.commitmentId, { notBefore: 0, misses: 0 });
    }
    this.seq = log.length;
  }

  /** The deal's next timeout from its book; for a deal behind the chain, as dealOf last showed it (undefined: unread). */
  private next(id: Hex32, w: Watch): DueTimeout | null | undefined {
    const s = this.evm.escrowState(id);
    if (!s) return null;
    return this.evm.behindStage(id) ? w.onChain : nextTimeout(s);
  }

  private closedFor(kind: TimeoutKind | undefined): number {
    return Math.max(this.closed.all, kind === 'expire_offer' ? this.closed.offers : 0);
  }

  /** When a pass should next run to send a timeout (ms), or null when none is ahead. */
  nextAt(): number | null {
    this.ingest();
    const now = this.now();
    let at = Infinity;
    for (const [id, w] of this.watched) {
      const c = this.next(id, w);
      if (c === null) {
        this.watched.delete(id);
        continue;
      }
      at = Math.min(at, Math.max(c?.at ?? now, w.notBefore, this.closedFor(c?.kind)));
    }
    return at === Infinity ? null : at;
  }

  /**
   * One pass: sends each due timeout the contract accepts, money first, within the caps and the budget. `floor` is the
   * block the chain sync last read up to: no check reads before it.
   */
  async run(floor?: bigint): Promise<TimeoutReport> {
    this.ingest();
    const now = this.now();
    const report: TimeoutReport = { block: null, sent: [], refused: [], deferred: 0, reads: 0 };
    const due: Array<{ id: Hex32; w: Watch; c: DueTimeout | undefined }> = [];
    for (const [id, w] of this.watched) {
      if (w.notBefore > now) continue;
      const c = this.next(id, w);
      if (c === null) {
        this.watched.delete(id);
        continue;
      }
      if (c && c.at > now) {
        w.notBefore = c.at;
        continue;
      }
      if (this.closedFor(c?.kind) > now) {
        report.deferred++;
        continue;
      }
      due.push({ id, w, c });
    }
    if (due.length === 0) return report;
    // Money first, then the oldest deadline. A deal behind the chain is read first: its timeout may hold the money.
    due.sort((x, y) => (x.c?.rank ?? 0) - (y.c?.rank ?? 0) || (x.c?.at ?? 0) - (y.c?.at ?? 0));
    const chain = this.evm.world;
    const head = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    const block = [head, floor ?? 0n, this.logBlock].reduce((a, b) => (b > a ? b : a));
    report.block = block.toString();
    const perPass = this.o.perPass ?? PER_PASS;
    const readsPerPass = this.o.readsPerPass ?? READS_PER_PASS;
    let attempts = 0;
    let stop = false;
    for (const { id, w } of due) {
      if (stop || attempts >= perPass || report.reads >= readsPerPass) {
        report.deferred++;
        continue;
      }
      // A transaction this node broadcast before a restart lands first (T-219): the world's pass recovers it.
      if ((chain.inFlight?.() ?? []).some((r) => r.note && r.note.commitmentId.toLowerCase() === id.toLowerCase())) {
        report.deferred++;
        continue;
      }
      try {
        const c = await this.dueNow(id, w, block, now, report);
        if (!c) continue;
        if (this.closedFor(c.kind) > now) {
          report.deferred++;
          continue;
        }
        report.reads++;
        const why = await this.refusal(id, c.kind, block);
        if (why !== null) {
          report.refused.push({ commitmentId: id, kind: c.kind, detail: `contract revert ${why} at block ${block}` });
          this.backOff(w, now, why === 'TooEarly' ? BACKOFF.early : BACKOFF.refused);
          continue;
        }
        const open = this.o.budget ? await this.o.budget.take(c.kind) : true;
        if (open !== true) {
          if (open.offersOnly) this.closed.offers = open.opensAt;
          else this.closed.all = open.opensAt;
          report.deferred++;
          continue;
        }
        attempts++;
        const behind = this.evm.behindStage(id) !== null;
        const r = await this.evm.trigger(id, c.kind, { idempotencyKey: this.o.key(id, c.kind), via: this.o.via });
        if (r.ok) {
          this.watched.set(id, { notBefore: 0, misses: 0 });
          // A timeout that already ran (another sender got there first) answers with no event and sends nothing; a deal
          // behind the chain logs no event for its timeout.
          if (!r.replayed && (behind || r.events.length > 0)) {
            report.sent.push({ commitmentId: id, kind: c.kind });
            this.o.sent?.(c.kind);
          }
        } else {
          report.refused.push({ commitmentId: id, kind: c.kind, detail: `${r.problem.type}: ${r.problem.detail}` });
          this.backOff(w, now, /reverted on chain/.test(r.problem.detail) ? BACKOFF.reverted : BACKOFF.refused);
          // Out of test ETH or above a gas cap: the next send would meet the same answer.
          if (r.problem.type === 'relay_refused') stop = true;
        }
      } catch (e) {
        this.backOff(w, now, BACKOFF.failed);
        this.o.onError?.(new Error(`the operators' timeout for ${id} failed: ${(e as Error).message}`));
      }
    }
    return report;
  }

  /**
   * The deal's timeout if it is due now, read again (the book may have moved during this pass). For a deal behind the
   * chain, from dealOf at the pinned block, which must show the stage this node last applied: an earlier stage means
   * the block lags this node's own relay, and a later one a step the sync has not applied yet.
   */
  private async dueNow(id: Hex32, w: Watch, block: bigint, now: number, report: TimeoutReport): Promise<DueTimeout | null> {
    const s = this.evm.escrowState(id);
    if (!s) return null;
    const behind = this.evm.behindStage(id);
    let c: DueTimeout | null;
    if (behind) {
      report.reads++;
      const d = await this.dealAt(id, block);
      if (d.stage !== behind.stage || d.appeal !== behind.appeal) {
        this.backOff(w, now, BACKOFF.early);
        report.deferred++;
        return null;
      }
      c = w.onChain = nextOnChain(d, s.terms.timing);
    } else {
      c = nextTimeout(s);
    }
    if (c === null) {
      this.watched.delete(id);
      return null;
    }
    if (c.at > now) {
      w.notBefore = c.at;
      return null;
    }
    return c;
  }

  /** dealOf at `block`: the stage's name, the appeal state and t1 (seconds). */
  private async dealAt(id: Hex32, block: bigint): Promise<{ stage: string; appeal: number; t1: number }> {
    const chain = this.evm.world;
    const d = (await chain.publicClient.readContract({ address: chain.deployment.rules, abi: chain.abis.rules, functionName: 'dealOf', args: [id], blockNumber: block })) as { stage: number; appeal: number; t1: number | bigint };
    return { stage: STAGES[d.stage] ?? 'None', appeal: Number(d.appeal), t1: Number(d.t1) };
  }

  /** The contract's answer to the timeout at `block`: null when it accepts it, else the revert's name. Throws on an RPC error. */
  private async refusal(id: Hex32, kind: TimeoutKind, block: bigint): Promise<string | null> {
    const chain = this.evm.world;
    const fn = FN[kind];
    const s = this.evm.escrowState(id);
    if (!fn || !s) return 'no such timeout';
    const data = encodeFunctionData({ abi: chain.abis.rules, functionName: fn, args: [termsView(s.terms)] });
    try {
      await chain.publicClient.call({ account: chain.senderFor(id), to: chain.deployment.rules, data, blockNumber: block });
      return null;
    } catch (e) {
      const raw = revertData(e);
      if (raw === undefined && !/revert/i.test(String((e as Error).message))) throw e;
      return revertName(chain.abis.rules, raw) ?? 'an unknown error';
    }
  }

  private backOff(w: Watch, now: number, b: { first: number; max: number }): void {
    w.notBefore = now + Math.min(b.first * 2 ** w.misses, b.max);
    w.misses++;
  }
}
