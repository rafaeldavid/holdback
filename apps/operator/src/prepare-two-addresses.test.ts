// T-378 (ADR-0033 §6, §7 and §10): the prepare routes take each party's money address, fill an absent one with the
// signing address and say so in one notice, and warn, never refuse, about a money address that would lose or strand the
// money. The context is a stub with what the routes read, built from the spec's examples.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClub, parseCommitment, rulebookHash, type AnyCommitment, type TokenAmount } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { moneyAddressNotices, prepare, PrepareError, type PrepareContext } from './prepare.js';

const examples = join(import.meta.dirname, '..', '..', '..', 'spec', 'examples');
const load = (f: string): unknown => JSON.parse(readFileSync(join(examples, f), 'utf8'));
const parsedCommitment = parseCommitment(load('commitment.example.json'));
const parsedClub = parseClub(load('club.example.json'));
if (!parsedCommitment.ok || !parsedClub.ok) throw new Error('the spec examples must parse');
const example = parsedCommitment.value as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const club = parsedClub.value;
const tusd = (amount: string) => ({ token: 'tUSD', amount }) as TokenAmount;
const PAY = '0x00000000000000000000000000000000000000a1';
const PAYOUT = '0x00000000000000000000000000000000000000b2';
const RULES = '0x00000000000000000000000000000000000000f1';
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';

const ctx = (over: Partial<PrepareContext> = {}): PrepareContext =>
  ({
    phaseOne: true,
    domain: { name: 'Holdback', version: '0.8', chainId: 31337, verifyingContract: RULES },
    now: () => '2026-11-12T00:00:00Z',
    club: (id: string) => (id === club.id ? { ...club, rulebookHash: rulebookHash(club.rulebook) } : undefined),
    registration: async () => ({ policy: { id: 'bench-a/p1' }, policyHash: example['adjudication'].policyHash, registry: { hash: example['adjudication'].registryHash }, fee: { min: tusd('50000000') } }),
    commitment: async () => undefined,
    delivery: async () => undefined,
    attempt: async () => 0,
    state: async () => null,
    ...over,
  }) as unknown as PrepareContext;

const body = (over: Record<string, unknown> = {}, buyer: Record<string, unknown> = {}) => ({
  disclosure: 'public',
  template: 'checks-only',
  seller: example['seller'],
  buyer: { address: example['buyer'], encryptionPublicKey: example['buyerEncryptionPublicKey'], ...buyer },
  adjudicators: { primary: example['adjudication'].adjudicator, fallback: example['adjudication'].fallbackAdjudicator, appeal: example['adjudication'].appealAdjudicator },
  clubId: club.id,
  deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
  checks: [example['acceptance'].deterministicChecks[1]],
  price: tusd('2000000000'),
  fee: tusd('50000000'),
  nonce: `0x${'01'.repeat(32)}`,
  createdAt: '2026-11-12T00:00:00Z',
  ...over,
});
type Terms = { buyer: string; seller: string; buyerPaymentAddress: string; sellerPayoutAddress: string };
const refused = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e as PrepareError).problem);

describe('prepare offer: the two money addresses (ADR-0033)', () => {
  it('fills each absent address with its signing address and says so in one notice each', async () => {
    const p = await prepare('offer', ctx(), body());
    const t = p.submit.body as unknown as Terms;
    expect(t.buyerPaymentAddress).toBe(t.buyer);
    expect(t.sellerPayoutAddress).toBe(t.seller);
    expect(p.notices).toEqual(expect.arrayContaining([expect.stringMatching(/^Payment address: not set\. The buyer's signing address 0x[0-9a-f]{40} funds the hold/), expect.stringMatching(/^Payout address: not set\. Payments go to the seller's signing address/)]));
  });

  it('takes both addresses, lowercased into the signed terms, with no default notice', async () => {
    const p = await prepare('offer', ctx(), body({ sellerPayoutAddress: PAYOUT.toUpperCase().replace('0X', '0x') }, { paymentAddress: PAY }));
    const t = p.submit.body as unknown as Terms;
    expect(t).toMatchObject({ buyerPaymentAddress: PAY, sellerPayoutAddress: PAYOUT });
    expect((p.sign[0]!.typedData.message as Terms).sellerPayoutAddress).toBe(PAYOUT);
    expect(p.notices ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/not set/)]));
    expect(p.check.join(' ')).toContain(`sellerPayoutAddress ${PAYOUT}`);
  });

  it('a hash-only offer takes the same two inputs', async () => {
    const hashOnly = body({ hashOnly: true, disclosure: 'private', template: undefined, deliverable: undefined, checks: undefined, deliverableHash: `0x${'11'.repeat(32)}`, acceptanceHash: `0x${'22'.repeat(32)}`, sellerPayoutAddress: PAYOUT }, { paymentAddress: PAY });
    expect((await prepare('offer', ctx(), hashOnly)).submit.body).toMatchObject({ buyerPaymentAddress: PAY, sellerPayoutAddress: PAYOUT });
  });

  it.each([
    ['buyer.paymentAddress', body({}, { paymentAddress: '0x12' })],
    ['sellerPayoutAddress', body({ sellerPayoutAddress: 'me' })],
  ])('refuses a malformed %s with the field named', async (field, b) => {
    expect(await refused(prepare('offer', ctx(), b))).toMatchObject({ type: 'invalid_terms', field });
  });

  it("warns, and still prepares, for a zero address, the deployment's own contracts, Multicall3 and an adjudicator", async () => {
    const contracts = [
      { name: 'rules contract', address: RULES },
      { name: 'multicall3', address: MULTICALL },
    ] as NonNullable<PrepareContext['contracts']>;
    const primary = example['adjudication'].adjudicator as string;
    const cases: Array<[Record<string, unknown>, Record<string, unknown>, RegExp]> = [
      [{ sellerPayoutAddress: `0x${'0'.repeat(40)}` }, {}, /sellerPayoutAddress is the zero address: payments to the seller would be lost/],
      [{}, { paymentAddress: `0x${'0'.repeat(40)}` }, /buyerPaymentAddress is the zero address: no signature can fund this deal/],
      [{ sellerPayoutAddress: RULES }, {}, /sellerPayoutAddress 0x0+f1 is this deployment's rules contract: payments to the seller would be stranded there/],
      [{}, { paymentAddress: RULES }, /buyerPaymentAddress 0x0+f1 is this deployment's rules contract: no signature can fund this deal/],
      [{ sellerPayoutAddress: MULTICALL }, {}, /is Multicall3: anyone could take the seller's payment/],
      [{ sellerPayoutAddress: primary }, {}, /is the primary adjudicator: the adjudicator that decides would receive the price on an accept/],
      [{}, { paymentAddress: primary }, /is the primary adjudicator: the adjudicator that decides would receive the price on a reject/],
    ];
    for (const [over, buyer, notice] of cases) {
      const p = await prepare('offer', ctx({ contracts }), body(over, buyer));
      expect(p.notices, String(notice)).toEqual(expect.arrayContaining([expect.stringMatching(notice)]));
      expect(p.notices!.find((n) => notice.test(n))).toMatch(/You may still choose it$/);
    }
  });

  it('gives no warning for ordinary separate addresses', () => {
    const t = { buyerPaymentAddress: PAY, sellerPayoutAddress: PAYOUT, adjudication: example['adjudication'] } as never;
    expect(moneyAddressNotices({ contracts: [{ name: 'rules contract', address: RULES }] }, t)).toEqual([]);
  });
});

describe('prepare after the offer: the money addresses sign and are paid', () => {
  const terms = async () => {
    const p = await prepare('offer', ctx(), body({ sellerPayoutAddress: PAYOUT }, { paymentAddress: PAY }));
    return { ...(p.submit.body as object), id: p.commitmentId, signatures: { seller: `0x${'0'.repeat(130)}` } } as unknown as AnyCommitment;
  };

  it('agree-and-fund: the payment address signs the funding and the operator fee, the signing address the agreement', async () => {
    const c = await terms();
    const fee = { to: '0x00000000000000000000000000000000000000c3', token: 'tUSD', bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false };
    const p = await prepare('agree-and-fund', ctx({ commitment: async () => c, operatorFee: fee as never }), { commitmentId: c.id, agreeNonce: `0x${'02'.repeat(32)}`, fundingNonce: `0x${'03'.repeat(32)}`, operatorFeeNonce: `0x${'04'.repeat(32)}` });
    expect(p.sign.map((s) => [s.slot, s.signer])).toEqual([
      ['signature', c.buyer],
      ['fund.signature', PAY],
      ['operatorFee.signature', PAY],
    ]);
    expect(p.check.join(' ')).toContain(`the payment address ${PAY} signs fund.signature and operatorFee.signature`);
  });

  it('settlement: the payouts go to the payout and payment addresses, named as such', async () => {
    const c = await terms();
    const p = await prepare('settlement', ctx({ commitment: async () => c }), { commitmentId: c.id, nonce: `0x${'05'.repeat(32)}`, toSellerBps: 3000 });
    expect((p.submit.body as { payouts: Array<{ to: string }> }).payouts.map((x) => x.to)).toEqual([PAYOUT, PAY]);
    expect(p.check[0]).toMatch(/to 0x0+b2 \(the seller's payout address\); .* to 0x0+a1 \(the buyer's payment address\)/);
  });

  it("early accept: the check line names the seller's payout address", async () => {
    const c = await terms();
    const p = await prepare('early-accept', ctx({ commitment: async () => c, delivery: async () => ({ deliveryHash: `0x${'06'.repeat(32)}`, attempt: 1 }) as never }), { commitmentId: c.id, nonce: `0x${'07'.repeat(32)}` });
    expect(p.check[1]).toContain(`to the seller's payout address ${PAYOUT}`);
  });
});
