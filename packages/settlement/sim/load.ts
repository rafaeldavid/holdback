// `pnpm load` (T-006): SimChain under load.
// 1. 1,000 holds: offer, adjudicator acceptance and a one-shot agree_and_fund each; reports p50 and p95
//    latency per submission (messages are signed before timing starts, so the numbers are SimChain's:
//    signature recovery, step, postings and events).
// 2. 100 concurrent holds on one balance that covers only some of them: zero overdrafts.
import { performance } from 'node:perf_hooks';
import type { Submission } from '../src/interface.js';
import { Deal, simActor, simCast, simClub, simGenesis, tusd } from './actors.js';
import { SimChain } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const PRICE = 1_000_000n;
const FEE = 10_000n;

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!;
const ms = (x: number) => `${x.toFixed(2)} ms`;

async function holds(n: number): Promise<void> {
  const cast = simCast('load');
  const club = simClub(simActor('club-operator', 'load').address);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: BigInt(n) * (PRICE + FEE) }, bonds: { primary: BigInt(n) * PRICE } });
  const chain = new SimChain(genesis);
  const deals = Array.from({ length: n }, (_, i) => new Deal(chain, cast, { club, price: tusd(PRICE), fee: tusd(FEE), tag: `load-${i}` }));
  const signed: Submission[][] = [];
  for (const d of deals) signed.push([await d.offer(), await d.accept(), await d.agreeAndFund()]);
  const perSubmission: number[] = [];
  const perHold: number[] = [];
  const t0 = performance.now();
  for (const subs of signed) {
    const h0 = performance.now();
    for (const s of subs) {
      const s0 = performance.now();
      const r = await chain.submit(s);
      perSubmission.push(performance.now() - s0);
      if (!r.ok) throw new Error(`load: ${s.kind} refused: ${r.problem.type}: ${r.problem.detail}`);
    }
    perHold.push(performance.now() - h0);
  }
  const total = performance.now() - t0;
  perSubmission.sort((a, b) => a - b);
  perHold.sort((a, b) => a - b);
  const held = deals.filter((d) => chain.escrowState(d.id)?.kind === 'Held').length;
  console.log(`holds: ${held}/${n} held in ${ms(total)} (${((n * 1000) / total).toFixed(0)} holds/s)`);
  console.log(`  per submission: p50 ${ms(pct(perSubmission, 50))}, p95 ${ms(pct(perSubmission, 95))}  (${perSubmission.length} submissions)`);
  console.log(`  per hold (3 submissions): p50 ${ms(pct(perHold, 50))}, p95 ${ms(pct(perHold, 95))}`);
  console.log(`  events: ${chain.log().length}; log verifies: ${SimChain.verifyLog(chain.log())}`);
  if (held !== n) throw new Error('load: not every hold was funded');
}

async function concurrent(n: number, affordable: number): Promise<void> {
  const cast = simCast('load-concurrent');
  const club = simClub(simActor('club-operator', 'load-concurrent').address);
  const balance = BigInt(affordable) * (PRICE + FEE);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: balance }, bonds: { primary: BigInt(n) * PRICE } });
  const chain = new SimChain(genesis);
  const deals = Array.from({ length: n }, (_, i) => new Deal(chain, cast, { club, price: tusd(PRICE), fee: tusd(FEE), tag: `c-${i}` }));
  for (const d of deals) for (const s of [await d.offer(), await d.accept()]) if (!(await chain.submit(s)).ok) throw new Error('load: setup refused');
  const funding = await Promise.all(deals.map((d) => d.agreeAndFund()));
  // All submitted at once; SimChain applies them one at a time.
  const results = await Promise.all(funding.map((s) => chain.submit(s)));
  const ok = results.filter((r) => r.ok).length;
  const refused = results.filter((r) => !r.ok && r.problem.type === 'insufficient_funds').length;
  const left = BigInt((await chain.balances([cast.buyer.address]))[cast.buyer.address]!.amount);
  const escrowed = deals.reduce((a, d) => a + (chain.ledger()[`escrow:${d.id}`] ?? 0n), 0n);
  const overdrafts = Object.values(chain.ledger()).filter((v) => v < 0n).length;
  console.log(`concurrent: ${n} holds on one balance that covers ${affordable}: ${ok} funded, ${refused} refused insufficient_funds, buyer left ${left}, overdrafts ${overdrafts}`);
  if (ok !== affordable || refused !== n - affordable || left !== 0n || escrowed !== balance || overdrafts !== 0) throw new Error('load: concurrent holds overdrew or misallocated');
}

await holds(1000);
await concurrent(100, 37);
