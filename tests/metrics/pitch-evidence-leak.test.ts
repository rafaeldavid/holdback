// T-425, measurement 3: the worst a leaked key can do, on a local anvil chain only, never the live service.
// The holder has the leaked signing key and a key of its own with gas; it does not have the party's encryption key.
// For the buyer's per-deal key and for the seller's key, at each stage (before funding, after funding, after
// delivery), it tries what the key can sign, straight to the contracts; each attempt is recorded with what moved.
// Two shapes of deal. The try command's: each party's signing address is also its money address (the buyer's payment
// address and the seller's payout address). ADR-0033's per-deal key: the signing keys hold no money, and the deal names
// a payment address and a payout address apart from them, which the holder does not have.
// Skipped without anvil and forge build output, as CI's shards are.
//
//   node scripts/metrics/pitch-evidence.mjs leak          writes the record (PITCH_EVIDENCE_OUT) and prints its table
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_SKIP, anvilReady } from '../../examples/e2e-world.ts';
import { LocalWorld, PRICE_UNITS, revertOf, type Apart, type LocalDeal, type Party } from './pitch-evidence-anvil.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Hex = `0x${string}`;

type KeyName = 'buyer' | 'seller' | 'buyer (per-deal, money apart)' | 'seller (money apart)';
const rows: Array<{ key: KeyName; stage: string; action: string; result: string; toHolder: string; partyLoss: string }> = [];
const units = (v: bigint) => {
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${v / 1_000_000n}${frac ? `.${frac}` : ''}`;
};

/** Runs one attempt; a revert is recorded with the contract's error, never thrown. */
async function attempt(f: () => Promise<J>): Promise<{ ok: boolean; result: string }> {
  try {
    const tx = await f();
    return { ok: tx?.status === 'success' || typeof tx === 'bigint', result: tx?.status ?? 'done' };
  } catch (e) {
    return { ok: false, result: `reverts ${revertOf(e)}` };
  }
}

describe.skipIf(!anvilReady)(`T-425 measurement 3: what a leaked key can do (anvil)${ANVIL_SKIP}`, () => {
  let lw: LocalWorld;
  let holder: Hex; // the holder's own key, with gas
  let holderAddress: string;
  const deals: Record<string, LocalDeal> = {};
  let fee = 0n;
  let holderStart = 0n;
  let drained = 0n;
  let apart: Apart;

  beforeAll(async () => {
    lw = await LocalWorld.start();
    const h = await lw.party(10n ** 18n); // only for its address and gas; its faucet grant stays put
    holder = h.key;
    holderAddress = h.agent.address;
    holderStart = (await lw.balances([holderAddress]))[holderAddress]!;
    deals['buyer-before'] = await lw.deal({ fund: false });
    deals['buyer-held'] = await lw.deal();
    deals['buyer-delivered'] = await lw.deal();
    deals['seller-before'] = await lw.deal({ fund: false });
    deals['seller-held'] = await lw.deal();
    deals['seller-delivered'] = await lw.deal();
    deals['seller-released'] = await lw.deal();
    // ADR-0033's shape: a payer wallet and a payout address the holder does not have; the signing keys get their club
    // mandate from the faucet, then move its tokens to the payer, so they hold none.
    const payer = await lw.party();
    apart = { payer, payout: (await lw.party(0n, { faucet: false })).agent.address };
    const signing = async () => {
      const p = await lw.party();
      await lw.drain(p, payer.agent.address, p.key);
      return p;
    };
    for (const name of ['apart-before', 'apart-held', 'apart-delivered', 'apart-released']) {
      deals[name] = await lw.deal({ buyer: await signing(), seller: await signing(), apart, fund: name !== 'apart-before' });
    }
    fee = BigInt(deals['buyer-held']!.terms.adjudication.fee.amount);
    // Judged by the world's primary through the operators: the price lands at the seller's payout address.
    await lw.deliver(deals['seller-released']!, { judge: true });
    await lw.until(deals['seller-released']!.buyer.agent, deals['seller-released']!.id, ['Released'], 120_000);
    await lw.deliver(deals['apart-released']!, { judge: true });
    await lw.until(deals['apart-released']!.buyer.agent, deals['apart-released']!.id, ['Released'], 120_000);
    // Delivered with the passes paused: no adjudicator decides these.
    await lw.deliver(deals['buyer-delivered']!);
    await lw.deliver(deals['seller-delivered']!);
    await lw.deliver(deals['apart-delivered']!);
  }, 900_000);

  afterAll(async () => {
    await lw?.close();
    const out = process.env['PITCH_EVIDENCE_OUT'];
    if (!out || !rows.length) return;
    const lines = [
      'leak: what the holder of a leaked key can do (local anvil); amounts in tUSDC, the party\'s money address = its signing address',
      '| Key | Stage | Attempt | Result | To the holder | The party loses |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows.map((r) => `| ${r.key} | ${r.stage} | ${r.action} | ${r.result} | ${r.toHolder} | ${r.partyLoss} |`),
      `The holder's own address gained ${units(drained)} tUSDC in all, the sum of the drains above, read from the chain.`,
    ];
    writeFileSync(out, `${JSON.stringify({ schema: 'crow.metrics.pitch-evidence/1', generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), generator: { script: 'tests/metrics/pitch-evidence-leak.test.ts' }, leak: { chain: 'anvil (local)', priceUnits: PRICE_UNITS.toString(), feeUnits: fee.toString(), rows, lines } }, null, 2)}\n`);
  });

  /** Records an attempt that moves nothing. */
  const refused = async (key: KeyName, stage: string, action: string, f: () => Promise<J>) => {
    const r = await attempt(f);
    rows.push({ key, stage, action, result: r.result, toHolder: '0', partyLoss: '0' });
    return r;
  };
  /** The holder drains the leaked address with the key's own ERC-3009 signature and records what moved. */
  const drain = async (key: KeyName, stage: string, leaked: Party) => {
    const before = (await lw.balances([holderAddress]))[holderAddress]!;
    const moved = await lw.drain(leaked, holderAddress, holder);
    const after = (await lw.balances([holderAddress]))[holderAddress]!;
    expect(after - before).toBe(moved);
    drained += moved;
    rows.push({ key, stage, action: 'move the address\'s whole balance (ERC-3009, no gas at the address)', result: moved ? 'success' : 'nothing to move', toHolder: units(moved), partyLoss: units(moved) });
    return moved;
  };

  describe("the buyer's per-deal key", () => {
    it('before funding: the holder can move what the address holds, and nothing else exists to take', async () => {
      const d = deals['buyer-before']!;
      expect(await lw.stage(d.id)).toBe('None');
      const moved = await drain('buyer', 'before funding', d.buyer);
      expect(moved).toBeGreaterThan(0n);
      expect((await lw.balances([d.buyer.agent.address]))[d.buyer.agent.address]).toBe(0n);
    });

    it('after funding: the hold stays under the terms; only the rest of the balance moves, and a later refund lands at the address', async () => {
      const d = deals['buyer-held']!;
      expect(await lw.stage(d.id)).toBe('Held');
      expect((await refused('buyer', 'after funding', 'reclaim the hold before deliverBy', () => lw.triggerDirect(d, 'reclaim', holder))).result).toBe('reverts TooEarly');
      expect((await refused('buyer', 'after funding', 'settle alone, the whole price to its own address', () => lw.mutualDirect(d, d.buyer, d.buyer.agent.address, holder))).ok).toBe(false);
      expect((await refused('buyer', 'after funding', "settle alone, the whole price to the holder's address", () => lw.mutualDirect(d, d.buyer, holderAddress, holder))).ok).toBe(false);
      expect((await refused('buyer', 'after funding', 'trigger the default refund', () => lw.triggerDirect(d, 'triggerDefault', holder))).result).toBe('reverts WrongStage');
      expect(await lw.stage(d.id)).toBe('Held');
      await drain('buyer', 'after funding', d.buyer);
    }, 120_000);

    it('after delivery: an early accept pays the agreed seller only; the holder cannot read the work or redirect the price', async () => {
      const d = deals['buyer-delivered']!;
      expect(await lw.stage(d.id)).toBe('Delivered');
      expect((await refused('buyer', 'after delivery', "settle alone, the whole price to the holder's address", () => lw.mutualDirect(d, d.buyer, holderAddress, holder))).ok).toBe(false);
      const before = await lw.balances([d.seller.agent.address, holderAddress]);
      const r = await attempt(() => lw.earlyAcceptDirect(d, d.buyer, holder));
      expect(r.ok).toBe(true);
      expect(await lw.stage(d.id)).toBe('Released');
      const after = await lw.balances([d.seller.agent.address, holderAddress]);
      expect(after[d.seller.agent.address]! - before[d.seller.agent.address]!).toBe(PRICE_UNITS);
      expect(after[holderAddress]).toBe(before[holderAddress]);
      // The buyer pays the agreed price to the agreed seller for work the checks did not judge, and gets the work's key
      // sealed to its own encryption key, which the holder does not have.
      rows.push({ key: 'buyer', stage: 'after delivery', action: 'accept early (the price to the seller, the fee back)', result: 'success', toHolder: '0', partyLoss: `${units(PRICE_UNITS)}, paid to the agreed seller for unjudged work` });
      await drain('buyer', 'after delivery', d.buyer);
    }, 120_000);
  });

  describe("ADR-0033's per-deal key: the money addresses apart from the signing keys", () => {
    it("the buyer's key before funding holds nothing, and cannot fund a deal with the payment address's money", async () => {
      const d = deals['apart-before']!;
      expect(await lw.stage(d.id)).toBe('None');
      expect(await drain('buyer (per-deal, money apart)', 'before funding', d.buyer)).toBe(0n);
      const r = await refused('buyer (per-deal, money apart)', 'before funding', "agree and fund, signing the payment address's funding itself", () => lw.fundDirect(d, d.buyer, d.buyer, holder));
      expect(r.ok).toBe(false);
      expect(await lw.stage(d.id)).toBe('None');
    }, 120_000);

    it("the buyer's key after funding cannot settle alone or take anything", async () => {
      const d = deals['apart-held']!;
      expect(await lw.stage(d.id)).toBe('Held');
      expect((await refused('buyer (per-deal, money apart)', 'after funding', "settle alone, the whole price to the holder's address", () => lw.mutualDirect(d, d.buyer, holderAddress, holder))).ok).toBe(false);
      expect((await refused('buyer (per-deal, money apart)', 'after funding', 'settle alone, the whole price to the payment address', () => lw.mutualDirect(d, d.buyer, apart.payer.agent.address, holder))).ok).toBe(false);
      expect(await drain('buyer (per-deal, money apart)', 'after funding', d.buyer)).toBe(0n);
      expect(await lw.stage(d.id)).toBe('Held');
    }, 120_000);

    it("the buyer's key after delivery can accept early: the payment address pays this deal's price to the agreed payout address", async () => {
      const d = deals['apart-delivered']!;
      expect(await lw.stage(d.id)).toBe('Delivered');
      const watch = [apart.payout, apart.payer.agent.address, holderAddress];
      const before = await lw.balances(watch);
      expect((await attempt(() => lw.earlyAcceptDirect(d, d.buyer, holder))).ok).toBe(true);
      expect(await lw.stage(d.id)).toBe('Released');
      const after = await lw.balances(watch);
      expect(after[apart.payout]! - before[apart.payout]!).toBe(PRICE_UNITS);
      expect(after[apart.payer.agent.address]! - before[apart.payer.agent.address]!).toBe(fee); // the fee comes back
      expect(after[holderAddress]).toBe(before[holderAddress]);
      rows.push({ key: 'buyer (per-deal, money apart)', stage: 'after delivery', action: 'accept early (the price to the payout address, the fee back to the payment address)', result: 'success', toHolder: '0', partyLoss: `${units(PRICE_UNITS)}, this deal's price, paid to the agreed payout address for unjudged work` });
    }, 120_000);

    it("the seller's key holds nothing, cannot accept for the buyer, and the price goes to the payout address", async () => {
      const held = deals['apart-held']!;
      expect((await refused('seller (money apart)', 'after funding', "settle alone, the whole price to the holder's address", () => lw.mutualDirect(held, held.seller, holderAddress, holder))).ok).toBe(false);
      const done = deals['apart-released']!;
      expect(await lw.stage(done.id)).toBe('Released');
      rows.push({ key: 'seller (money apart)', stage: 'after funding', action: 'deliver work that passes the checks: the primary pays the price to the payout address, not the key', result: 'Released by the primary', toHolder: '0', partyLoss: '0' });
      expect(await drain('seller (money apart)', 'after payment', done.seller)).toBe(0n);
    }, 120_000);
  });

  describe("the seller's key", () => {
    it('before funding: the holder can move what the address holds', async () => {
      const d = deals['seller-before']!;
      expect(await lw.stage(d.id)).toBe('None');
      expect(await drain('seller', 'before funding', d.seller)).toBeGreaterThan(0n);
    });

    it('after delivery: it cannot accept in the buyer\'s place or settle alone', async () => {
      const d = deals['seller-delivered']!;
      expect(await lw.stage(d.id)).toBe('Delivered');
      expect((await refused('seller', 'after delivery', "accept early in the buyer's place", () => lw.earlyAcceptDirect(d, d.seller, holder))).result).toBe('reverts BadSignature');
      expect((await refused('seller', 'after delivery', "settle alone, the whole price to the holder's address", () => lw.mutualDirect(d, d.seller, holderAddress, holder))).ok).toBe(false);
      expect(await lw.stage(d.id)).toBe('Delivered');
    }, 120_000);

    // After the delivered case: its judged delivery turns the passes back on.
    it('after funding: the hold stays under the terms', async () => {
      const d = deals['seller-held']!;
      expect(await lw.stage(d.id)).toBe('Held');
      expect((await refused('seller', 'after funding', 'settle alone, the whole price to its own address', () => lw.mutualDirect(d, d.seller, d.seller.agent.address, holder))).ok).toBe(false);
      expect((await refused('seller', 'after funding', "settle alone, the whole price to the holder's address", () => lw.mutualDirect(d, d.seller, holderAddress, holder))).ok).toBe(false);
      expect((await refused('seller', 'after funding', 'trigger the default refund', () => lw.triggerDirect(d, 'triggerDefault', holder))).result).toBe('reverts WrongStage');
      expect(await lw.stage(d.id)).toBe('Held');
      await drain('seller', 'after funding', d.seller);
      // The holder delivers work of its choosing, here work that fails the agreed checks; the world's primary decides.
      await lw.deliver(d, { judge: true, content: 'name\nnot the agreed columns\n' });
      expect(await lw.until(d.buyer.agent, d.id, ['Released', 'Refunded'], 120_000)).toBe('Refunded');
      expect((await lw.balances([d.seller.agent.address]))[d.seller.agent.address]).toBe(0n);
      rows.push({ key: 'seller', stage: 'after funding', action: 'deliver work that fails the agreed checks', result: 'Refunded by the primary', toHolder: '0', partyLoss: 'the deal it would have been paid for' });
    }, 180_000);

    it('after delivery and payment: the price sits at the payout address, so the holder can move it', async () => {
      const d = deals['seller-released']!;
      expect(await lw.stage(d.id)).toBe('Released');
      // The key signed this delivery of work that passes the checks; a holder could sign the same.
      rows.push({ key: 'seller', stage: 'after funding', action: 'deliver work that passes the agreed checks: the primary pays the price to the payout address, here the leaked one', result: 'Released by the primary', toHolder: '0', partyLoss: '0' });
      const moved = await drain('seller', 'after payment', d.seller);
      expect(moved).toBeGreaterThanOrEqual(PRICE_UNITS);
    }, 120_000);
  });

  // Last, as it moves anvil's clock past every deal's deliverBy.
  it("the buyer's key, after funding: at deliverBy the hold is refunded to the payment address, which the holder then empties", async () => {
    const d = deals['buyer-held']!;
    await lw.pause(); // the operators also send due timeouts themselves (T-231): keep them from racing the holder
    await lw.warpTo(d.terms.timing.deliverBy);
    expect((await attempt(() => lw.triggerDirect(d, 'reclaim', holder))).ok).toBe(true); // anyone may send it
    expect(await lw.stage(d.id)).toBe('Refunded');
    rows.push({ key: 'buyer', stage: 'after funding', action: 'reclaim at deliverBy (anyone may): the hold returns to the payment address', result: 'success', toHolder: '0', partyLoss: '0' });
    expect(await drain('buyer', 'after the refund', d.buyer)).toBe(PRICE_UNITS + fee);
  }, 120_000);

  it("the holder's own address gained exactly the drains, read from the chain: no contract call paid it", async () => {
    const end = (await lw.balances([holderAddress]))[holderAddress]!;
    expect(end - holderStart).toBe(drained);
    for (const r of rows) if (r.toHolder !== '0') expect(r.action).toMatch(/whole balance/);
  });
});
