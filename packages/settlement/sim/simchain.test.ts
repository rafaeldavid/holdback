// SimChain demo paths and guards, end to end through signed submissions (docs/architecture.md postings table).
import { beaconRoundFor, parseCommitmentState, parseEvent, type Hex32, type ProblemType, type Timestamp } from '@holdback/core';
import { encodePacked, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Submission, SubmitResult } from '../src/interface.js';
import { Deal, simActor, simCast, simClub, simGenesis, SIM_RULEBOOK, tusd, type Cast } from './actors.js';
import { SimChain, type Genesis } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const PRICE = 2_000_000_000n;
const FEE = 50_000_000n;
const HOLD = PRICE + FEE;
const BOND = 25_000_000_000n;

interface World {
  chain: SimChain;
  genesis: Genesis;
  cast: Cast;
  deal: Deal;
  bal: (a: { address: `0x${string}` }) => Promise<bigint>;
  ok: (s: Submission | Promise<Submission>) => Promise<Extract<SubmitResult, { ok: true }>>;
  refused: (s: Submission | Promise<Submission>) => Promise<ProblemType>;
}

async function world(over: { bonds?: Partial<Record<keyof Cast, bigint>>; rulebook?: typeof SIM_RULEBOOK; balances?: Partial<Record<keyof Cast, bigint>> } = {}): Promise<World> {
  const cast = simCast();
  const club = simClub(simActor('club-operator').address, over.rulebook ?? SIM_RULEBOOK);
  const genesis = await simGenesis({
    cast,
    club,
    start: START,
    balances: over.balances ?? { buyer: 10_000_000_000n, seller: 1_000_000_000n },
    bonds: over.bonds ?? { primary: BOND, fallback: BOND, appeal: BOND },
  });
  const chain = new SimChain(genesis);
  const deal = new Deal(chain, cast, { club });
  const bal = async (a: { address: `0x${string}` }) => BigInt((await chain.balances([a.address]))[a.address]!.amount);
  const ok = async (s: Submission | Promise<Submission>) => {
    const r = await chain.submit(await s);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
    return r;
  };
  const refused = async (s: Submission | Promise<Submission>) => {
    const r = await chain.submit(await s);
    if (r.ok) throw new Error(`expected a refusal, got ${r.state.escrowState}`);
    return r.problem.type;
  };
  return { chain, genesis, cast, deal, bal, ok, refused };
}

async function delivered(w: World): Promise<void> {
  await w.ok(w.deal.offer());
  await w.ok(w.deal.accept());
  await w.ok(w.deal.agreeAndFund());
  await w.ok(w.deal.deliver());
  w.chain.advance(5);
}

const types = (r: { events: Array<{ type: string }> }) => r.events.map((e) => e.type);
const secondsAt = (ts: Timestamp) => Math.floor(Date.parse(ts) / 1000);

describe('beacon (ADR-0018)', () => {
  it('is keccak256(simSeed || round), one round per simulated second, available only once the clock reaches it', async () => {
    const { chain, genesis } = await world();
    const now = secondsAt(chain.now());
    expect(chain.beacon(now)).toBe(keccak256(encodePacked(['bytes32', 'uint64'], [genesis.simSeed, BigInt(now)])));
    expect(chain.beacon(now + 1)).toBeNull();
    chain.advance(1);
    expect(chain.beacon(now + 1)).not.toBeNull();
  });
});

describe('happy path (demo beats 1-4)', () => {
  it('holds, delivers, releases with the key in the same step, and reaches finality when the appeal window closes', async () => {
    const w = await world();
    const { chain, deal, cast } = w;
    await w.ok(deal.offer());
    const accepted = await w.ok(deal.accept());
    expect(types(accepted)).toEqual(['adjudicator.accepted']);
    expect(chain.pool(cast.primary.address)).toEqual({ junior: BOND, senior: 0n, reserved: PRICE });
    const funded = await w.ok(deal.agreeAndFund());
    expect(types(funded)).toEqual(['commitment.agreed', 'hold.funded']);
    expect(await w.bal(cast.buyer)).toBe(10_000_000_000n - HOLD);
    expect(chain.ledger()[`escrow:${deal.id}`]).toBe(HOLD);
    await w.ok(deal.deliver());
    expect(await chain.keysFor(deal.id, cast.buyer.address)).toEqual([]);
    chain.advance(5);

    const decided = await w.ok(deal.decide('primary', 'accept'));
    expect(types(decided)).toEqual(['judgment.decided', 'settlement.released', 'key.released']);
    expect(decided.state).toMatchObject({ escrowState: 'Released', appealState: 'none', settledAt: chain.now(), finalAt: null });
    expect(await w.bal(cast.seller)).toBe(1_000_000_000n + PRICE);
    expect(await w.bal(cast.primary)).toBe(FEE);
    expect(chain.ledger()[`escrow:${deal.id}`] ?? 0n).toBe(0n);
    expect(await chain.keysFor(deal.id, cast.buyer.address)).toHaveLength(1);

    chain.advance(300);
    const view = await chain.state(deal.id);
    expect(view?.finalAt).toBe(view?.deadlines['appealBy']);
    expect(chain.pool(cast.primary.address).reserved).toBe(PRICE);
    expect(types(await w.ok(deal.trigger('appeal_expiry')))).toEqual(['appeal.expired']);
    expect(chain.pool(cast.primary.address).reserved).toBe(0n);
  });

  it('refuses an accept that carries no key for the buyer', async () => {
    const w = await world();
    await delivered(w);
    expect(await w.refused(w.deal.decide('primary', 'accept', { withoutKey: true }))).toBe('invalid_terms');
  });

  it('refunds on reject, pays the fee for judging and never releases the key', async () => {
    const w = await world();
    await delivered(w);
    const r = await w.ok(w.deal.decide('primary', 'reject'));
    expect(types(r)).toEqual(['judgment.decided', 'settlement.refunded']);
    expect(await w.bal(w.cast.buyer)).toBe(10_000_000_000n - FEE);
    expect(await w.bal(w.cast.primary)).toBe(FEE);
    expect(await w.chain.keysFor(w.deal.id, w.cast.buyer.address)).toEqual([]);
  });

  it('delivers the key to the buyer, not to a relayer that adds an unsigned recipient to the signed key', async () => {
    const w = await world();
    await delivered(w);
    const relayer = simActor('relayer');
    const s = await w.deal.decide('primary', 'accept');
    if (s.kind !== 'decide' || !s.message.keyForBuyer) throw new Error('expected a decision with a key');
    // SealedKey signs scheme and ciphertext only; the relayer smuggles a recipient past the signature.
    const tampered = { ...s, message: { ...s.message, keyForBuyer: { ...s.message.keyForBuyer, recipient: relayer.address } } } as Submission;
    const r = await w.ok(tampered);
    expect(r.state.escrowState).toBe('Released');
    expect(await w.chain.keysFor(w.deal.id, relayer.address)).toEqual([]);
    expect(await w.chain.keysFor(w.deal.id, w.cast.buyer.address)).toEqual([
      { recipient: w.cast.buyer.address, scheme: s.message.keyForBuyer.scheme, ciphertext: s.message.keyForBuyer.ciphertext },
    ]);
  });

  it('keeps finalAt at appealBy when appeal expiry is triggered late (D20)', async () => {
    const w = await world();
    await delivered(w);
    await w.ok(w.deal.decide('primary', 'accept'));
    w.chain.advance(1_000);
    const before = (await w.chain.state(w.deal.id))!;
    expect(before.finalAt).toBe(before.deadlines['appealBy']);
    const r = await w.ok(w.deal.trigger('appeal_expiry'));
    expect(r.state.finalAt).toBe(before.finalAt);
    expect((await w.chain.state(w.deal.id))?.finalAt).toBe(before.finalAt);
  });
});

describe('early acceptance', () => {
  it('pays the seller, returns the fee to the buyer and releases the seller-supplied key with the payment', async () => {
    const w = await world();
    await delivered(w);
    const r = await w.ok(w.deal.earlyAccept());
    expect(types(r)).toEqual(['settlement.released', 'key.released']);
    expect(await w.bal(w.cast.buyer)).toBe(10_000_000_000n - PRICE);
    expect(await w.bal(w.cast.seller)).toBe(1_000_000_000n + PRICE);
    expect(await w.bal(w.cast.primary)).toBe(0n);
    expect(await w.chain.keysFor(w.deal.id, w.cast.buyer.address)).toEqual([w.deal.envelope(w.cast.buyer.address)]);
    expect(w.chain.pool(w.cast.primary.address).reserved).toBe(0n);
    expect(r.state.finalAt).toBe(r.state.settledAt);
  });

  it('stores and releases only the signed fields of a delivery envelope, never extras a relayer adds', async () => {
    const w = await world();
    await w.ok(w.deal.offer());
    await w.ok(w.deal.accept());
    await w.ok(w.deal.agreeAndFund());
    const s = await w.deal.deliver();
    if (s.kind !== 'deliver') throw new Error('expected a delivery');
    const encryptedKeys = s.delivery.encryptedKeys.map((k) => ({ ...k, note: 'unsigned' }));
    await w.ok({ ...s, delivery: { ...s.delivery, encryptedKeys } } as Submission);
    w.chain.advance(5);
    await w.ok(w.deal.earlyAccept());
    const [released] = await w.chain.keysFor(w.deal.id, w.cast.buyer.address);
    expect(released).toStrictEqual(w.deal.envelope(w.cast.buyer.address));
  });
});

describe('fallback (primary silent)', () => {
  it('releases the fallback envelope only on takeover and takes the beacon seed for judgeBy', async () => {
    const w = await world();
    await delivered(w);
    expect(await w.refused(w.deal.trigger('fallback'))).toBe('invalid_state');
    expect(await w.chain.keysFor(w.deal.id, w.cast.fallback.address)).toEqual([]);
    w.chain.advanceTo(w.deal.terms.timing.judgeBy);
    const t = await w.ok(w.deal.trigger('fallback'));
    expect(types(t)).toEqual(['fallback.triggered', 'key.released']);
    expect(await w.chain.keysFor(w.deal.id, w.cast.fallback.address)).toEqual([w.deal.envelope(w.cast.fallback.address)]);
    expect(w.chain.pool(w.cast.fallback.address).reserved).toBe(PRICE);

    expect(await w.refused(w.deal.decide('fallback', 'accept', { seed: keccak256('0x01') }))).toBe('seed_mismatch');
    const r = await w.ok(w.deal.decide('fallback', 'accept'));
    expect(r.state.escrowState).toBe('Released');
    expect(await w.bal(w.cast.fallback)).toBe(FEE);
    expect(await w.bal(w.cast.primary)).toBe(0n);
    expect(w.chain.pool(w.cast.primary.address).reserved).toBe(0n);
  });

  it('defaults when the fallback is silent too: refunds the buyer and pays compensation from both bonds, rounded down', async () => {
    const w = await world();
    await delivered(w);
    w.chain.advanceTo(w.deal.terms.timing.judgeBy);
    await w.ok(w.deal.trigger('fallback'));
    w.chain.advanceTo(w.deal.terms.timing.fallbackBy);
    expect(types(await w.ok(w.deal.trigger('default')))).toEqual(['default.triggered']);
    const r = await w.ok(w.deal.trigger('apply_default'));
    expect(types(r)).toEqual(['settlement.refunded', 'bond.slashed', 'bond.slashed']);
    // 10% of the price (rulebook 1000 bps), split between the primary and the fallback.
    expect(await w.bal(w.cast.buyer)).toBe(10_000_000_000n);
    expect(await w.bal(w.cast.seller)).toBe(1_000_000_000n + 200_000_000n);
    expect(w.chain.pool(w.cast.primary.address)).toEqual({ junior: BOND - 100_000_000n, senior: 0n, reserved: 0n });
    expect(w.chain.pool(w.cast.fallback.address)).toEqual({ junior: BOND - 100_000_000n, senior: 0n, reserved: 0n });
    expect(r.state.finalAt).toBe(r.state.settledAt);
  });
});

describe('escalation', () => {
  it('needs the appeal envelope, reserves the appeal bond, and takes the round after the escalation', async () => {
    const w = await world();
    await delivered(w);
    expect(await w.refused(w.deal.decide('primary', 'escalate', { withoutAppealEnvelope: true }))).toBe('invalid_terms');
    const e = await w.ok(w.deal.decide('primary', 'escalate'));
    expect(types(e)).toEqual(['judgment.decided', 'key.released']);
    expect(w.chain.pool(w.cast.primary.address).reserved).toBe(0n);
    expect(w.chain.pool(w.cast.appeal.address).reserved).toBe(PRICE);
    expect(await w.chain.keysFor(w.deal.id, w.cast.appeal.address)).toHaveLength(1);
    // The round strictly after the escalation is not published yet.
    expect(await w.refused(w.deal.decide('appeal', 'reject'))).toBe('seed_mismatch');
    w.chain.advance(1);
    const r = await w.ok(w.deal.decide('appeal', 'reject'));
    expect(r.state).toMatchObject({ escrowState: 'Refunded', appealState: 'none', finalAt: r.state.settledAt });
    expect(await w.bal(w.cast.appeal)).toBe(FEE);
    expect(await w.bal(w.cast.primary)).toBe(0n);
    expect(w.chain.pool(w.cast.appeal.address).reserved).toBe(0n);
  });

  it('defaults after the escalation times out and the appeal adjudicator bond pays the compensation', async () => {
    const w = await world();
    await delivered(w);
    await w.ok(w.deal.decide('primary', 'escalate'));
    w.chain.advance(300);
    await w.ok(w.deal.trigger('default'));
    const r = await w.ok(w.deal.trigger('apply_default'));
    expect(types(r)).toEqual(['settlement.refunded', 'bond.slashed']);
    expect(await w.bal(w.cast.seller)).toBe(1_000_000_000n + 200_000_000n);
    expect(w.chain.pool(w.cast.appeal.address)).toEqual({ junior: BOND - 200_000_000n, senior: 0n, reserved: 0n });
  });
});

describe('party appeal (D21: the appeal fee is held until decided)', () => {
  async function rejected(w: World) {
    await delivered(w);
    await w.ok(w.deal.decide('primary', 'reject'));
    w.chain.advance(10);
  }
  const appealBond = 100_000_000n; // ceil(2000 tUSD x 500 bps)
  const appealFee = 25_000_000n;

  it('overturned: the primary bond pays the seller the price, the appeal adjudicator gets the held fee, the appellant its bond back', async () => {
    const w = await world();
    await rejected(w);
    expect(await w.refused(w.deal.appealBy('seller', tusd(appealBond - 1n)))).toBe('insufficient_funds');
    const filed = await w.ok(w.deal.appealBy('seller'));
    expect(types(filed)).toEqual(['appeal.filed', 'key.released']);
    expect(w.chain.ledger()[`appealfee:${w.deal.id}`]).toBe(appealFee);
    w.chain.advance(1);
    const r = await w.ok(w.deal.decide('appeal', 'accept'));
    expect(types(r)).toEqual(['appeal.decided', 'bond.slashed', 'key.released']);
    expect(r.state).toMatchObject({ escrowState: 'Refunded', appealState: 'overturned', finalAt: w.chain.now() });
    expect(await w.bal(w.cast.seller)).toBe(1_000_000_000n - appealFee + PRICE);
    expect(await w.bal(w.cast.appeal)).toBe(appealFee);
    expect(w.chain.pool(w.cast.primary.address)).toEqual({ junior: BOND - PRICE, senior: 0n, reserved: 0n });
  });

  it('upheld: the appellant bond goes to the primary junior tranche', async () => {
    const w = await world();
    await rejected(w);
    await w.ok(w.deal.appealBy('seller'));
    w.chain.advance(1);
    const r = await w.ok(w.deal.decide('appeal', 'reject'));
    expect(r.state.appealState).toBe('upheld');
    expect(w.chain.pool(w.cast.primary.address)).toEqual({ junior: BOND + appealBond, senior: 0n, reserved: 0n });
    expect(await w.bal(w.cast.seller)).toBe(1_000_000_000n - appealBond - appealFee);
    expect(await w.bal(w.cast.appeal)).toBe(appealFee);
  });

  it('expired undecided: bond and fee return to the appellant and the first decision stands', async () => {
    const w = await world();
    await rejected(w);
    await w.ok(w.deal.appealBy('seller'));
    expect(await w.refused(w.deal.trigger('appeal_expiry'))).toBe('invalid_state');
    const appealDecideBy = (await w.chain.state(w.deal.id))!.deadlines['appealDecideBy']!;
    w.chain.advanceTo(appealDecideBy);
    expect((await w.chain.state(w.deal.id))?.finalAt).toBe(appealDecideBy);
    const r = await w.ok(w.deal.trigger('appeal_expiry'));
    expect(types(r)).toEqual(['appeal.expired']);
    expect(await w.bal(w.cast.seller)).toBe(1_000_000_000n);
    expect(await w.bal(w.cast.appeal)).toBe(0n);
    expect(w.chain.pool(w.cast.primary.address).reserved).toBe(0n);
  });

  it('expired late: finalAt stays at appealDecideBy, not the trigger time (D20)', async () => {
    const w = await world();
    await rejected(w);
    await w.ok(w.deal.appealBy('seller'));
    const appealDecideBy = (await w.chain.state(w.deal.id))!.deadlines['appealDecideBy']!;
    w.chain.advanceTo(appealDecideBy);
    w.chain.advance(1_000);
    expect((await w.chain.state(w.deal.id))?.finalAt).toBe(appealDecideBy);
    const r = await w.ok(w.deal.trigger('appeal_expiry'));
    expect(r.state.finalAt).toBe(appealDecideBy);
  });
});

describe('timeouts with nothing judged', () => {
  it('reclaim returns price and fee when nothing was delivered', async () => {
    const w = await world();
    await w.ok(w.deal.offer());
    await w.ok(w.deal.accept());
    await w.ok(w.deal.agreeAndFund());
    expect(await w.refused(w.deal.trigger('reclaim'))).toBe('invalid_state');
    w.chain.advanceTo(w.deal.terms.timing.deliverBy);
    expect(types(await w.ok(w.deal.trigger('reclaim')))).toEqual(['settlement.reclaimed']);
    expect(await w.bal(w.cast.buyer)).toBe(10_000_000_000n);
    expect(w.chain.pool(w.cast.primary.address).reserved).toBe(0n);
  });

  it('an adjudicator that never accepts leaves nothing held, and the offer expires', async () => {
    const w = await world();
    await w.ok(w.deal.offer());
    expect(await w.refused(w.deal.agreeAndFund())).toBe('acceptance_missing');
    expect(await w.bal(w.cast.buyer)).toBe(10_000_000_000n);
    w.chain.advanceTo(w.deal.terms.timing.offerExpiresAt);
    const r = await w.ok(w.deal.trigger('expire_offer'));
    expect(r.state).toMatchObject({ escrowState: 'Expired', settledAt: null });
  });

  it('settle is refused in guaranteed mode (settle_after_window is Phase 4)', async () => {
    const w = await world();
    await delivered(w);
    await w.ok(w.deal.decide('primary', 'accept'));
    expect(await w.refused(w.deal.trigger('settle'))).toBe('invalid_state');
  });
});

describe('mutual settlement (ADR-0019)', () => {
  it('posts each payout, returns the fee to the buyer, releases the key and every reservation', async () => {
    const w = await world();
    await delivered(w);
    const payouts = w.deal.split(1_400_000_000n);
    const r = await w.ok(w.deal.mutual({ payouts, releaseKey: true }));
    expect(types(r)).toEqual(['commitment.settled', 'key.released']);
    expect(r.state).toMatchObject({ escrowState: 'Settled', settled: { payouts, keyReleased: true } });
    expect(await w.bal(w.cast.seller)).toBe(1_000_000_000n + 1_400_000_000n);
    expect(await w.bal(w.cast.buyer)).toBe(10_000_000_000n - 1_400_000_000n);
    expect(w.chain.pool(w.cast.primary.address).reserved).toBe(0n);
    expect(await w.chain.keysFor(w.deal.id, w.cast.buyer.address)).toHaveLength(1);
  });

  it('pays a third party both sign for when the rulebook allows any recipient, and refuses it under parties only (D23)', async () => {
    const outsider = simActor('outsider');
    const cast = simCast();
    const payouts = [
      { to: cast.seller.address, amount: tusd(1_000_000_000n) },
      { to: cast.buyer.address, amount: tusd(500_000_000n) },
      { to: outsider.address, amount: tusd(500_000_000n) },
    ];
    const parties = await world();
    await delivered(parties);
    expect(await parties.refused(parties.deal.mutual({ payouts }))).toBe('invalid_terms');
    const any = await world({ rulebook: { ...SIM_RULEBOOK, mutualSettlement: { ...SIM_RULEBOOK.mutualSettlement, payoutsTo: 'any' } } });
    await delivered(any);
    await any.ok(any.deal.mutual({ payouts }));
    expect(await any.bal(outsider)).toBe(500_000_000n);
    expect(await any.bal(any.cast.seller)).toBe(1_000_000_000n + 1_000_000_000n);
    expect(await any.bal(any.cast.buyer)).toBe(10_000_000_000n - HOLD + 500_000_000n + FEE);
  });

  it('refuses payouts that do not sum to the price', async () => {
    const w = await world();
    await delivered(w);
    expect(await w.refused(w.deal.mutual({ payouts: [{ to: w.cast.seller.address, amount: tusd(PRICE + 1n) }] }))).toBe('invalid_terms');
  });

  it('refuses one party signing for both', async () => {
    const w = await world();
    await delivered(w);
    expect(await w.refused(w.deal.mutual({ signers: [w.cast.seller, w.cast.seller] }))).toBe('invalid_signature');
  });

  it('refuses when the rulebook does not allow it', async () => {
    const w = await world({ rulebook: { ...SIM_RULEBOOK, mutualSettlement: { ...SIM_RULEBOOK.mutualSettlement, allowed: false } } });
    await delivered(w);
    expect(await w.refused(w.deal.mutual())).toBe('invalid_terms');
  });

  it('settle-once: a decision after the settlement is refused, and so is a settlement after a decision', async () => {
    const a = await world();
    await delivered(a);
    await a.ok(a.deal.mutual());
    expect(await a.refused(a.deal.decide('primary', 'accept'))).toBe('invalid_state');
    const b = await world();
    await delivered(b);
    await b.ok(b.deal.decide('primary', 'accept'));
    expect(await b.refused(b.deal.mutual())).toBe('invalid_state');
  });
});

describe('coverage gate (ADR-0014 §2a, ADR-0007)', () => {
  it('pays an overturn only from the overturned commitment reservation, never from units another commitment reserved', async () => {
    const w = await world({ bonds: { primary: BOND, fallback: 2_500_000_000n, appeal: BOND } });
    const club = simClub(simActor('club-operator').address);
    const b = new Deal(w.chain, w.cast, { club, tag: 'b' });
    for (const d of [w.deal, b]) for (const s of [d.offer(), d.accept(), d.agreeAndFund(), d.deliver()]) await w.ok(s);
    w.chain.advanceTo(w.deal.terms.timing.judgeBy);
    await w.ok(w.deal.trigger('fallback'));
    await w.ok(b.trigger('fallback'));
    // A reserved 2,000 of the fallback's 2,500; B could reserve only the 500 left.
    expect(w.chain.pool(w.cast.fallback.address)).toEqual({ junior: 2_500_000_000n, senior: 0n, reserved: 2_500_000_000n });
    await w.ok(b.decide('fallback', 'reject'));
    await w.ok(b.appealBy('seller'));
    w.chain.advance(1);
    const sellerBefore = await w.bal(w.cast.seller);
    await w.ok(b.decide('appeal', 'accept'));
    expect(await w.bal(w.cast.seller)).toBe(sellerBefore + 500_000_000n + 100_000_000n); // capped payout + appeal bond back
    expect(w.chain.pool(w.cast.fallback.address)).toEqual({ junior: 2_000_000_000n, senior: 0n, reserved: 2_000_000_000n });
  });

  it('refuses an appeal the appellant cannot pay for, with no effects', async () => {
    const w = await world({ balances: { buyer: 10_000_000_000n } });
    await delivered(w);
    await w.ok(w.deal.decide('primary', 'reject'));
    const before = w.chain.digest();
    expect(await w.refused(w.deal.appealBy('seller'))).toBe('insufficient_funds');
    expect(w.chain.digest()).toBe(before);
  });


  it('counts reserved bond once: a second guaranteed commitment waits until the first leaves its appeal window', async () => {
    const w = await world({ bonds: { primary: 3_000_000_000n, fallback: BOND, appeal: BOND } });
    await delivered(w);
    await w.ok(w.deal.decide('primary', 'accept'));
    const second = new Deal(w.chain, w.cast, { club: simClub(simActor('club-operator').address), tag: 'second' });
    await w.ok(second.offer());
    expect(await w.refused(second.accept())).toBe('coverage_exceeded');
    w.chain.advance(300);
    await w.ok(w.deal.trigger('appeal_expiry'));
    await w.ok(second.accept());
  });
});

describe('idempotency and resubmission', () => {
  it('replays the same key with the same body, refuses another body, and refuses a resubmitted message without effects', async () => {
    const w = await world();
    await w.ok(w.deal.offer());
    const accept = await w.deal.accept();
    const first = await w.chain.submit(accept, { idempotencyKey: 'k1' });
    const head = w.chain.digest();
    const again = await w.chain.submit(accept, { idempotencyKey: 'k1' });
    expect(again).toEqual({ ...first, replayed: true });
    expect(w.chain.digest()).toBe(head);
    const other = await w.chain.submit(await w.deal.accept(), { idempotencyKey: 'k1' });
    expect(other.ok ? 'ok' : other.problem.type).toBe('idempotency_conflict');
    const bare = await w.chain.submit(accept);
    expect(bare.ok ? 'ok' : bare.problem.type).toBe('nonce_reused');
    expect(w.chain.digest()).toBe(head);
  });

  it('agree_and_fund is all or nothing: a failed funding leaves the agreement unapplied and its nonce unused', async () => {
    const w = await world({ balances: { buyer: 1_000_000n } });
    await w.ok(w.deal.offer());
    await w.ok(w.deal.accept());
    const both = await w.deal.agreeAndFund();
    expect(await w.refused(both)).toBe('insufficient_funds');
    expect((await w.chain.state(w.deal.id))?.escrowState).toBe('AcceptedByAdjudicator');
    w.chain.faucet(w.cast.buyer.address, 10_000_000_000n);
    await w.ok(both);
  });
});

describe('validate (ADR-0017 §7)', () => {
  it('previews an unsigned party message, reports the skipped check, and changes nothing', async () => {
    const w = await world();
    await w.ok(w.deal.offer());
    await w.ok(w.deal.accept());
    const before = w.chain.digest();
    const { agree, funding } = (await w.deal.agreeAndFund()) as Extract<Submission, { kind: 'agree_and_fund' }>;
    const strip = <T extends { signature?: unknown }>(m: T): Omit<T, 'signature'> => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'signature')) as Omit<T, 'signature'>;
    const r = await w.chain.validate({ kind: 'agree_and_fund', agree: strip(agree), funding: strip(funding) });
    expect(r).toMatchObject({ ok: true, dryRun: true, signatureCheck: 'skipped', events: [], state: { escrowState: 'Held' } });
    expect(w.chain.digest()).toBe(before);
    expect((await w.chain.state(w.deal.id))?.escrowState).toBe('AcceptedByAdjudicator');
  });

  it('refuses an unsigned adjudicator message and returns the live problem for a signed one', async () => {
    const w = await world();
    await delivered(w);
    const before = w.chain.digest();
    const { message } = (await w.deal.decide('primary', 'accept', { seed: keccak256('0x02') })) as Extract<Submission, { kind: 'decide' }>;
    const r = await w.chain.validate({ kind: 'decide', message });
    expect(r.ok ? 'ok' : r.problem.type).toBe('seed_mismatch');
    const unsigned = await w.chain.validate({ kind: 'decide', message: { ...message, signature: '0x' } });
    expect(unsigned.ok ? 'ok' : unsigned.problem.type).toBe('invalid_signature');
    expect(w.chain.digest()).toBe(before);
  });
});

describe('facts the settlement layer owns', () => {
  it('refuses an agent with no mandate in the club, and a non-member in a closed club', async () => {
    const w = await world({ rulebook: { ...SIM_RULEBOOK, open: false } });
    await w.ok(w.deal.offer());
    await w.ok(w.deal.accept());
    expect(await w.refused(w.deal.agreeAndFund())).toBe('member_not_admitted');
    const stranger = { ...w.cast, seller: simActor('stranger') };
    const d = new Deal(w.chain, stranger, { club: simClub(simActor('club-operator').address, { ...SIM_RULEBOOK, open: false }), tag: 'stranger' });
    expect(await w.refused(d.offer())).toBe('scope_exceeded');
  });

  it('refuses a delivery signed by someone other than the seller', async () => {
    const w = await world();
    await w.ok(w.deal.offer());
    await w.ok(w.deal.accept());
    await w.ok(w.deal.agreeAndFund());
    expect(await w.refused(w.deal.deliver({ signer: w.cast.buyer }))).toBe('invalid_signature');
  });
});

describe('event log, read model and replay', () => {
  it('emits schema-valid, hash-chained events and read models, and a replay of the journal reproduces the chain', async () => {
    const w = await world();
    await delivered(w);
    await w.ok(w.deal.decide('primary', 'reject'));
    await w.ok(w.deal.appealBy('seller'));
    w.chain.advance(1);
    await w.ok(w.deal.decide('appeal', 'accept'));
    const log = w.chain.log();
    let prev: Hex32 = `0x${'00'.repeat(32)}`;
    for (const [i, e] of log.entries()) {
      const parsed = parseEvent(JSON.parse(JSON.stringify(e)));
      if (!parsed.ok) throw new Error(`event ${i} ${e.type}: ${JSON.stringify(parsed.error)}`);
      expect(e.seq).toBe(i);
      expect(e.prevHash).toBe(prev);
      prev = e.hash;
    }
    expect(SimChain.verifyLog(log)).toBe(true);
    expect(SimChain.verifyLog(log.map((e, i) => (i === 3 ? { ...e, payload: { ...e.payload, tampered: true } } : e)))).toBe(false);
    const view = await w.chain.state(w.deal.id);
    const parsedView = parseCommitmentState(JSON.parse(JSON.stringify(view)));
    if (!parsedView.ok) throw new Error(JSON.stringify(parsedView.error));
    const offered = log.find((e) => e.type === 'commitment.offered')!;
    expect(offered.payload['termsHash']).toBe(w.deal.id);
    expect(log.filter((e) => e.type === 'judgment.decided' || e.type === 'appeal.decided').every((e) => typeof e.payload['recordHash'] === 'string')).toBe(true);

    const replayed = await SimChain.replay(w.genesis, w.chain.journal());
    expect(replayed.digest()).toBe(w.chain.digest());
    expect(replayed.log().at(-1)?.hash).toBe(log.at(-1)?.hash);
  });

  it('keeps the escrow state the core step computes', async () => {
    const w = await world();
    await delivered(w);
    const s = w.chain.escrowState(w.deal.id)!;
    expect(s.kind).toBe('Delivered');
    expect(beaconRoundFor(s, 'fallback')).toBe(secondsAt(w.deal.terms.timing.judgeBy));
  });
});
