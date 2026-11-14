// The mandate tool (T-433): it builds a Mandate, a Delegation and an AgentRevocation for a signature made elsewhere,
// verifies a signed one, and prints the digest. The keys here are made in memory for the test and signed with as a
// hardware wallet would sign the file; the tool itself never sees them.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormats } from 'ajv-formats';
import { serveTwoOrigins } from './two-origins.ts';
import { SEPOLIA } from './deployments.ts';
import { buildDelegation, buildMandate, buildRevocation, digestOf, documentOfFile, fileOf, LAST_TIME, MANDATE_TYPES, parseStrictJson, pinFor, RevocationUnreadable, sentenceOf, verifyDocument, verifyFile, type Kind } from './mandate.ts';
import { Refusal, TYPES } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const here = fileURLToPath(new URL('.', import.meta.url));
const pin = pinFor();
const domain = pin.domain;
const TOKEN = pin.token.id;
const principal = privateKeyToAccount(generatePrivateKey());
const agent = privateKeyToAccount(generatePrivateKey());
const dealKey = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const ENC = 'A'.repeat(43);
const NOW = Date.parse('2026-11-14T12:00:00Z');
const lc = (a: string) => a.toLowerCase();
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
/** spec/schemas in one Ajv instance, strict, as scripts/spec.mjs loads them. */
const spec = (() => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats.default(ajv);
  ajv.addKeyword({ keyword: 'x-holdback-untrusted', schemaType: 'boolean' });
  const dir = join(here, '../spec/schemas');
  for (const file of readdirSync(dir).filter((x) => x.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  return { ajv };
})();
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Signs the file as a wallet does (eth_signTypedData_v4 of the file as written). */
const signFile = (who: typeof principal, file: J) => who.signTypedData(file);
const mandate = () => buildMandate({ principal: principal.address, agent: agent.address, clubId: 'demo-club', role: 'buyer', maxPerDeal: '10000000', maxPerDay: '60000000', token: TOKEN, now: NOW });
const signed = async (kind: Kind, doc: J, who = kind === 'Delegation' ? agent : principal) => ({ ...doc, signature: await signFile(who, fileOf(kind, doc, domain)) });
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof Refusal ? e.message : `not a refusal: ${String(e)}`));
const delegation = (o: Partial<{ role: 'buyer' | 'seller'; cap: string; expiresAt: string; clubId: string; principal: string; agent: string }> = {}) =>
  buildDelegation({ principal: o.principal ?? principal.address, agent: o.agent ?? agent.address, dealKey, dealEncryptionKey: ENC, clubId: o.clubId ?? 'demo-club', role: o.role ?? 'buyer', cap: o.cap ?? '10000000', token: TOKEN, expiresAt: o.expiresAt ?? '2026-11-14T12:05:00Z' });

describe('the three messages, built for a signature made elsewhere', () => {
  it("hash, every kind, to the digest the core's messageDigest gives: the operators' own encoding (with and without categories)", async () => {
    const core = await import(pathToFileURL(createRequire(join(here, '../apps/operator/package.json')).resolve('@holdback/core')).href);
    for (const d of [domain, pinFor({ sim: true }).domain]) {
      const cd = core.holdbackDomain(d.chainId, d.verifyingContract);
      const m = mandate();
      expect(digestOf('Mandate', m, d)).toBe(core.messageDigest(cd, { type: 'Mandate', ...m }));
      const withCategories = { ...m, scope: { ...m.scope, categories: ['data', 'audit'] } };
      expect(digestOf('Mandate', withCategories, d)).toBe(core.messageDigest(cd, { type: 'Mandate', ...withCategories }));
      const del = delegation();
      expect(digestOf('Delegation', del, d)).toBe(core.messageDigest(cd, del));
      const r = buildRevocation({ principal: principal.address, agent: agent.address });
      expect(digestOf('AgentRevocation', r, d)).toBe(core.messageDigest(cd, r));
    }
  });

  it("verify accepts the mandate the operators' own code signs (the faucet's, served by GET /v1/agents/<address>), and the pinned types are verify.ts's", async () => {
    const demo = await serveTwoOrigins(await PublicWorld.open({ storage: new MemoryStorage(), env: {}, faucetPerClient: 10 }), { tickMs: 100 });
    try {
      const who = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
      const post = await fetch(`${demo.urls[0]}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ address: who }) });
      expect(post.status).toBe(200);
      const found = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const served = ((await (await fetch(`${demo.urls[1]}/v1/agents/${who}`)).json()) as J).mandates[0];
      const { mandateHash: _h, ...m } = served; // eslint-disable-line @typescript-eslint/no-unused-vars
      const v = await verifyDocument('Mandate', m, found.domain ?? pinFor({ sim: true }).domain);
      expect(v).toMatchObject({ kind: 'Mandate', document: { agent: who } });
      // A field changed after signing no longer verifies.
      expect(await refusal(verifyDocument('Mandate', { ...m, clubId: 'other-club' }, found.domain ?? pinFor({ sim: true }).domain))).toMatch(/not by its principal/);
    } finally {
      await demo.close();
    }
    expect(MANDATE_TYPES.Scope).toEqual(TYPES.Scope);
    expect(MANDATE_TYPES.Delegation).toEqual(TYPES.Delegation);
  });

  it('take a fresh random nonce each time, a 7-day mandate by default, and a revocation that lasts until the last representable time', () => {
    const a = mandate(), b = mandate();
    expect(a.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a).toMatchObject({ issuedAt: '2026-11-14T12:00:00Z', scope: { roles: ['buyer'], maxPerCommitment: { token: TOKEN, amount: '10000000' }, maxDaily: { token: TOKEN, amount: '60000000' }, expiresAt: '2026-11-21T12:00:00Z' } });
    expect(a).not.toHaveProperty('scope.categories');
    expect(buildRevocation({ principal: principal.address, agent: agent.address }).expiresAt).toBe(LAST_TIME);
  });

  it('a file signed by the right key verifies, and its document is valid against spec/schemas', async () => {
    const m = await signed('Mandate', mandate());
    const { signature, ...unsigned } = m;
    const v = await verifyFile(fileOf('Mandate', unsigned, domain), signature, domain, { at: NOW });
    expect(v).toMatchObject({ kind: 'Mandate', signer: lc(principal.address), inEffectUntil: '2026-11-21T12:00:00Z' });
    expect(spec.ajv.getSchema('https://holdback.dev/schemas/v0.11/mandate.schema.json')!(v.document)).toBe(true);
    const d = await signed('Delegation', delegation());
    const vd = await verifyDocument('Delegation', d, domain, { at: NOW, mandate: m });
    expect(vd.signer).toBe(lc(agent.address));
    expect(spec.ajv.getSchema('https://holdback.dev/schemas/v0.11/messages.schema.json#/$defs/Delegation')!(vd.document)).toBe(true);
    const r = await signed('AgentRevocation', buildRevocation({ principal: principal.address, agent: agent.address }));
    const vr = await verifyDocument('AgentRevocation', r, domain, { at: NOW, mandate: m });
    expect(spec.ajv.getSchema('https://holdback.dev/schemas/v0.11/messages.schema.json#/$defs/AgentRevocation')!(vr.document)).toBe(true);
  });

  it('reads a file back to the document it was built from', () => {
    const m = mandate();
    expect(documentOfFile(fileOf('Mandate', m, domain), domain)).toEqual({ kind: 'Mandate', doc: m });
    const d = delegation();
    expect(documentOfFile(fileOf('Delegation', d, domain), domain)).toEqual({ kind: 'Delegation', doc: d });
  });
});

describe('attacks on verify: each must be refused, naming the reason', () => {
  it('a signature by another key, a changed field, another chain or rules contract', async () => {
    const m = mandate();
    const file = fileOf('Mandate', m, domain);
    const stranger = privateKeyToAccount(generatePrivateKey());
    expect(await refusal(verifyFile(file, await signFile(stranger, file), domain, { at: NOW }))).toMatch(/signed by 0x[0-9a-f]{40}, not by its principal/);
    const good = await signFile(principal, file);
    const raised = { ...m, scope: { ...m.scope, maxPerCommitment: { token: TOKEN, amount: '10000001' } }, signature: good };
    expect(await refusal(verifyDocument('Mandate', raised, domain, { at: NOW }))).toMatch(/not by its principal/);
    const otherChain = { ...domain, chainId: 31337 };
    expect(await refusal(verifyFile(fileOf('Mandate', m, otherChain), await signFile(principal, fileOf('Mandate', m, otherChain)), domain, { at: NOW }))).toMatch(/not your pinned .*another chain or rules contract/);
    const otherRules = { ...domain, verifyingContract: `0x${'12'.repeat(20)}` as `0x${string}` };
    expect(await refusal(verifyFile(fileOf('Mandate', m, otherRules), await signFile(principal, fileOf('Mandate', m, otherRules)), domain, { at: NOW }))).toMatch(/another chain or rules contract/);
  });

  it('an unknown type, an extra field, a field its type renames, a malformed value', async () => {
    const file = fileOf('Mandate', mandate(), domain);
    const sig = await signFile(principal, file);
    expect(await refusal(verifyFile({ ...file, primaryType: 'Offer' }, sig, domain))).toMatch(/refusing/);
    expect(await refusal(verifyFile({ ...file, message: { ...file.message, extra: '1' } }, sig, domain))).toMatch(/exactly the fields of Mandate/);
    const renamed = { ...file, types: { ...file.types, Mandate: file.types.Mandate.map((x: J) => (x.name === 'agent' ? { ...x, name: 'delegate' } : x)) }, message: { ...Object.fromEntries(Object.entries(file.message).filter(([k]) => k !== 'agent')), delegate: file.message.agent } };
    expect(await refusal(verifyFile(renamed, sig, domain))).toMatch(/Mandate lacks agent/);
    expect(await refusal(verifyDocument('Mandate', { ...mandate(), clubId: 'Demo Club', signature: sig }, domain))).toMatch(/clubId "Demo Club" is not a club ID/);
    expect(await refusal(verifyDocument('Mandate', { ...mandate(), issuedAt: '2026-11-14T12:00:00.500Z', signature: sig }, domain))).toMatch(/not a date-time on a whole second/);
    expect(await refusal(verifyDocument('Mandate', { ...mandate(), signature: '0x12' }, domain))).toMatch(/not 65 bytes/);
  });

  it('an expired mandate or delegation, and a mandate issued well after the time asked', async () => {
    const m = await signed('Mandate', mandate());
    expect(await refusal(verifyDocument('Mandate', m, domain, { at: Date.parse('2026-11-21T12:00:00Z') }))).toMatch(/ended at 2026-11-21T12:00:00Z/);
    expect(await refusal(verifyDocument('Mandate', m, domain, { at: NOW - 301_000 }))).toMatch(/more than 300 s after/);
    const d = await signed('Delegation', delegation());
    expect(await refusal(verifyDocument('Delegation', d, domain, { at: Date.parse('2026-11-14T12:05:00Z') }))).toMatch(/ended at 2026-11-14T12:05:00Z/);
  });

  it('a delegation wider than its mandate, field by field', async () => {
    const m = await signed('Mandate', mandate());
    const wider = async (o: Parameters<typeof delegation>[0]) => refusal(verifyDocument('Delegation', await signed('Delegation', delegation(o)), domain, { at: NOW, mandate: m }));
    expect(await wider({ role: 'seller' })).toMatch(/allows the seller role, which the mandate does not/);
    expect(await wider({ cap: '10000001' })).toMatch(/maxPerCommitment 10000001 is above the mandate's 10000000/);
    expect(await wider({ clubId: 'other-club' })).toMatch(/for club other-club, and the mandate for demo-club/);
    expect(await wider({ expiresAt: '2026-11-21T12:00:01Z' })).toMatch(/after the mandate ends/);
    expect(await wider({ principal: privateKeyToAccount(generatePrivateKey()).address })).toMatch(/not under this mandate/);
    // Signed by another agent key, which names itself: not the mandate's agent.
    const other = privateKeyToAccount(generatePrivateKey());
    const own = await signed('Delegation', delegation({ agent: other.address }), other);
    expect(await refusal(verifyDocument('Delegation', own, domain, { at: NOW, mandate: m }))).toMatch(/names agent 0x[0-9a-f]{40}, and the mandate is for/);
    // The control: the same delegation inside the mandate passes.
    expect(await wider({})).toBeNull();
  });

  it('a revocation by a key that names itself as principal revokes nothing in the mandate (ADR-0038 section 4)', async () => {
    const m = await signed('Mandate', mandate());
    const self = privateKeyToAccount(generatePrivateKey());
    const r = await signed('AgentRevocation', buildRevocation({ principal: self.address, agent: agent.address }), self);
    expect(await refusal(verifyDocument('AgentRevocation', r, domain, { at: NOW, mandate: m }))).toMatch(/it revokes nothing in this mandate/);
    const forged = { ...buildRevocation({ principal: principal.address, agent: agent.address }) };
    expect(await refusal(verifyDocument('AgentRevocation', { ...forged, signature: await signFile(self, fileOf('AgentRevocation', forged, domain)) }, domain, { at: NOW, mandate: m }))).toMatch(/not by its principal/);
    const lapsed = await signed('AgentRevocation', buildRevocation({ principal: principal.address, agent: agent.address, expiresAt: '2026-11-14T11:00:00Z' }));
    expect(await refusal(verifyDocument('AgentRevocation', lapsed, domain, { at: NOW }))).toMatch(/ended at 2026-11-14T11:00:00Z/);
  });
});

describe('attacks from the red team and the review of PR 552', () => {
  it('a mandate a key mints for itself verifies as signed, and is refused once the principal is pinned', async () => {
    const self = privateKeyToAccount(generatePrivateKey());
    const own = buildMandate({ principal: self.address, agent: agent.address, clubId: 'demo-club', role: 'buyer', maxPerDeal: '999999999999', maxPerDay: '999999999999', token: TOKEN, now: NOW });
    const doc = { ...own, signature: await signFile(self, fileOf('Mandate', own, domain)) };
    expect(await refusal(verifyDocument('Mandate', doc, domain, { at: NOW }))).toBeNull();
    expect(await refusal(verifyDocument('Mandate', doc, domain, { at: NOW, principal: principal.address }))).toMatch(/names principal 0x[0-9a-f]{40}, not the 0x[0-9a-f]{40} you expect/);
  });

  it('a delegation counts only under its mandate; a revocation that ends the mandate says so', async () => {
    const d = await signed('Delegation', delegation());
    expect(await refusal(verifyDocument('Delegation', d, domain, { at: NOW }))).toMatch(/counts only under its mandate/);
    const m = await signed('Mandate', mandate());
    const r = await signed('AgentRevocation', buildRevocation({ principal: principal.address, agent: agent.address }));
    expect((await verifyDocument('AgentRevocation', r, domain, { at: NOW, mandate: m, principal: principal.address })).revokesMandate).toBe(true);
  });

  it('a revocation with a time past year 9999 is unreadable, never "not revoked"; times with an offset or a zero fraction verify as the same integer', async () => {
    const r = buildRevocation({ principal: principal.address, agent: agent.address });
    const file = fileOf('AgentRevocation', r, domain);
    const huge = { ...file, message: { ...file.message, expiresAt: '18446744073709551615' } };
    const e = await verifyFile(huge, await signFile(principal, huge), domain, { at: NOW }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(RevocationUnreadable);
    const offset = { ...r, expiresAt: '2026-12-01T01:00:00+01:00' };
    const signedOffset = { ...offset, signature: await signFile(principal, fileOf('AgentRevocation', { ...r, expiresAt: '2026-12-01T00:00:00Z' }, domain)) };
    expect((await verifyDocument('AgentRevocation', signedOffset, domain, { at: NOW })).document.expiresAt).toBe('2026-12-01T00:00:00Z');
    expect((await verifyDocument('AgentRevocation', { ...signedOffset, expiresAt: '2026-12-01T00:00:00.000Z' }, domain, { at: NOW })).inEffectUntil).toBe('2026-12-01T00:00:00Z');
  });

  it('a malleable twin of a signature is refused; v as 0 or 1 reads as 27 or 28', async () => {
    const m = mandate();
    const sig = await signFile(principal, fileOf('Mandate', m, domain));
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${sig.slice(66, 130)}`), v = parseInt(sig.slice(130), 16);
    const twin = `${sig.slice(0, 66)}${(n - s).toString(16).padStart(64, '0')}${(v === 27 ? 28 : 27).toString(16)}`;
    expect(await refusal(verifyDocument('Mandate', { ...m, signature: twin }, domain, { at: NOW }))).toMatch(/high s/);
    const zero = `${sig.slice(0, 130)}${(v - 27).toString(16).padStart(2, '0')}`;
    expect((await verifyDocument('Mandate', { ...m, signature: zero }, domain, { at: NOW })).document.signature).toBe(sig);
  });

  it('a file that names a key twice, or uses __proto__, is refused; verify runs only under a pinned chain', async () => {
    expect(() => parseStrictJson('{"amount":"999999999999","amount":"10000000"}')).toThrow(/names the key "amount" twice/);
    expect(() => parseStrictJson('{"a":{"__proto__":{}}}')).toThrow(/__proto__/);
    expect(parseStrictJson(String.raw`{"a":[1,{"b":"x\\y"}],"c":"}"}`)).toEqual({ a: [1, { b: 'x\\y' }], c: '}' });
    const m = await signed('Mandate', mandate());
    expect(await refusal(verifyDocument('Mandate', m, { ...domain, chainId: 1 }, { at: NOW }))).toMatch(/not Holdback 0.8 on Ethereum Sepolia or a local chain/);
  });

  it('free text reaches the terminal printable only, and a mandate that ends before it is issued is refused', async () => {
    const m = mandate();
    const odd = { ...m, scope: { ...m.scope, maxPerCommitment: { token: 'tUSD\u001b[2K', amount: '1' } } };
    expect(sentenceOf('Mandate', odd)).not.toMatch(/\u001b/);
    expect(await refusal(verifyDocument('Mandate', { ...m, issuedAt: '2026-11-22T00:00:00Z', signature: await signFile(principal, fileOf('Mandate', m, domain)) }, domain, { at: NOW }))).toMatch(/ends before it is issued/);
  });
});

describe('the command line', () => {
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [join(here, 'mandate.ts'), ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  it('builds a file, prints its digest and sentence, and verifies the signature a wallet made over it', async () => {
    const r = run(['mandate', principal.address, agent.address, 'demo-club', 'buyer', '10000000', '60000000']);
    expect(r.code).toBe(0);
    const file = JSON.parse(r.out);
    expect(file.primaryType).toBe('Mandate');
    expect(file.domain).toEqual({ name: 'Holdback', version: '0.8', chainId: SEPOLIA!.chainId, verifyingContract: lc(SEPOLIA!.rules) });
    const digest = r.err.match(/^digest (0x[0-9a-f]{64}) /)![1];
    expect(r.err).toContain(`${lc(principal.address)} lets ${lc(agent.address)} act as buyer in club demo-club, at most 10000000 base units (10.000000 tUSDC)`);
    const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'm.json'), r.out);
    const v = run(['verify', join(dir, 'm.json'), await signFile(principal, file)]);
    expect(v.code).toBe(0);
    expect(JSON.parse(v.out)).toMatchObject({ ok: true, kind: 'Mandate', digest, signer: lc(principal.address) });
    const bad = run(['verify', join(dir, 'm.json'), await signFile(agent, file)]);
    expect(bad.code).toBe(3);
    expect(bad.err).toMatch(/^refusing: the Mandate is signed by/);
  });

  it('verify --mandate takes the mandate as verify printed it, and --principal pins the principal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-'));
    dirs.push(dir);
    const built = run(['mandate', principal.address, agent.address, 'demo-club', 'buyer', '10000000', '60000000']);
    writeFileSync(join(dir, 'm.typed.json'), built.out);
    const printed = run(['verify', join(dir, 'm.typed.json'), await signFile(principal, JSON.parse(built.out)), '--principal', principal.address]);
    expect(JSON.parse(printed.out)).toMatchObject({ ok: true, principalChecked: true });
    writeFileSync(join(dir, 'm.verified.json'), printed.out);
    const del = run(['delegation', principal.address, agent.address, dealKey, ENC, 'demo-club', 'buyer', '10000000', iso(Date.now() + 300_000)]);
    writeFileSync(join(dir, 'd.typed.json'), del.out);
    const ok = run(['verify', join(dir, 'd.typed.json'), await signFile(agent, JSON.parse(del.out)), '--mandate', join(dir, 'm.verified.json'), '--principal', principal.address]);
    expect(ok.code, ok.err).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ kind: 'Delegation', fitsMandate: true });
    const without = run(['verify', join(dir, 'd.typed.json'), await signFile(agent, JSON.parse(del.out))]);
    expect(without.code).toBe(3);
    const stranger = privateKeyToAccount(generatePrivateKey());
    const wrong = run(['verify', join(dir, 'm.typed.json'), await signFile(principal, JSON.parse(built.out)), '--principal', stranger.address]);
    expect(wrong.code).toBe(3);
  });

  it('takes no key in any spelling: 0X, padded with spaces, or bare', () => {
    const key = generatePrivateKey();
    for (const k of [key, key.replace('0x', '0X'), ` ${key} `, key.slice(2)]) {
      const r = run(['revocation', principal.address, agent.address, '--expires-at', k]);
      expect(r.code).toBe(3);
      expect(r.err).not.toContain(key.slice(2));
    }
  });

  it('takes no key: a 32-byte hex argument is refused, and nothing is read from the environment', () => {
    const key = generatePrivateKey();
    for (const args of [['mandate', key, agent.address, 'demo-club', 'buyer', '1', '1'], ['revocation', principal.address, agent.address, key.slice(2)]]) {
      const r = run(args);
      expect(r.code).toBe(3);
      expect(r.err).toMatch(/this tool takes no key/);
    }
    // The source reads no environment variable but the deployment, and no key file.
    const source = spawnSync('grep', ['-oE', "process\\.env\\['[A-Z_]+'\\]", join(here, 'mandate.ts')], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect([...new Set(source)]).toEqual(["process.env['HOLDBACK_DEPLOYMENT']"]);
  });

  it('pins Sepolia or a local chain only: a mainnet deployment is refused', () => {
    const mainnet = JSON.stringify({ ...SEPOLIA, chainId: 1 });
    const r = run(['revocation', principal.address, agent.address], { HOLDBACK_DEPLOYMENT: mainnet });
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/chain 1 is not Ethereum Sepolia \(11155111\) or a local chain \(31337\)/);
    const local = run(['revocation', principal.address, agent.address], { HOLDBACK_DEPLOYMENT: JSON.stringify({ ...SEPOLIA, chainId: 31337 }) });
    expect(local.code).toBe(0);
    expect(JSON.parse(local.out).domain.chainId).toBe(31337);
  });

  it('answers a wrong call with the usage and status 2', () => {
    const r = run(['mandate', principal.address]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('node examples/mandate.ts verify <typed-data file> <signature>');
  });
});
