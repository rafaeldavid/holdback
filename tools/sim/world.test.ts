// sim:world gives each run its own world on free ports, so parallel runs never share state; sim:check then
// reads that world over HTTP. This drives a scripted pair from examples/ against one of two worlds started
// side by side, checks it end to end, and shows the check failing on a mutated ledger.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchAudit, readRun } from './audit.ts';
import { loadCatalogue, renderBrief } from './brief.ts';
import { checkRun } from './check.ts';
import { readMessage, receive, receiveWaiting, send } from './mail.ts';
import { startRunWorld, validRunId, type RunWorld, type WorldFile } from './world.ts';

const runs = mkdtempSync(join(tmpdir(), 't021-runs-'));
let a: RunWorld;
let b: RunWorld;

beforeAll(async () => {
  [a, b] = await Promise.all([startRunWorld({ runId: 'iso-a', runsDir: runs, env: {}, onError: () => {} }), startRunWorld({ runId: 'iso-b', runsDir: runs, env: {}, onError: () => {} })]);
});
afterAll(async () => {
  await Promise.all([a?.close(), b?.close()]);
});

function example(name: string, simUrl: string): Promise<{ code: number | null; out: string }> {
  const runTs = fileURLToPath(new URL('../../examples/run.ts', import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runTs, name], { env: { ...process.env, HOLDBACK_SIM_URL: simUrl } });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

describe('sim:world', () => {
  it('refuses run ids that are not a plain name', () => {
    for (const bad of ['', '../x', 'a/b', 'A B', 'x'.repeat(65)]) expect(validRunId(bad), bad).toBe(false);
    for (const good of ['batch-1', 'r2', 'haiku-vs-opus-3']) expect(validRunId(good), good).toBe(true);
  });

  it('starts each run on its own free ports, with its own accounts, and writes world.json', () => {
    const fa = JSON.parse(readFileSync(join(runs, 'iso-a', 'world.json'), 'utf8')) as WorldFile;
    const fb = JSON.parse(readFileSync(join(runs, 'iso-b', 'world.json'), 'utf8')) as WorldFile;
    const urls = (w: WorldFile) => [w.sim, ...w.operators, w.coordinator.auditUrl];
    expect(new Set([...urls(fa), ...urls(fb)]).size).toBe(8);
    expect(fa.runId).toBe('iso-a');
    expect(Object.keys(fa.parties)).toEqual(['buyer-1', 'seller-1', 'buyer-2', 'seller-2']);
    expect(fa.parties['buyer-1']!.address).not.toBe(fb.parties['buyer-1']!.address);
    expect(fa.pinnedDomain).toMatchObject({ name: 'Holdback', chainId: 31337 });
  });

  it('runs a scripted pair in one world without touching the other, and sim:check passes it', async () => {
    const r = await example('buy-dataset', a.file.sim);
    expect(r.out).toContain('outcome: Released');
    expect(r.code, r.out).toBe(0);
    const auditA = await fetchAudit(a.file.coordinator.auditUrl);
    const auditB = await fetchAudit(b.file.coordinator.auditUrl);
    expect(auditA.log.some((e) => e.type === 'settlement.released')).toBe(true);
    expect(auditB.log).toEqual([]);

    const input = await readRun(a.file, auditA);
    const result = await checkRun(input);
    expect(result.invariants.filter((i) => !i.ok), JSON.stringify(result.invariants, null, 2)).toEqual([]);
    expect(result.commitments).toHaveLength(1);

    // The same run with one unit moved from the buyer to the seller off the record.
    const mutated = structuredClone(auditA);
    const buyer = Object.keys(input.audit.genesis.balances).find((k) => mutated.ledger[k] && BigInt(mutated.ledger[k]!) < 10_000_000_000n)!;
    mutated.ledger[buyer] = (BigInt(mutated.ledger[buyer]!) - 1n).toString();
    const seller = Object.keys(mutated.ledger).find((k) => k.startsWith('0x') && BigInt(mutated.ledger[k]!) > 10_000_000_000n)!;
    mutated.ledger[seller] = (BigInt(mutated.ledger[seller]!) + 1n).toString();
    const bad = await checkRun({ ...input, audit: mutated });
    expect(bad.ok).toBe(false);
    expect(bad.invariants.find((i) => i.id === 'conservation')!.ok).toBe(false);
  }, 60_000);
});

describe('catalogue, briefs and mail', () => {
  it('every job in the catalogue prepares as an offer on a live world', async () => {
    const f = a.file;
    const [primary, fallback, appeal] = f.adjudicators.map((x) => x.address);
    for (const job of loadCatalogue().jobs) {
      const res = await fetch(`${f.operators[0]}/v1/prepare/offer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...job.terms,
          // T-030 (D39): prepare takes the caller's nonce and disclosure level; it derives neither.
          nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`,
          disclosure: 'public',
          clubId: f.clubId,
          seller: f.parties['seller-1']!.address,
          buyer: { address: f.parties['buyer-1']!.address, encryptionPublicKey: f.parties['buyer-1']!.encryptionPublicKey },
          adjudicators: { primary, fallback, appeal },
        }),
      });
      expect(res.status, `${job.id}: ${await res.clone().text()}`).toBe(200);
    }
  });

  it('every profile has a brief, and adversarial ones have tactics per role', () => {
    const c = loadCatalogue();
    expect(c.profiles.map((p) => p.id)).toEqual(['honest', 'sloppy', 'impatient', 'adversarial']);
    const adv = c.profiles.find((p) => p.id === 'adversarial')!;
    expect(adv.tactics!.buyer.length).toBeGreaterThan(2);
    expect(adv.tactics!.seller.length).toBeGreaterThan(2);
    for (const p of c.pairings) expect(c.jobs.some((j) => j.id === p.job), p.run).toBe(true);
  });

  it('a brief carries outsider knowledge and the party\'s own account only', () => {
    const f = a.file;
    const brief = renderBrief({ world: f, party: 'buyer-1', counterparty: 'seller-1', role: 'buyer', job: 'dataset', profile: 'adversarial', model: 'opus' });
    expect(brief).not.toMatch(/\{\{/);
    expect(brief).toContain(f.parties['buyer-1']!.privateKey);
    expect(brief).toContain(f.parties['seller-1']!.address);
    expect(brief).toContain('docs/quickstart.md');
    expect(brief).toContain('Appeal every decision');
    expect(brief).toContain('../../world.json');
    expect(brief).toContain('never suspect injection');
    expect(brief).toContain('serves no secret key');
    expect(brief).toContain('--out <file>');
    const others = ['seller-1', 'buyer-2', 'seller-2'].map((p) => f.parties[p]!);
    const secrets = [...others.flatMap((p) => [p.privateKey, p.encryptionSecretKey]), f.coordinator.auditUrl, f.parties['buyer-2']!.address, 'FAIL-ME', 'sim:check'];
    for (const secret of secrets) {
      expect(brief, secret).not.toContain(secret);
    }
  });

  it('the sim service serves no party\'s secret on any route (sim batch 1, F1)', async () => {
    const f = a.file;
    const w = a.world;
    // The parties' keys, and (PR 57 review) every other key in the world and the secret they derive from.
    const labels = ['sim-adjudicator-a', 'sim-adjudicator-b', 'sim-adjudicator-c', 'sim-operator-1', 'sim-operator-2', 'sim-club-operator', ...w.info.accounts.map((x) => `${x.label}/principal`)];
    const keyStrings = (k: { privateKey: string; encryptionSecretKey: Uint8Array }) => [k.privateKey, k.privateKey.slice(2), Buffer.from(k.encryptionSecretKey).toString('hex'), Buffer.from(k.encryptionSecretKey).toString('base64url')];
    expect(w.keySecret).toMatch(/^[0-9a-f]{64}$/);
    const secrets = [
      ...Object.values(f.parties).flatMap((p) => [p.privateKey, p.privateKey.slice(2), p.encryptionSecretKey]),
      ...labels.flatMap((l) => keyStrings(w.keysOf(l))),
      w.keySecret!,
    ];
    const routes: Array<[string, string, string?]> = [
      ['GET', '/'],
      ['GET', '/clock'],
      ['GET', '/accounts'],
      ['POST', '/accounts'],
      ['POST', '/advance', '{"seconds": "x"}'],
      ['POST', '/adjudicators/primary', '{}'],
      ['GET', '/world.json'],
      ['DELETE', '/'],
    ].map(([m, p, b]) => [m!, `${f.sim}${p}`, b] as [string, string, string?]);
    for (const o of f.operators) {
      routes.push(['GET', `${o}/.well-known/holdback.json`], ['GET', `${o}/v1/clubs/${f.clubId}`]);
      for (const p of Object.values(f.parties)) routes.push(['GET', `${o}/v1/agents/${p.address}`]); // the mandate read
    }
    for (const [method, url, body] of routes) {
      const res = await fetch(url, { method, ...(body === undefined ? {} : { body }) });
      const text = await res.text();
      for (const secret of secrets) expect(text, `${method} ${url}`).not.toContain(secret);
    }
    // The adjudicators the parties name hold keys from the world secret (sim-world.test.ts shows the bare labels give other addresses).
    expect(f.adjudicators.map((x) => x.address)).toEqual(['sim-adjudicator-a', 'sim-adjudicator-b', 'sim-adjudicator-c'].map((l) => w.keysOf(l).address));
    // The parties' keys are not the public test-account keys of their names either.
    const served = (await (await fetch(`${f.sim}/`)).json()) as { accounts: Array<{ address: string; privateKey?: string }> };
    expect(served.accounts.map((x) => x.address).sort()).toEqual(Object.values(f.parties).map((p) => p.address).sort());
    expect(served.accounts.every((x) => x.privateKey === undefined)).toBe(true);
  });

  it('mail delivers each message once, in order', async () => {
    const root = join(runs, 'iso-a', 'mailbox');
    send(root, { from: 'seller-1', to: 'buyer-1', subject: 'offer', body: '{"n":1}' });
    send(root, { from: 'seller-1', to: 'buyer-1', subject: 'again', body: '{"n":2}' });
    expect(receive(root, 'buyer-1')?.subject).toBe('offer');
    expect((await receiveWaiting(root, 'buyer-1', 1))?.body).toBe('{"n":2}');
    expect(await receiveWaiting(root, 'buyer-1', 0)).toBeNull();
    expect(() => send(root, { from: 'x', to: 'nobody', subject: '', body: '' })).toThrow(/no mailbox/);
  });

  it('mail read --out saves the body byte for byte, so a signed offer is never transcribed (sim batch 1, F5)', () => {
    const root = join(runs, 'iso-b', 'mailbox');
    const body = `${JSON.stringify({ signature: `0x${'ab'.repeat(65)}`, note: 'line\n"quoted"' }, null, 2)}\n`;
    send(root, { from: 'seller-1', to: 'buyer-1', subject: 'signed offer', body });
    const out = join(mkdtempSync(join(tmpdir(), 't023-mail-')), 'offer.json');
    const printed = JSON.parse(readMessage(root, 'buyer-1', { out })!) as Record<string, unknown>;
    expect(readFileSync(out, 'utf8')).toBe(body);
    expect(printed).toMatchObject({ from: 'seller-1', subject: 'signed offer', bodyFile: out });
    expect(printed['body']).toBeUndefined();
    expect(readMessage(root, 'buyer-1', {})).toBeNull();
    send(root, { from: 'seller-1', to: 'buyer-1', subject: 'plain', body: 'hi' });
    // PR 57 review: a write that fails leaves the message unread, so it is not lost.
    expect(() => readMessage(root, 'buyer-1', { out: join(out, 'not-a-dir', 'x.json') })).toThrow();
    expect(JSON.parse(readMessage(root, 'buyer-1', {})!)).toMatchObject({ subject: 'plain', body: 'hi' });
  });
});
