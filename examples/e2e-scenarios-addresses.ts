// Scenario 12 of the Sepolia round: the two money addresses (ADR-0033, T-381). The buyer's payment address is apart
// from its signing key and the seller's payout address is apart from its signing key. A release pays the payout
// address; a reject refunds the payment address; neither signing address gains or loses a token at any step. The
// payment address signs the funding and the operator fee, the signing key the agreement (e2e-run.ts,
// agreeAndFundFrom). It runs on SimChain, on anvil in the round's test and on Sepolia in the live round.
import { buyerKeys, buyerOpens, deliver, delta, finish, fund, holdingsNow, logsOf, openDeal, short, until, type Deal, type Run } from './e2e-run.ts';
import { closeOnSimChain } from './e2e-scenarios-appeal.ts';
import { BAD_CSV, CHECKS, CSV, DATASET, PRICE, lc, paidCheck, settledChecks, type Scenario } from './e2e-scenario-kit.ts';

/**
 * Each signing address's token balance now, against the deal's starting balance: it must not have moved. Read after
 * each of the deal's steps, so a payment that passes through a signing address and back would show.
 */
async function signersUntouched(r: Run, deal: Deal, step: string): Promise<void> {
  const signers = [deal.buyer.address, deal.seller.address];
  const now = await holdingsNow(r, signers);
  const moved = signers.filter((a) => BigInt(now[a]!.token) !== BigInt(deal.record.balances.before[a]!.token));
  r.check(`after ${step}: neither signing address gained or lost a token`, moved.length === 0, signers.map((a) => `${a === deal.buyer.address ? 'buyer' : 'seller'} ${short(a)} ${r.round.amount(BigInt(now[a]!.token) - BigInt(deal.record.balances.before[a]!.token))}`).join(', '));
}

export const ADDRESSES: Scenario[] = [
  {
    id: '12',
    title: 'Two money addresses: the payout address is paid, the payment address refunded (API)',
    waitsFor: [],
    async run(r) {
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const [payment, payout] = [round.moneyAddress('buyer-payment'), round.moneyAddress('seller-payout')];
      const parties = [buyer, seller, payment, payout, round.demo.adjudicators.primary];
      const fee = (deal: Deal) => BigInt(deal.terms.adjudication.fee.amount);

      // A release: the work passes every check, and the price goes to the payout address.
      const paid = await openDeal(r, { label: 'two money addresses, a delivery that passes', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, money: true }, parties);
      r.check('the terms name the payment and payout addresses apart from the signing addresses', lc(paid.terms.buyerPaymentAddress) === payment && lc(paid.terms.sellerPayoutAddress) === payout && payment !== buyer && payout !== seller, `payment ${short(paid.terms.buyerPaymentAddress)}, payout ${short(paid.terms.sellerPayoutAddress)}`);
      await fund(r, paid);
      await signersUntouched(r, paid, 'funding');
      await deliver(r, paid, CSV);
      await signersUntouched(r, paid, 'the delivery');
      r.step = 'outcome';
      const released = await until(r, paid.buyer, paid.id, ['Released', 'Refunded', 'Escalated'], 300_000);
      r.check('the first deal ends Released', released.escrowState === 'Released', released.escrowState);
      if (released.escrowState === 'Released') r.check('the buyer opens the work with its released key', await buyerOpens(r, paid, CSV), 'decrypted with the signing key\'s encryption key, sha256 checked');
      await closeOnSimChain(r, paid, released);
      await finish(r, paid);
      await signersUntouched(r, paid, 'the release');
      const price = BigInt(PRICE);
      r.check('the payout address is paid the price', delta(paid.record, payout) === price, `payout ${round.amount(delta(paid.record, payout))}`);
      r.check('the payment address pays the price, the adjudication fee and the operator fee', delta(paid.record, payment) === -(price + fee(paid) + (paid.operatorFee ?? 0n)), `payment ${round.amount(delta(paid.record, payment))}`);
      r.check("the seller's signing address receives nothing", delta(paid.record, seller) === 0n, `seller ${round.amount(delta(paid.record, seller))}`);
      r.check("the buyer's signing address pays nothing", delta(paid.record, buyer) === 0n, `buyer ${round.amount(delta(paid.record, buyer))}`);
      settledChecks(r, paid, 'Released');
      paidCheck(r, paid, 'the price reaches the payout address on chain', payout, price);
      if (round.chain) {
        const toSeller = logsOf(paid.record, 'Transfer').filter((l) => lc(l.args.to) === seller || lc(l.args.from) === seller || lc(l.args.from) === buyer || lc(l.args.to) === buyer);
        r.check('no token transfer names a signing address on chain', toSeller.length === 0, `${toSeller.length} Transfer log(s)`);
        const settled = logsOf(paid.record, 'SettlementAddresses');
        r.check('the funding names both money addresses on chain (SettlementAddresses)', settled.length === 1 && lc(settled[0]!.args.buyerPaymentAddress) === payment && lc(settled[0]!.args.sellerPayoutAddress) === payout, `${settled.length} log(s)`);
      }

      // A refund: the work drops a row, the primary rejects, and the price goes back to the payment address.
      const refunded = await openDeal(r, { label: 'two money addresses, a delivery that drops a row', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, money: true, relay: 1 }, parties);
      await fund(r, refunded);
      await signersUntouched(r, refunded, 'funding');
      await deliver(r, refunded, BAD_CSV);
      await signersUntouched(r, refunded, 'the delivery');
      r.step = 'outcome';
      const rejected = await until(r, refunded.buyer, refunded.id, ['Released', 'Refunded', 'Escalated'], 300_000);
      r.check('the second deal ends Refunded', rejected.escrowState === 'Refunded', rejected.escrowState);
      const keys = await buyerKeys(refunded);
      r.check('no key reaches the buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
      await closeOnSimChain(r, refunded, rejected);
      await finish(r, refunded);
      await signersUntouched(r, refunded, 'the refund');
      r.check('the payment address gets the price back; the adjudication and operator fees are spent', delta(refunded.record, payment) === -(fee(refunded) + (refunded.operatorFee ?? 0n)), `payment ${round.amount(delta(refunded.record, payment))}`);
      r.check("the buyer's signing address receives nothing", delta(refunded.record, buyer) === 0n, `buyer ${round.amount(delta(refunded.record, buyer))}`);
      r.check('the seller and its payout address are paid nothing', delta(refunded.record, seller) === 0n && delta(refunded.record, payout) === 0n, `seller ${round.amount(delta(refunded.record, seller))}, payout ${round.amount(delta(refunded.record, payout))}`);
      settledChecks(r, refunded, 'Refunded');
      paidCheck(r, refunded, 'the price returns to the payment address on chain', payment, price);
    },
  },
];
