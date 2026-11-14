// The signer, buying half (T-439): the attack tests run as the buying agent. The agent here has its own keys (each
// deal's buyer key) and full control of this test process; the signer runs as its own process, with the payment key
// and the standing key only in that process's environment, its rules, flag and ledger in its own folder, and its own
// read endpoint (a stand-in that plays the chain's part, set by the test as the signer's administrator would). Every
// attack has a control that is signed inside the limits, so a refusal for the wrong reason does not pass. Limits come
// from examples/signer-rules.v1.json (constraints version 1): 10.00 tUSDC a deal, 60.00 a day, 3 open deals, 30.00 open.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormats } from 'ajv-formats';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRevocation, fileOf, verifyDocument, verifyFile } from './mandate.ts';
import { loadRules, RULES_SCHEMA, schemaError, Signer } from './signer.ts';
import { ACCEPTANCE, cast, cleanup, fresh, fundingFileFor, iso, mandateFor, payment, rulesFor, startSigner, stateServer, termsFor, V1, type Cast, type Running } from './signer-test-kit.ts';
import { commitmentIdOf, SIMCHAIN_DOMAIN, typedDataFile, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const dirs: string[] = [];
let reads: Awaited<ReturnType<typeof stateServer>>;
beforeAll(async () => void (reads = await stateServer()));
afterAll(async () => {
  await reads.close();
  cleanup(dirs);
});

/** A fresh cast, its rules and mandate, and the signer running as its own process. */
async function signer(o: { rules?: (c: Cast) => J; mandate?: (c: Cast) => Promise<J>; flag?: string } = {}): Promise<{ c: Cast; s: Running }> {
  const c = cast();
  const s = await startSigner(c, o.rules ? o.rules(c) : rulesFor(c, { reads: [reads.url] }), await (o.mandate ?? ((x) => mandateFor(x)))(c), o.flag ? { flag: o.flag } : {});
  dirs.push(s.dir);
  return { c, s };
}
const refused = (r: { status: number; body: J }, rule: string, detail?: RegExp) => {
  expect(r.status, JSON.stringify(r.body)).toBe(403);
  expect(r.body.rule).toBe(rule);
  if (detail) expect(r.body.detail).toMatch(detail);
};
const signed = (r: { status: number; body: J }) => {
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
/** Signs a deal and marks it ended at the stand-in read, so it no longer counts as open. */
const settle = (id: string) => reads.set(id, 'Released');

describe('the control: a deal inside every limit', () => {
  it('is signed: the signature is the float\'s over the funding the terms give, a delegation to the deal key fits the mandate, and the ledger, the log and the status count it', async () => {
    const { c, s } = await signer();
    const terms = termsFor(c), file = fundingFileFor(terms);
    const out = signed(await s.post(payment(terms, file)));
    expect(out.commitmentId).toBe(commitmentIdOf(terms));
    const { EIP712Domain: _d, ...types } = file.types; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect((await recoverTypedDataAddress({ ...file, types, signature: out.funding })).toLowerCase()).toBe(c.float);
    const m = JSON.parse(readFileSync(join(s.dir, 'mandate.json'), 'utf8'));
    await expect(verifyDocument('Delegation', out.delegation, SIMCHAIN_DOMAIN, { mandate: m })).resolves.toMatchObject({ signer: c.standing, document: { dealKey: terms.buyer, scope: { maxPerCommitment: { amount: '9000000' } }, expiresAt: terms.timing.offerExpiresAt } });
    expect(out.ledger).toMatchObject({ signedToday: '10000000', dealsToday: 1, dealsOpen: 1, openHoldsTotal: '10000000' });
    const log = readFileSync(join(s.statePath, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log.at(-1)).toMatchObject({ decision: 'signed', commitmentId: out.commitmentId, total: '10000000', seller: c.seller, payoutAddress: c.payout });
    const status = JSON.parse(readFileSync(join(s.statePath, 'status.json'), 'utf8'));
    expect(status).toMatchObject({ agent: 'buying', state: 'running', floatAddress: c.float, constraintsVersion: '1', dayLimit: '60000000', dealLimit: '10000000', signedToday: '10000000', principal: c.principal.address.toLowerCase() });
    // The status, the log and the ledger hold no key: no 32-byte hex value but hashes the test can name.
    const keys = Object.values(c.keys).map((k) => k.slice(2));
    for (const f of ['status.json', 'decisions.jsonl', 'ledger.json']) for (const k of keys) expect(readFileSync(join(s.statePath, f), 'utf8')).not.toContain(k);
    expect(JSON.stringify(out)).not.toContain(keys[1]!);
    await s.kill();
  });
});

describe('A3: one base unit above the most per deal (B3), while the float holds enough', () => {
  it('is refused, naming the limit; exactly the limit is signed', async () => {
    const { c, s } = await signer();
    refused(await s.post(payment(termsFor(c, { price: '9000001' }))), 'B3', /10000001 base units, above the 10000000 a deal/);
    signed(await s.post(payment(termsFor(c, { price: '9000000' }))));
    await s.kill();
  });
});

describe('A4: terms for one deal and a payment for another; another chain or rules contract; a malformed request', () => {
  it('each is refused; the matching pair is signed', async () => {
    const { c, s } = await signer();
    const a = termsFor(c), b = termsFor(c);
    refused(await s.post(payment(a, fundingFileFor(b))), 'B2', /deal 0x[0-9a-f]{64}, not/);
    refused(await s.post(payment(a, fundingFileFor(a, { ...SIMCHAIN_DOMAIN, chainId: 1 }))), 'B2');
    refused(await s.post(payment(a, fundingFileFor(a, { ...SIMCHAIN_DOMAIN, verifyingContract: `0x${'12'.repeat(20)}` }))), 'B2');
    refused(await s.post(payment(a, fundingFileFor(a, SIMCHAIN_DOMAIN, { value: '20000000' }))), 'B2', /pays 20000000 base units, not the 10000000/);
    refused(await s.post(payment(a, fundingFileFor(a, SIMCHAIN_DOMAIN, { from: fresh() }))), 'B2', /not the payment address/);
    refused(await s.post('not json'), 'request');
    refused(await s.post('[]'), 'request', /not a JSON object/);
    refused(await s.post({ ...payment(a), rules: { maxPerDeal: '1' } }), 'request', /exactly kind, terms and file/);
    refused(await s.post({ kind: 'payment', terms: a }), 'request');
    refused(await s.post(payment({ ...a, privateTerms: {} })), 'B6', /fields public terms do not: privateTerms/);
    refused(await s.post(payment({ ...a, id: commitmentIdOf(b) })), 'request', /they hash to/);
    refused(await s.post(payment(termsFor(c, { token: 'tUSDX' }))), 'B12');
    signed(await s.post(payment(a)));
    await s.kill();
  });
});

describe('A5: past the day and the open holds (B4, B9)', () => {
  it('one deal more than 60.00 a day is refused, also after the signer restarts; the agent has no state that resets it', async () => {
    const { c, s } = await signer();
    for (let i = 0; i < 6; i++) settle(signed(await s.post(payment(termsFor(c)))).commitmentId);
    refused(await s.post(payment(termsFor(c))), 'B4', /60000000 base units are signed today .* above the 60000000 a day/);
    const again = await s.restart();
    refused(await again.post(payment(termsFor(c))), 'B4');
    await again.kill();
  });

  it('a fourth open deal is refused; so is a signed payment never funded, until its funding deadline passes; two requests at once count one after the other', async () => {
    const { c, s } = await signer();
    const ids = [];
    for (let i = 0; i < 2; i++) ids.push(signed(await s.post(payment(termsFor(c)))).commitmentId);
    for (const id of ids) reads.set(id, 'AcceptedByAdjudicator'); // collected, not funded: still open before fundBy
    const both = await Promise.all([s.post(payment(termsFor(c))), s.post(payment(termsFor(c)))]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 403]);
    refused(both.find((r) => r.status === 403)!, 'B9', /3 deals are open, and the rules allow 3 at once/);
    refused(await s.post(payment(termsFor(c))), 'B9');
    settle(ids[0]); // one ends at the chain's read
    signed(await s.post(payment(termsFor(c))));
    await s.kill();
  });

  it('a deal counts as open while any read endpoint does not answer (fail closed)', async () => {
    const { c, s } = await signer({ rules: (x) => rulesFor(x, { reads: [reads.url, 'http://127.0.0.1:9'] }) });
    for (let i = 0; i < 3; i++) settle(signed(await s.post(payment(termsFor(c)))).commitmentId);
    refused(await s.post(payment(termsFor(c))), 'B9');
    await s.kill();
  });

  it('a payment asked for again for the same deal is counted once', async () => {
    const { c, s } = await signer();
    const t = termsFor(c);
    const first = signed(await s.post(payment(t)));
    const second = signed(await s.post(payment(t, fundingFileFor(t))));
    expect(second.ledger).toEqual(first.ledger);
    await s.kill();
  });
});

describe('A6: sellers, payout addresses and reviewers not on the list (B5, B7)', () => {
  it('each is refused, naming the field', async () => {
    const { c, s } = await signer();
    refused(await s.post(payment(termsFor(c, { seller: fresh() }))), 'B5', /is not on the list/);
    refused(await s.post(payment(termsFor(c, { payout: fresh() }))), 'B5', /not the listed seller's/);
    refused(await s.post(payment(termsFor(c, { payer: fresh() }))), 'B5', /not the float/);
    for (const k of ['adjudicator', 'fallbackAdjudicator', 'appealAdjudicator']) refused(await s.post(payment(termsFor(c, { adjudication: { [k]: fresh() } }))), 'B7', new RegExp(`adjudication.${k}`));
    for (const k of ['policyHash', 'registryHash']) refused(await s.post(payment(termsFor(c, { adjudication: { [k]: `0x${'99'.repeat(32)}` } }))), 'B7', new RegExp(`adjudication.${k}`));
    refused(await s.post(payment(termsFor(c, { adjudication: { policyId: 'other' } }))), 'B7');
    refused(await s.post(payment(termsFor(c, { adjudication: { fee: { token: 'tUSD', amount: '1000001' } } }))), 'B7', /fee is 1000001/);
    refused(await s.post(payment(termsFor(c, { adjudication: { fee: { token: 'tUSD', amount: '0' } }, price: '10000000' }))), 'B7');
    signed(await s.post(payment(termsFor(c))));
    await s.kill();
  });
});

describe('A7: changed terms (B6, B8)', () => {
  it('a check removed, a rubric added, another product, a longer window, dates shifted against the signer\'s clock: each refused', async () => {
    const { c, s } = await signer();
    refused(await s.post(payment(termsFor(c, { acceptance: { ...ACCEPTANCE, deterministicChecks: ACCEPTANCE.deterministicChecks.slice(1) } }))), 'B6', /a check was changed, added or removed/);
    refused(await s.post(payment(termsFor(c, { acceptance: { ...ACCEPTANCE, rubric: { criteria: [{ id: 'q', description: 'good', weight: 1 }], passThreshold: 1 } } }))), 'B6', /has a rubric/);
    refused(await s.post(payment(termsFor(c, { deliverable: { kind: 'dataset', description: 'something else', format: 'text/csv' } }))), 'B6', /not a product this seller is listed for/);
    // One second for every date these cases send: termsFor's createdAt and the shifted deadline (T-442).
    const now = Date.now(), base = Math.floor(now / 1000) * 1000;
    refused(await s.post(payment(termsFor(c, { createdAt: base, timing: { offerExpiresAt: iso(base + 301_000) } }))), 'B8', /301 s after the one before, above the 300 s/);
    refused(await s.post(payment(termsFor(c, { createdAt: base, timing: { fundBy: iso(base + 601_000) } }))), 'B8', /above the 600 s/);
    refused(await s.post(payment(termsFor(c, { createdAt: now + 120_000 }))), 'B8', /ahead of the signer's clock/);
    refused(await s.post(payment(termsFor(c, { createdAt: now - 301_000 }))), 'B8', /the offer expired at/);
    refused(await s.post(payment(termsFor(c, { timing: { appealDecideSec: 3600 } }))), 'B6', /appealDecideSec/);
    refused(await s.post(payment(termsFor(c, { timing: { maxSubmissions: 2 } }))), 'B6');
    refused(await s.post(payment(termsFor(c, { extra: { clubId: 'other-club' } }))), 'B6');
    signed(await s.post(payment(termsFor(c))));
    await s.kill();
  });
});

describe('A8: after the stop (X1)', () => {
  it('nothing new is signed, nor a payment asked for again; the status says stopped; clearing the flag resumes', async () => {
    const { c, s } = await signer();
    const t = termsFor(c);
    signed(await s.post(payment(t)));
    spawnSync(process.execPath, [here('./signer.ts'), 'stop', '--flag', s.flagPath]); // the administrator, on the signer's machine
    refused(await s.post(payment(termsFor(c))), 'X1', /stopped/);
    refused(await s.post(payment(t)), 'X1');
    expect((await s.get('/v1/status')).body).toMatchObject({ state: 'stopped', stoppedSince: expect.stringMatching(/^\d{4}-/) });
    spawnSync(process.execPath, [here('./signer.ts'), 'run', '--flag', s.flagPath]);
    signed(await s.post(payment(termsFor(c))));
    await s.kill();
  });
});

describe('A13: reach the signer\'s flag, rules and ledger from the agent\'s side, or make the flag unreadable', () => {
  it('the HTTP surface takes no request that writes the flag, the rules or the ledger', async () => {
    const { c, s } = await signer();
    for (const [method, path] of [['PUT', '/v1/flag'], ['POST', '/v1/rules'], ['POST', '/v1/stop'], ['GET', '/v1/ledger'], ['GET', '/v1/sign'], ['POST', '/v1/status'], ['POST', '/v1/sign/../rules'], ['DELETE', '/v1/sign']] as const) {
      const r = await fetch(`${s.url}${path}`, { method, ...(method === 'GET' ? {} : { body: JSON.stringify({ stop: false, rules: { maxPerDeal: '999999999' } }) }) });
      expect([404, 400], `${method} ${path}`).toContain(r.status);
    }
    refused(await s.post({ kind: 'payment', terms: termsFor(c), file: fundingFileFor(termsFor(c)), stop: false }), 'request');
    const big = await fetch(`${s.url}/v1/sign`, { method: 'POST', body: 'x'.repeat(300 * 1024) }).catch(() => null);
    expect(big === null || big.status === 413).toBe(true);
    expect(JSON.parse(readFileSync(s.rulesPath, 'utf8')).buying.maxPerDeal).toBe('10000000');
    await s.kill();
  });

  it('a missing, unreadable, empty or other flag refuses everything: unreadable means stopped', async () => {
    const { c, s } = await signer();
    signed(await s.post(payment(termsFor(c))));
    rmSync(s.flagPath);
    refused(await s.post(payment(termsFor(c))), 'X1', /cannot be read/);
    writeFileSync(s.flagPath, 'run\n');
    chmodSync(s.flagPath, 0o000);
    const unreadable = spawnSync('cat', [s.flagPath]).status !== 0; // root reads any file: then this part says so and skips
    if (unreadable) refused(await s.post(payment(termsFor(c))), 'X1', /cannot be read/);
    chmodSync(s.flagPath, 0o600);
    for (const text of ['', 'stop', 'running', 'run run', '{"run":true}']) {
      writeFileSync(s.flagPath, text);
      refused(await s.post(payment(termsFor(c))), 'X1');
    }
    rmSync(s.flagPath);
    mkdirSync(s.flagPath);
    refused(await s.post(payment(termsFor(c))), 'X1');
    await s.kill();
  });

  it('a rules file changed while the signer runs refuses everything until a restart', async () => {
    const { c, s } = await signer();
    const rules = JSON.parse(readFileSync(s.rulesPath, 'utf8'));
    writeFileSync(s.rulesPath, JSON.stringify({ ...rules, buying: { ...rules.buying, maxPerDeal: '999999999' } }));
    refused(await s.post(payment(termsFor(c, { price: '9000000' }))), 'X4', /changed since the signer started/);
    await s.kill();
  });

  it('the signer does not start with a key that is not the rules\' address, an unreadable ledger, or a rules file that fails the schema', async () => {
    const c = cast();
    const m = await mandateFor(c);
    const wrong = { ...c, keys: { ...c.keys, float: generatePrivateKey() } };
    await expect(startSigner(wrong, rulesFor(c, { reads: [reads.url] }), m)).rejects.toThrow(/is not the rules' floatAddress/);
    const s = await startSigner(c, rulesFor(c, { reads: [reads.url] }), m);
    dirs.push(s.dir);
    await s.kill();
    writeFileSync(join(s.statePath, 'ledger.json'), '{not json');
    await expect(s.restart()).rejects.toThrow(/ledger .* is unreadable: refusing to start/);
    const bad = { ...rulesFor(c, { reads: [reads.url] }), chain: { network: 'local', deployment: { chainId: 1, rules: fresh(), escrow: fresh(), erc3009Collector: fresh(), expiryMarginSec: 0, token: { address: fresh(), name: 'USD Coin', version: '2', symbol: 'USDC', decimals: 6 } } } };
    await expect(startSigner(c, bad, m)).rejects.toThrow(/does not pass examples\/signer-rules.schema.json: chain matches 0 of the allowed forms/);
  });

  it('the signer\'s keys reach it through its environment only, and it reads no other secret (A1, the signer\'s side)', () => {
    const src = readFileSync(here('./signer.ts'), 'utf8');
    expect([...new Set(src.match(/process\.env\['[A-Z_]+'\]/g))].sort()).toEqual(["process.env['CROW_SIGNER_BUYING_KEY']", "process.env['CROW_SIGNER_FLOAT_KEY']"]);
    expect(src).toContain("delete process.env['CROW_SIGNER_FLOAT_KEY']");
  });
});

describe('A14: any transfer but a deal\'s funding (B14)', () => {
  it('the operator-fee message, naming the agent\'s own address as recipient, is refused; so is any other kind or typed message', async () => {
    const { c, s } = await signer();
    const t = termsFor(c), me = fresh(), id = commitmentIdOf(t);
    const fee = typedDataFile(typedOf('TransferAuthorization', { scheme: 'erc3009', purpose: 'operator_fee', commitmentId: id, from: c.float, to: me, value: '5000000', token: 'tUSD', validAfter: t.createdAt, validBefore: t.timing.fundBy, nonce: `0x${'ab'.repeat(32)}`, expiresAt: t.timing.fundBy }, SIMCHAIN_DOMAIN));
    refused(await s.post({ kind: 'payment', terms: t, file: fee }), 'B14', /no transfer but a deal's funding/);
    refused(await s.post({ kind: 'operator-fee', terms: t, file: fee }), 'B14');
    for (const kind of ['transfer', 'sweep', 'message', 'delegation', 'offer', 'delivery']) refused(await s.post({ kind, terms: t, file: fee }), 'B14');
    const accept = typedDataFile(typedOf('EarlyAccept', { commitmentId: id, buyer: c.float, attempt: 1, deliveryHash: `0x${'cd'.repeat(32)}`, nonce: `0x${'ab'.repeat(32)}`, expiresAt: t.timing.fundBy }, SIMCHAIN_DOMAIN));
    refused(await s.post({ kind: 'payment', terms: t, file: accept }), 'B2');
    const mandate = fileOf('AgentRevocation', buildRevocation({ principal: fresh(), agent: c.standing }), SIMCHAIN_DOMAIN);
    refused(await s.post({ kind: 'payment', terms: t, file: mandate }), 'B2');
    signed(await s.post(payment(t)));
    await s.kill();
  });
});

describe('the mandate at the signer', () => {
  it('an expired mandate refuses; so does a revocation by its principal; a revocation by another key does not count', async () => {
    const { c, s } = await signer();
    // The administrator renews the mandate file in place every 7 days; one that has ended refuses, and so does a start with it.
    writeFileSync(join(s.dir, 'mandate.json'), JSON.stringify(await mandateFor(c, { days: 1, now: Date.now() - 86_400_000 - 1000 })));
    refused(await s.post(payment(termsFor(c))), 'mandate', /ended at/);
    await s.kill();
    await expect(s.restart()).rejects.toThrow(/the mandate does not hold: refusing: the Mandate ended at/);
    writeFileSync(join(s.dir, 'mandate.json'), JSON.stringify(await mandateFor(c)));
    const live = await s.restart();
    const stranger = privateKeyToAccount(generatePrivateKey());
    const other = buildRevocation({ principal: stranger.address, agent: c.standing });
    writeFileSync(join(live.revocationsPath, 'other.json'), JSON.stringify({ ...other, signature: await stranger.signTypedData(fileOf('AgentRevocation', other, SIMCHAIN_DOMAIN)) }));
    signed(await live.post(payment(termsFor(c))));
    const real = buildRevocation({ principal: c.principal.address, agent: c.standing });
    writeFileSync(join(live.revocationsPath, 'real.json'), JSON.stringify({ ...real, signature: await c.principal.signTypedData(fileOf('AgentRevocation', real, SIMCHAIN_DOMAIN)) }));
    refused(await live.post(payment(termsFor(c))), 'mandate', /revoked the mandate \(real.json\)/);
    rmSync(join(live.revocationsPath, 'real.json'));
    // A revocation that names this mandate but is signed by another key is a doubt: refused, never read as "not revoked".
    writeFileSync(join(live.revocationsPath, 'forged.json'), JSON.stringify({ ...real, signature: await stranger.signTypedData(fileOf('AgentRevocation', real, SIMCHAIN_DOMAIN)) }));
    refused(await live.post(payment(termsFor(c))), 'mandate', /names this mandate and does not verify/);
    rmSync(join(live.revocationsPath, 'forged.json'));
    // A revocation whose own end has passed: the mandate applies again (ADR-0038 section 4).
    const lapsed = buildRevocation({ principal: c.principal.address, agent: c.standing, expiresAt: iso(Date.now() - 60_000) });
    writeFileSync(join(live.revocationsPath, 'lapsed.json'), JSON.stringify({ ...lapsed, signature: await c.principal.signTypedData(fileOf('AgentRevocation', lapsed, SIMCHAIN_DOMAIN)) }));
    signed(await live.post(payment(termsFor(c))));
    writeFileSync(join(live.revocationsPath, 'broken.json'), '{');
    refused(await live.post(payment(termsFor(c))), 'mandate', /cannot be read/);
    await live.kill();
  });

  it('a mandate from any principal but the pinned one stops the start: a key that mints its own mandate gets nothing', async () => {
    const c = cast();
    const self = privateKeyToAccount(generatePrivateKey());
    const own = await mandateFor({ ...c, principal: self });
    await expect(startSigner(c, rulesFor(c, { reads: [reads.url] }), own)).rejects.toThrow(/names principal 0x[0-9a-f]{40}, not the 0x[0-9a-f]{40} you expect/);
  });

  it('a deal above the mandate\'s own cap is refused even when the rules allow it', async () => {
    const c = cast();
    const doc = (await import('./mandate.ts')).buildMandate({ principal: c.principal.address, agent: c.standing, clubId: V1.buying.clubId, role: 'buyer', maxPerDeal: '5000000', maxPerDay: '1600000000', token: 'tUSD' });
    const m = { ...doc, signature: await c.principal.signTypedData(fileOf('Mandate', doc, SIMCHAIN_DOMAIN)) };
    const s = await startSigner(c, rulesFor(c, { reads: [reads.url] }), m);
    dirs.push(s.dir);
    refused(await s.post(payment(termsFor(c, { price: '5000000' }))), 'B3', /above the mandate's 5000000 a deal/);
    signed(await s.post(payment(termsFor(c, { price: '4000000' }))));
    await s.kill();
  });
});

describe('the rules file and its schema', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats.default(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(RULES_SCHEMA, 'utf8')));

  it('the version 1 file holds constraints.md version 1\'s values, and passes the schema under Ajv strict and the signer\'s own validator', () => {
    expect(V1.buying).toMatchObject({ maxPerDeal: '10000000', maxPerDay: '60000000', maxOpenDeals: 3, maxOpenTotal: '30000000', windows: { offerExpiresInSec: 300, fundWithinSec: 600, deliverWithinSec: 3600, judgeWithinSec: 3600, fallbackWithinSec: 3600 } });
    expect(validate(V1)).toBe(true);
    expect(loadRules(here('./signer-rules.v1.json')).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Ajv and the signer\'s validator agree on every broken file', () => {
    const schema = JSON.parse(readFileSync(RULES_SCHEMA, 'utf8'));
    const broken: J[] = [
      { ...V1, extra: 1 }, { ...V1, version: 2 }, { ...V1, floatAddress: '0xABC' }, { ...V1, chain: { network: 'mainnet' } },
      { ...V1, chain: { network: 'local', deployment: { chainId: 1 } } }, { ...V1, buying: { ...V1.buying, maxPerDeal: '10.5' } },
      { ...V1, buying: { ...V1.buying, maxPerDeal: 10000000 } }, { ...V1, buying: { ...V1.buying, maxOpenDeals: -1 } },
      { ...V1, buying: { ...V1.buying, terms: { ...V1.buying.terms, disclosure: 'private' } } }, { ...V1, buying: { ...V1.buying, sellers: [{}] } },
      { ...V1, reads: { operators: [] } }, { ...V1, reads: { operators: ['file:///etc/passwd'] } }, JSON.parse('{"__proto__": {"x": 1}}'),
    ];
    for (const b of broken) {
      expect(validate(b), JSON.stringify(b).slice(0, 120)).toBe(false);
      expect(schemaError(b, schema), JSON.stringify(b).slice(0, 120)).not.toBeNull();
    }
  });

  it('the signer refuses to start on a schema keyword its validator does not know', () => {
    expect(() => schemaError({}, { type: 'object', propertyNames: { maxLength: 3 } })).toThrow(/does not know: refusing to start/);
  });
});

/** The signer in this process, with a clock the test moves (OpenOptions.now): for the timing of the ledger only. */
async function inProcess(now: { t: number }, o: { rules?: (c: Cast) => J } = {}) {
  const c = cast();
  const dir = mkdtempSync(join(tmpdir(), 'crow-signer-clock-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'rules.json'), JSON.stringify(o.rules ? o.rules(c) : rulesFor(c, { reads: [reads.url] })));
  writeFileSync(join(dir, 'mandate.json'), JSON.stringify(await mandateFor(c, { now: now.t - 1000 })));
  writeFileSync(join(dir, 'flag'), 'run\n');
  mkdirSync(join(dir, 'revocations'));
  spawnSync(process.execPath, [here('./signer.ts'), 'init', '--state', join(dir, 'state')]);
  const s = await Signer.open({ rulesPath: join(dir, 'rules.json'), statePath: join(dir, 'state'), flagPath: join(dir, 'flag'), keys: { float: c.keys.float, buying: c.keys.buying }, now: () => now.t });
  const post = (body: J) => s.handle('POST', '/v1/sign', JSON.stringify(body));
  return { c, s, dir, post };
}

describe('the review and red team of PR 555: each finding, as an attack that now fails', () => {
  it('a deal is "never funded" only after fundBy plus reads.lagSec and clockSkewSec: a funding the reads have not seen yet keeps it open', async () => {
    const t0 = Math.floor(Date.now() / 1000) * 1000, now = { t: t0 };
    const { c, post } = await inProcess(now);
    const first = signed(await post(payment(termsFor(c, { createdAt: t0 }))));
    reads.set(first.commitmentId, 'AcceptedByAdjudicator'); // funded on chain; the operators have not indexed it yet
    now.t = Date.parse(termsFor(c, { createdAt: t0 }).timing.fundBy) + 1000;
    for (let i = 0; i < 2; i++) signed(await post(payment(termsFor(c, { createdAt: now.t }))));
    refused(await post(payment(termsFor(c, { createdAt: now.t }))), 'B9');
    now.t += (V1.reads.lagSec + V1.buying.clockSkewSec) * 1000;
    signed(await post(payment(termsFor(c, { createdAt: now.t }))));
  });

  it('a deal stays open while two read endpoints disagree', async () => {
    const other = await stateServer();
    try {
      const { c, s } = await signer({ rules: (x) => rulesFor(x, { reads: [reads.url, other.url] }) });
      for (let i = 0; i < 3; i++) {
        const id = signed(await s.post(payment(termsFor(c)))).commitmentId;
        reads.set(id, 'Released');
        other.set(id, 'Held');
      }
      refused(await s.post(payment(termsFor(c))), 'B9');
      await s.kill();
    } finally {
      await other.close();
    }
  });

  it('the revocations folder: the form mandate.ts verify prints counts; a file that is not a revocation document refuses; the folder missing stops the start', async () => {
    const { c, s } = await signer();
    const real = buildRevocation({ principal: c.principal.address, agent: c.standing });
    const file = fileOf('AgentRevocation', real, SIMCHAIN_DOMAIN), sig = await c.principal.signTypedData(file);
    const v = await verifyFile(file, sig, SIMCHAIN_DOMAIN, { principal: c.principal.address });
    writeFileSync(join(s.revocationsPath, 'printed.json'), JSON.stringify({ ok: true, kind: v.kind, document: v.document }));
    refused(await s.post(payment(termsFor(c))), 'mandate', /revoked the mandate \(printed.json\)/);
    rmSync(join(s.revocationsPath, 'printed.json'));
    writeFileSync(join(s.revocationsPath, 'typed.json'), JSON.stringify({ ...file, signature: sig }));
    refused(await s.post(payment(termsFor(c))), 'mandate', /typed.json in the revocations folder is not a signed AgentRevocation document/);
    rmSync(join(s.revocationsPath, 'typed.json'));
    signed(await s.post(payment(termsFor(c))));
    await s.kill();
    rmSync(s.revocationsPath, { recursive: true });
    await expect(s.restart()).rejects.toThrow(/revocations folder revocations the rules name is not a folder/);
  });

  it('the ledger: a missing one stops the start, init never writes over one, and a second signer on one state folder does not start', async () => {
    const { c, s } = await signer();
    for (let i = 0; i < 6; i++) settle(signed(await s.post(payment(termsFor(c)))).commitmentId);
    const second = await startSigner(c, JSON.parse(readFileSync(s.rulesPath, 'utf8')), JSON.parse(readFileSync(join(s.dir, 'mandate.json'), 'utf8')), { dir: s.dir }).then(() => 'started', (e: Error) => e.message);
    expect(second).toMatch(/lock exists: another signer serves this state folder/);
    await s.kill();
    const init = spawnSync(process.execPath, [here('./signer.ts'), 'init', '--state', s.statePath], { encoding: 'utf8' });
    expect(init.status).toBe(3);
    rmSync(join(s.statePath, 'ledger.json'));
    await expect(s.restart()).rejects.toThrow(/there is no ledger at .*refusing to start/);
    writeFileSync(join(s.statePath, 'ledger.json'), JSON.stringify({ version: 2, entries: [] }));
    await expect(s.restart()).rejects.toThrow(/not a ledger of version 1/);
  });

  it('the flag reads exactly "run": padding is a stop', async () => {
    const { c, s } = await signer({ flag: '  run  \n\n' });
    refused(await s.post(payment(termsFor(c))), 'X1', /does not read exactly "run"/);
    await s.kill();
  });

  it('every sub-check of B6, B8 and B12 refuses on its own; each has the same control', async () => {
    const { c, s } = await signer();
    const t = () => termsFor(c), base = Math.floor(Date.now() / 1000) * 1000;
    const cases: Array<[string, J, string]> = [
      ['settlement.mode', { ...t(), settlement: { mode: 'optimistic', token: 'tUSD' } }, 'B6'],
      ['remedy.onReject', { ...t(), remedy: { onReject: 'partial_refund' } }, 'B6'],
      ['disclosure.level', { ...t(), disclosure: { level: 'private' } }, 'B6'],
      ['timing.appealWindowSec', termsFor(c, { timing: { appealWindowSec: 60 } }), 'B6'],
      ['rulebookHash', { ...t(), rulebookHash: `0x${'44'.repeat(32)}` }, 'B6'],
      ['schemaVersion', { ...t(), schemaVersion: '0.9' }, 'B6'],
      ['deliverBy', termsFor(c, { createdAt: base, timing: { deliverBy: iso(base + 3_601_000), judgeBy: iso(base + 3_661_000), fallbackBy: iso(base + 3_721_000) } }), 'B8'],
      ['judgeBy', termsFor(c, { createdAt: base, timing: { judgeBy: iso(base + 3_600_000 + 3_601_000), fallbackBy: iso(base + 3_600_000 + 3_661_000) } }), 'B8'],
      ['fallbackBy', termsFor(c, { createdAt: base, timing: { fallbackBy: iso(base + 3_660_000 + 3_601_000) } }), 'B8'],
      ['judgeBy before deliverBy', termsFor(c, { createdAt: base, timing: { judgeBy: iso(base + 3_599_000) } }), 'B8'],
      ['offerExpiresAt after fundBy', termsFor(c, { createdAt: base, timing: { offerExpiresAt: iso(base + 300_000), fundBy: iso(base + 200_000) } }), 'B8'],
      ['settlement.token', { ...t(), settlement: { mode: 'guaranteed_on_decision', token: 'TUSD' } }, 'B12'],
      ['adjudication.fee.token', termsFor(c, { adjudication: { fee: { token: 'TUSD', amount: c.reviewers.fee } } }), 'B12'],
      ['price.token in other case', termsFor(c, { token: 'TUSD' }), 'B12'],
      ['price.token as a list', { ...t(), price: { token: ['tUSD'], amount: '9000000' } }, 'request'],
      ['price.amount as a number', { ...t(), price: { token: 'tUSD', amount: 9000000 } }, 'request'],
      ['timing.maxSubmissions as a string', termsFor(c, { timing: { maxSubmissions: '1' } }), 'request'],
    ];
    for (const [name, terms, rule] of cases) {
      const r = await s.post(payment(terms));
      expect(r.body.rule, `${name}: ${JSON.stringify(r.body)}`).toBe(rule);
    }
    signed(await s.post(payment(t())));
    await s.kill();
  });

  it('B9\'s open total refuses on its own (with maxOpenTotal set to 15.00 for this test, below 3 deals of 10.00)', async () => {
    const { c, s } = await signer({ rules: (x) => ({ ...rulesFor(x, { reads: [reads.url] }), buying: { ...rulesFor(x, { reads: [reads.url] }).buying, maxOpenTotal: '15000000' } }) });
    signed(await s.post(payment(termsFor(c))));
    refused(await s.post(payment(termsFor(c))), 'B9', /above 15000000/);
    await s.kill();
  });

  it('B13: one deal key serves one deal; a repeat gets the same delegation', async () => {
    const { c, s } = await signer();
    const t = termsFor(c);
    const first = signed(await s.post(payment(t)));
    expect(signed(await s.post(payment(t))).delegation).toEqual(first.delegation);
    refused(await s.post(payment(termsFor(c, { buyer: t.buyer }))), 'B13', /one deal key serves one deal/);
    await s.kill();
  });

  it('the mandate\'s other checks: another agent, club or token stops the start; its daily cap refuses the day', async () => {
    const c = cast();
    const wrong = async (mandate: J, re: RegExp) => expect(startSigner(c, rulesFor(c, { reads: [reads.url] }), mandate)).rejects.toThrow(re);
    const sign = async (doc: J) => ({ ...doc, signature: await c.principal.signTypedData(fileOf('Mandate', doc, SIMCHAIN_DOMAIN)) });
    const { buildMandate } = await import('./mandate.ts');
    const doc = (o: J) => buildMandate({ principal: c.principal.address, agent: c.standing, clubId: V1.buying.clubId, role: 'buyer', maxPerDeal: '1600000000', maxPerDay: '1600000000', token: 'tUSD', ...o });
    await wrong(await sign(doc({ agent: fresh() })), /the mandate is for 0x[0-9a-f]{40}, not the standing key/);
    await wrong(await sign(doc({ clubId: 'other-club' })), /does not allow the buyer role in the pinned club/);
    await wrong(await sign(doc({ role: 'seller' })), /does not allow the buyer role/);
    await wrong(await sign(doc({ token: 'tUSDX' })), /caps another token/);
    const s = await startSigner(c, rulesFor(c, { reads: [reads.url] }), await sign(doc({ maxPerDay: '15000000' })));
    dirs.push(s.dir);
    settle(signed(await s.post(payment(termsFor(c)))).commitmentId);
    refused(await s.post(payment(termsFor(c))), 'B4', /mandate's 15000000 a day/);
    await s.kill();
    await expect(startSigner({ ...c, keys: { ...c.keys, buying: generatePrivateKey() } }, rulesFor(c, { reads: [reads.url] }), await mandateFor(c))).rejects.toThrow(/is not the rules' standingKey/);
  });
});

describe('B8 at each bound, with the signer\'s clock injected: one time for the test and the signer (T-442)', () => {
  // One signer for every case, its clock set by each case. A signed deal is closed at the stand-in read (settle) and
  // costs 2.00 tUSDC, so the open-deal and day limits never answer before B8 does.
  const now = { t: 0 };
  let post: (body: J) => Promise<{ status: number; body: J }>, c: Cast;
  beforeAll(async () => void ({ post, c } = await inProcess((now.t = Date.now(), now))));
  /** The signer's answer to one case's terms, with its clock at `signerAt`. A signed deal is closed at once. */
  const at = async (signerAt: number, terms: J) => {
    now.t = signerAt;
    const r = await post(payment(terms));
    if (r.status === 200) settle(r.body.commitmentId);
    return r;
  };
  const T = Math.floor(Date.now() / 1000) * 1000;
  const w = V1.buying.windows;
  /** The deadlines from createdAt T, each `o` field in seconds; deliverBy and judgeBy also move the deadlines after them. */
  const timing = (o: { offer?: number; fund?: number; deliver?: number; judge?: number; fallback?: number } = {}) => {
    const offer = T + (o.offer ?? w.offerExpiresInSec) * 1000, fund = T + (o.fund ?? w.fundWithinSec) * 1000, deliver = T + (o.deliver ?? w.deliverWithinSec) * 1000;
    const judge = deliver + (o.judge ?? 60) * 1000, fallback = judge + (o.fallback ?? 60) * 1000;
    return { offerExpiresAt: iso(offer), fundBy: iso(fund), deliverBy: iso(deliver), judgeBy: iso(judge), fallbackBy: iso(fallback) };
  };
  const terms = (o: J) => termsFor(c, { price: '1000000', ...o });
  const cases: Array<[string, J, J]> = [
    ['the offer window', { offer: w.offerExpiresInSec }, { offer: w.offerExpiresInSec + 1 }],
    ['the funding window', { fund: w.fundWithinSec }, { fund: w.fundWithinSec + 1 }],
    ['the delivery window', { deliver: w.deliverWithinSec }, { deliver: w.deliverWithinSec + 1 }],
    ['the judging window', { judge: w.judgeWithinSec }, { judge: w.judgeWithinSec + 1 }],
    ['the fallback window', { fallback: w.fallbackWithinSec }, { fallback: w.fallbackWithinSec + 1 }],
    ['the offer against the funding deadline', { offer: 300, fund: 300 }, { offer: 300, fund: 299 }],
  ];
  for (const [name, inside, outside] of cases) {
    it(`${name}: at the bound it signs, one second past it refuses`, async () => {
      signed(await at(T, terms({ createdAt: T, timing: timing(inside) })));
      refused(await at(T, terms({ createdAt: T, timing: timing(outside) })), 'B8');
    });
  }

  it(`createdAt ahead of the signer's clock: ${V1.buying.clockSkewSec} s signs, one second more refuses`, async () => {
    const ahead = V1.buying.clockSkewSec * 1000;
    signed(await at(T, terms({ createdAt: T + ahead })));
    refused(await at(T, terms({ createdAt: T + ahead + 1000 })), 'B8', /ahead of the signer's clock/);
  });

  it('the offer\'s expiry by the signer\'s clock: 1 ms before it signs, at it refuses', async () => {
    const expires = T + w.offerExpiresInSec * 1000;
    signed(await at(expires - 1, terms({ createdAt: T })));
    refused(await at(expires, terms({ createdAt: T })), 'B8', /the offer expired at/);
  });
});
