import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { build, collect, INPUTS, plain, stackVersion } from '../scripts/contract-stack.mjs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

describe('contract-stack page', () => {
  const data = collect();
  const live = json('contracts/deployments/sepolia.json');

  it('lists every contract in contracts/src', () => {
    const files = readdirSync(new URL('contracts/src/', root)).filter((f) => f.endsWith('.sol')).sort();
    expect(data.contracts.map((c: { file: string }) => c.file)).toEqual(files.map((f) => `contracts/src/${f}`));
    for (const c of data.contracts) {
      expect(c.codeLines).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(10);
    }
  });

  it('marks the contracts the live record deployed', () => {
    const deployed = data.contracts.filter((c: { deployed: boolean }) => c.deployed).map((c: { name: string }) => c.name);
    for (const name of ['HoldbackRules', 'HoldbackBonds', 'DrandQuicknetBeacon']) expect(deployed).toContain(name);
  });

  it('shows the live addresses, chain and commit from contracts/deployments/sepolia.json', () => {
    const d = data.deployment.live;
    expect(d.chainId).toBe(live.chainId);
    expect(d.commit).toBe(live.commit);
    const byKey = Object.fromEntries(d.addresses.map((a: { key: string; address: string }) => [a.key, a.address]));
    for (const key of ['rules', 'bonds', 'beacon', 'escrow', 'erc3009Collector', 'permit2Collector', 'multicall']) expect(byKey[key]).toBe(live[key]);
    expect(byKey['token']).toBe(live.token.address);
    expect(d.domain?.version).toMatch(/^\d+\.\d+$/);
    const html = build();
    for (const a of d.addresses) expect(html).toContain(a.address);
  });

  it('reads every kept earlier deployment with its date and domain', () => {
    const files = readdirSync(new URL('contracts/deployments/', root)).filter((f) => /^sepolia-\d{4}-\d{2}-\d{2}-domain-/.test(f));
    expect(data.deployment.earlier).toHaveLength(files.length);
    for (const e of data.deployment.earlier) {
      expect(e.deployedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.addresses.length).toBeGreaterThan(0);
    }
  });

  it('reads every finding in the review summary with a severity and a state', () => {
    const review = readFileSync(new URL('docs/reviews/2026-11-03-contract-review.md', root), 'utf8');
    const ids = [...review.matchAll(/^\| ([HML]-\d+) \|/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const f = data.findings.find((x: { id: string }) => x.id === id);
      expect(f, id).toBeDefined();
      expect(['high', 'medium', 'low', 'info']).toContain(f.severity);
      expect(['fixed', 'open', 'accepted']).toContain(f.state);
      expect(f.text.length).toBeGreaterThan(10);
    }
  });

  it('counts a T-212 item marked done as fixed, so the page follows the hardening task', () => {
    for (const id of ['L-1', 'L-7', 'I-8']) expect(data.findings.find((f: { id: string }) => f.id === id)?.state, id).toBe('fixed');
  });

  it('has plain wording for every finding state it shows, or falls back to the review', () => {
    const words = plain().findings;
    for (const f of data.findings) {
      const w = words[f.id];
      if (w?.[f.state]) expect(f.text).toBe(w[f.state]);
      else expect(f.text).toContain('Review status');
    }
  });

  it('finds every gas path it names in reports/differential-local.md, and the Sepolia deal T-212 records', () => {
    for (const p of data.gas.paths) {
      expect(p.gas, p.fixture).toBeGreaterThan(0);
      expect(p.transactions, p.fixture).toBeGreaterThan(0);
    }
    expect(data.sepoliaGas?.total).toBe(data.sepoliaGas.fund + data.sepoliaGas.deliver + data.sepoliaGas.decide);
  });

  it('versions the page by the latest commit that touched its inputs, so the console rebuilds only on a change', () => {
    const v = stackVersion();
    expect(v?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(v?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.version).toEqual(v);
    for (const path of ['contracts/src/', 'contracts/deployments/']) expect(INPUTS).toContain(path);
    // That commit touched at least one input.
    const touched = execFileSync('git', ['show', '--name-only', '--format=', v.commit], { cwd: new URL('.', root), encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(touched.some((f) => INPUTS.some((i: string) => (i.endsWith('/') ? f.startsWith(i) : f === i)))).toBe(true);
  });

  it('embeds the data in the template with no raw closing tags and no placeholder left', () => {
    const html = build();
    expect(html).not.toContain('/*__STACK_DATA__*/null');
    const embedded = html.slice(html.indexOf('window.STACK = '), html.indexOf(';</script>'));
    expect(embedded.length).toBeGreaterThan(1000);
    expect(embedded).not.toContain('</');
    for (const id of ['pills', 'safety', 'sources', 'addresses', 'gas', 'footer', 'deploy-intro', 'gas-notes']) expect(html).toContain(`id="${id}"`);
  });
});
