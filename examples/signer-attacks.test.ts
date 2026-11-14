// The signer, buying half (T-434), against the public demo's own world on SimChain, served in this process on two
// origins: the attacks that need a real settlement layer to refuse (A1, A2, A11), the stop with payments collected
// before it (A8), a float the faucet filled (A9), and the operator-fee message where an operator charges one (A14).
// The agent is this test process: it holds each deal's buyer key (the buyer signer's key store) and full control of
// itself. The signer runs as its own process and reads the deals' state from the operators, as its rules name them.
// The test plays the signer's administrator only to top up the float and to set the flag, as Rafa does by hand.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { loadKeys, makeKeys } from './buyer-signer.ts';
import { cast, cleanup, mandateFor, startSigner, type Cast, type Running } from './signer-test-kit.ts';
import { balance, post, rulesForWorld, serveSeller, storeIn, topUp, upToPayment, type World } from './signer-world-kit.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { verifyPrepared } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

const dirs: string[] = [];
const store = storeIn(dirs);
const upTo = (w: World, float: string) => upToPayment(w, float, store);

async function openWorld(fee: { bps: string; min: string }): Promise<World & { demo: TwoOrigins }> {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: fee.bps, OPERATOR_FEE_MIN: fee.min }, faucetPerClient: 1000 });
  const demo = await serveTwoOrigins(world, { tickMs: 100 });
  const found = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
  return { demo, urls: demo.urls, found, token: 'tUSD', seller: await serveSeller(demo.urls, found, 'tUSD') };
}

describe('the signer against the demo world, operator fee 0 (the first pilots)', () => {
  let w: World & { demo: TwoOrigins }, c: Cast, s: Running;
  beforeAll(async () => {
    w = await openWorld({ bps: '0', min: '0' });
    c = cast();
    s = await startSigner(c, await rulesForWorld(w, c, store), await mandateFor(c));
    dirs.push(s.dir);
    expect((await topUp(w, c.float, '30000000')).status).toBe(200);
  });
  afterAll(async () => {
    await s?.kill();
    await w?.seller.close();
    await w?.demo.close();
    cleanup(dirs);
  });

  it('the control: a deal paid through the signer funds from the float, and the release pays the listed payout address and the fee only (A11, first part)', async () => {
    const floatBefore = await balance(w, c.float), payoutBefore = await balance(w, w.seller.payout);
    const { buyer, id, terms, file } = await upTo(w, c.float);
    const r = await s.post({ kind: 'payment', terms, file });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const paid = await buyer.agreeAndFund(id, { funding: r.body.funding });
    expect(paid.total.amount).toBe('10000000');
    expect(await balance(w, c.float)).toBe(floatBefore - 10_000_000n);
    // The agent opens the work and accepts it early, with the one key it holds for this hold: the money goes where the terms say.
    const done = await buyer.openDelivery(id, { onReport: () => {} });
    expect(done.outcome).toBe('Released');
    expect(await balance(w, w.seller.payout)).toBe(payoutBefore + 9_000_000n);
    expect(await balance(w, buyer.address)).toBe(1n);
    expect(await balance(w, c.float)).toBe(floatBefore - 10_000_000n);
  }, 60_000);

  it('A1: no key on the agent\'s side can sign for the float: none is there, and a funding the deal key signs is refused by the tool and by the settlement layer', async () => {
    const { buyer, id, terms, file, dir } = await upTo(w, c.float);
    // Every private key the agent's machine holds for this deal (the key store), and the process environment.
    const keys = readdirSync(dir).filter((n) => n.endsWith('.json')).flatMap((n) => JSON.stringify(JSON.parse(readFileSync(join(dir, n), 'utf8'))).match(/0x[0-9a-f]{64}/g) ?? []);
    const held = [...new Set(keys)].filter((k) => { try { return privateKeyToAccount(k as Hex).address.toLowerCase() !== ''; } catch { return false; } });
    expect(held.map((k) => privateKeyToAccount(k as Hex).address.toLowerCase())).not.toContain(c.float);
    for (const v of Object.values(process.env)) expect(v ?? '').not.toContain(c.keys.float.slice(2));
    const saved = JSON.parse(readFileSync(join(dir, `${buyer.address}.json`), 'utf8'));
    const own = privateKeyToAccount(saved.privateKey as Hex);
    const forged = await own.signTypedData(file);
    await expect(buyer.agreeAndFund(id, { funding: forged })).rejects.toThrow(/recovers to .* not to /);
    // Past the tool: the agent's own Agent, the prepared message, the forged signature in the funding slot, straight to the operator.
    const agent = new Agent(w.urls, saved.privateKey, new Uint8Array(Buffer.from(saved.encryptionSecretKey, 'base64url')));
    const { prepared, intent } = await agent.prepareAgreeAndFund(terms, 10_000_000n, { paymentAddress: c.float });
    const v = verifyPrepared(prepared, intent, agent.address, agent.domain, await agent.settlementNow());
    for (const slot of v.slots) {
      const sig = slot.signer === agent.address ? await agent.account.signTypedData(slot.typed) : forged;
      const keys2 = slot.slot.split('.');
      keys2.slice(0, -1).reduce((o: J, k: string) => o[k], v.body)[keys2.at(-1)!] = sig;
    }
    const raw = await post(w.urls[0]!, v.path, v.body);
    console.log(`raw ${v.path}: ${raw.status} ${raw.body?.type}: ${String(raw.body?.detail).slice(0, 160)}`);
    expect(raw.status, JSON.stringify(raw.body)).toBeGreaterThanOrEqual(400);
    expect((await agent.call('GET', `/v1/commitments/${id}`)).escrowState).not.toBe('Held');
    void terms;
  });

  it('A2: a payment the signer signed for one deal does not fund another, by the tool or straight at the operator', async () => {
    const one = await upTo(w, c.float), two = await upTo(w, c.float);
    const r = await s.post({ kind: 'payment', terms: one.terms, file: one.file });
    expect(r.status).toBe(200);
    await expect(two.buyer.agreeAndFund(two.id, { funding: r.body.funding })).rejects.toThrow(/recovers to/);
    const saved = JSON.parse(readFileSync(join(two.dir, `${two.buyer.address}.json`), 'utf8'));
    const agent = new Agent(w.urls, saved.privateKey, new Uint8Array(Buffer.from(saved.encryptionSecretKey, 'base64url')));
    const { prepared, intent } = await agent.prepareAgreeAndFund(two.terms, 10_000_000n, { paymentAddress: c.float });
    const v = verifyPrepared(prepared, intent, agent.address, agent.domain, await agent.settlementNow());
    for (const slot of v.slots) {
      const sig = slot.signer === agent.address ? await agent.account.signTypedData(slot.typed) : r.body.funding;
      const ks = slot.slot.split('.');
      ks.slice(0, -1).reduce((o: J, k: string) => o[k], v.body)[ks.at(-1)!] = sig;
    }
    const raw = await post(w.urls[0]!, v.path, v.body);
    console.log(`raw ${v.path}: ${raw.status} ${raw.body?.type}: ${String(raw.body?.detail).slice(0, 160)}`);
    expect(raw.status, JSON.stringify(raw.body)).toBeGreaterThanOrEqual(400);
    expect((await agent.call('GET', `/v1/commitments/${two.id}`)).escrowState).not.toBe('Held');
    // The first deal's payment still funds its own deal: the control.
    await expect(one.buyer.agreeAndFund(one.id, { funding: r.body.funding })).resolves.toMatchObject({ total: { amount: '10000000' } });
  }, 60_000);

  it('A9: a float the faucet fills moves no limit: above 10.00 a deal is still refused', async () => {
    expect((await topUp(w, c.float, '100000000')).status).toBe(200);
    w.seller.set({ price: { token: 'tUSD', amount: '9000001' } });
    try {
      const { terms, file } = await upTo(w, c.float);
      const r = await s.post({ kind: 'payment', terms, file });
      expect(r.status).toBe(403);
      expect(r.body.rule).toBe('B3');
      expect((await s.get('/v1/status')).body).toMatchObject({ dealLimit: '10000000', dayLimit: '60000000' });
    } finally {
      w.seller.set({});
    }
  });

  it('A8: after the stop nothing new is signed; a payment collected before it still funds, inside its offer window, and it was counted as open when signed', async () => {
    const collected = await upTo(w, c.float);
    const r = await s.post({ kind: 'payment', terms: collected.terms, file: collected.file });
    expect(r.status).toBe(200);
    const openWhenSigned = r.body.ledger.dealsOpen;
    expect(openWhenSigned).toBeGreaterThanOrEqual(1);
    spawnSync(process.execPath, [here('./signer.ts'), 'stop', '--flag', s.flagPath]);
    const stoppedAt = Date.now();
    const next = await upTo(w, c.float);
    const refused = await s.post({ kind: 'payment', terms: next.terms, file: next.file });
    expect(refused.body.rule).toBe('X1');
    await expect(collected.buyer.agreeAndFund(collected.id, { funding: r.body.funding })).resolves.toMatchObject({ total: { amount: '10000000' } });
    const fundedAfterMs = Date.now() - stoppedAt;
    // The bound the design states: no later than the offer's own expiry (300 s after its createdAt).
    expect(Date.parse(collected.terms.timing.offerExpiresAt) - stoppedAt).toBeLessThanOrEqual(300_000);
    expect(fundedAfterMs).toBeLessThan(Date.parse(collected.terms.timing.offerExpiresAt) - stoppedAt + 1000);
    spawnSync(process.execPath, [here('./signer.ts'), 'run', '--flag', s.flagPath]);
  }, 60_000);
});

describe('the signer where an operator charges a fee (A14)', () => {
  it('the operator-fee message is refused, so no deal funds from the float through an operator that charges one', async () => {
    const w = await openWorld({ bps: '1', min: '10000' });
    const c = cast();
    const s = await startSigner(c, await rulesForWorld(w, c, store), await mandateFor(c));
    dirs.push(s.dir);
    try {
      expect((await topUp(w, c.float, '30000000')).status).toBe(200);
      const dir = store();
      const buyer = await makeKeys(dir, { operators: w.urls, paymentAddress: c.float, log: () => {} });
      const q = await buyer.quote(w.seller.quoteUrl, 'rows');
      await buyer.checkOffer(q.commitmentId, await buyer.readOffer(q.commitmentId));
      await post(w.urls[0]!, '/v1/faucet', { address: buyer.address, amount: '1' });
      const files = await buyer.fundingFiles(q.commitmentId);
      expect(files.map((f) => f.name)).toEqual(['funding', 'operator-fee']);
      const terms = JSON.parse(readFileSync(join(dir, `${buyer.address}.terms.json`), 'utf8'));
      const fee = JSON.parse(readFileSync(files[1]!.path, 'utf8'));
      const asFee = await s.post({ kind: 'payment', terms, file: fee });
      expect(asFee.body.rule).toBe('B14');
      // The agent names its own address as the fee's recipient: refused all the same.
      const mine = { ...fee, message: { ...fee.message, to: buyer.address } };
      expect((await s.post({ kind: 'payment', terms, file: mine })).body.rule).toBe('B14');
      const funding = await s.post({ kind: 'payment', terms, file: JSON.parse(readFileSync(files[0]!.path, 'utf8')) });
      expect(funding.status).toBe(200);
      const again = await loadKeys(dir, q.commitmentId, { operators: w.urls, log: () => {} });
      await expect(again.agreeAndFund(q.commitmentId, { funding: funding.body.funding })).rejects.toThrow(/operator-fee signature is missing/);
      expect(await balance(w, c.float)).toBe(30_000_000n);
    } finally {
      await s.kill();
      await w.seller.close();
      await w.demo.close();
    }
  }, 60_000);
});
