// The signer, buying half (T-434), on a local chain: the phase-one contracts and TestUSDC deployed to anvil, the demo
// world relaying to them (examples/e2e-world.ts, as the round's tests run it). The signer's rules pin that deployment
// ("network": "local"), so it signs the ERC-3009 ReceiveWithAuthorization the escrow's collector redeems. Rung 1 shown by
// the token itself: a signature it made for one deal does not move money for another deal, a higher amount or another
// payout address, and a signature by the agent's deal key does not move the float's money (A1, A2). Skipped, saying
// why, without anvil and contracts/out; CI's anvil job lists its own files, so CI skips this one (the Handoff says so).
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_SKIP, anvilReady, anvilWorld, type AnvilWorld } from './e2e-world.ts';
import { cast, cleanup, mandateFor, startSigner, type Cast, type Running } from './signer-test-kit.ts';
import { balance, rulesForWorld, serveSeller, storeIn, topUp, upToPayment, type World } from './signer-world-kit.ts';
import { fundingNonceOf, commitmentIdOf, pinOf } from './verify.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const TOKEN_ABI = parseAbi(['function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)']);
const dirs: string[] = [];
const store = storeIn(dirs);

describe.skipIf(!anvilReady)(`the signer on anvil, the phase-one contracts and TestUSDC${ANVIL_SKIP}`, () => {
  const lc = (x: string) => x.toLowerCase();
  let a: AnvilWorld, w: World, c: Cast, s: Running;
  beforeAll(async () => {
    a = await anvilWorld({ OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0' });
    process.env['HOLDBACK_DEPLOYMENT'] = JSON.stringify(a.deployment);
    const found = (await (await fetch(`${a.urls[0]}/.well-known/holdback.json`)).json()) as J;
    const token = lc(a.deployment.token.address);
    const pin = pinOf(a.deployment);
    w = { urls: a.urls, found, token, seller: await serveSeller(a.urls, found, token, { domain: pin.domain, chain: pin.chain }) };
    c = cast();
    const d = a.deployment;
    const chain = { network: 'local', deployment: { chainId: 31337, rules: lc(d.rules), escrow: lc(d.escrow), erc3009Collector: lc(d.erc3009Collector), expiryMarginSec: d.expiryMarginSec, token: { address: token, name: d.token.name, version: d.token.version, symbol: d.token.symbol, decimals: d.token.decimals } } };
    s = await startSigner(c, await rulesForWorld(w, c, store, chain), await mandateFor(c, { domain: pin.domain, token }));
    dirs.push(s.dir);
    expect((await topUp(w, c.float, '30000000')).status).toBe(200);
    for (let i = 0; i < 60 && (await balance(w, c.float)) < 30_000_000n; i++) await new Promise((r) => setTimeout(r, 500));
  }, 180_000);
  afterAll(async () => {
    delete process.env['HOLDBACK_DEPLOYMENT'];
    await s?.kill();
    await w?.seller.close();
    await a?.close();
    cleanup(dirs);
  });

  /** Asks the token, as its collector would, whether it takes this authorization now: eth_call, nothing is sent. */
  const tokenTakes = async (m: { from: string; value: bigint; validBefore: bigint; nonce: Hex }, signature: Hex): Promise<string> => {
    const data = encodeFunctionData({ abi: TOKEN_ABI, functionName: 'receiveWithAuthorization', args: [m.from as Hex, a.deployment.erc3009Collector as Hex, m.value, 0n, m.validBefore, m.nonce, signature] });
    const res = (await (await fetch(a.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ from: a.deployment.erc3009Collector, to: a.deployment.token.address, data }, 'latest'] }) })).json()) as J;
    return res.error ? `refused: ${String(res.error.message ?? '').slice(0, 120)}` : 'taken';
  };

  it('A1 and A2 on the token: the signer\'s signature moves only its own deal\'s total to the collector; another deal, a higher amount, the agent\'s own key: refused; then the deal funds and releases', async () => {
    const one = await upToPayment(w, c.float, store), two = await upToPayment(w, c.float, store);
    expect(one.file.primaryType).toBe('ReceiveWithAuthorization');
    const r = await s.post({ kind: 'payment', terms: one.terms, file: one.file });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const m = one.file.message, validBefore = BigInt(m.validBefore), value = BigInt(m.value);
    // The control: the token takes it for this deal, at this amount.
    expect(await tokenTakes({ from: c.float, value, validBefore, nonce: m.nonce }, r.body.funding)).toBe('taken');
    // Another deal's nonce (it commits to that deal's ID, amount and payout address), a higher amount, and the agent's own deal key.
    const pin = pinOf(a.deployment);
    expect(fundingNonceOf(two.terms, commitmentIdOf(two.terms), pin.chain!)).toBe(two.file.message.nonce);
    expect(await tokenTakes({ from: c.float, value, validBefore, nonce: two.file.message.nonce }, r.body.funding)).toMatch(/^refused: .*invalid signature/);
    expect(await tokenTakes({ from: c.float, value: value + 1n, validBefore, nonce: m.nonce }, r.body.funding)).toMatch(/^refused: .*invalid signature/);
    const deal = privateKeyToAccount(JSON.parse(readFileSync(join(one.dir, `${one.buyer.address}.json`), 'utf8')).privateKey);
    expect(await tokenTakes({ from: c.float, value, validBefore, nonce: m.nonce }, await deal.signTypedData(one.file))).toMatch(/^refused: .*invalid signature/);
    // The deal funds from the float through the operators, and releases to the listed payout address.
    const before = await balance(w, c.float);
    await expect(one.buyer.agreeAndFund(one.id, { funding: r.body.funding })).resolves.toMatchObject({ total: { amount: '10000000' } });
    expect(await balance(w, c.float)).toBe(before - 10_000_000n);
    // Used once, the authorization is spent: the same signature again is refused by the token.
    expect(await tokenTakes({ from: c.float, value, validBefore, nonce: m.nonce }, r.body.funding)).toMatch(/^refused: .*authorization is used/);
    const done = await one.buyer.openDelivery(one.id, { onReport: () => {} });
    expect(done.outcome).toBe('Released');
    expect(await balance(w, w.seller.payout)).toBe(9_000_000n);
  }, 180_000);
});
