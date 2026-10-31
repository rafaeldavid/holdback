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
import { checkRun } from './check.ts';
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
