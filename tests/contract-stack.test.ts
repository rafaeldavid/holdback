import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without type declarations
import { build, collect, INPUTS, PHASE_ONE_ADDRESS_KEYS, plain, shallow, stackVersion } from '../scripts/contract-stack.mjs';
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
    for (const name of ['HoldbackRules', 'DrandQuicknetBeacon']) expect(deployed).toContain(name);
  });

  it('shows the live addresses, chain and commit from contracts/deployments/sepolia.json', () => {
    const d = data.deployment.live;
    expect(d.chainId).toBe(live.chainId);
    expect(d.commit).toBe(live.commit);
    const byKey = Object.fromEntries(d.addresses.map((a: { key: string; address: string }) => [a.key, a.address]));
    // Every address the record has is shown as recorded; a phase-one record has the phase-one contracts at least.
    for (const key of PHASE_ONE_ADDRESS_KEYS) expect(byKey[key], key).toBe(key === 'token' ? live.token.address : live[key]);
    for (const a of d.addresses) expect(a.address).toBe(a.key === 'token' ? live.token.address : live[a.key]);
    expect(d.domain?.version).toMatch(/^\d+\.\d+$/);
    const html = build();
    for (const a of d.addresses) expect(html).toContain(a.address);
  });

  it('lists exactly the state-changing functions HoldbackRules has, so the page describes the contract in contracts/src', () => {
    const source = readFileSync(new URL('contracts/src/HoldbackRules.sol', root), 'utf8');
    const external = [...source.matchAll(/function (\w+)\(([\s\S]*?)\{/g)].filter((m) => /\bexternal\b/.test(m[2]!) && !/\bview\b/.test(m[2]!)).map((m) => m[1]!);
    const template = readFileSync(new URL('tools/contract-stack/template.html', root), 'utf8');
    const card = template.slice(template.indexOf('<h3>HoldbackRules</h3>'), template.indexOf('</article>', template.indexOf('<h3>HoldbackRules</h3>')));
    const listed = [...card.matchAll(/<tr><td>(.*?)<\/td>/g)].flatMap((m) => [...m[1]!.matchAll(/<code>(\w+)<\/code>/g)].map((c) => c[1]!));
    expect(external.length).toBeGreaterThan(5);
    expect([...listed].sort()).toEqual([...external].sort());
  });

  it('reads every kept earlier deployment with its date and domain', () => {
    const files = readdirSync(new URL('contracts/deployments/', root)).filter((f) => /^sepolia-\d{4}-\d{2}-\d{2}(T\d{4}Z)?-domain-/.test(f));
    expect(data.deployment.earlier).toHaveLength(files.length);
    for (const e of data.deployment.earlier) {
      expect(e.deployedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.addresses.length).toBeGreaterThan(0);
      // The domain comes from the file name, so a one-commit checkout cannot replace it with today's.
      expect(e.file).toContain(`-domain-${e.domain.version}.json`);
      if (!shallow() && e.commit) {
        const source = execFileSync('git', ['show', `${e.commit}:contracts/src/HoldbackRules.sol`], { cwd: new URL('.', root), encoding: 'utf8' });
        expect(source).toContain(`"${e.domain.version}"`);
      }
    }
  });

  it('rates a re-rated finding by its current severity, so an open Medium is not shown as Low', () => {
    const l5 = data.findings.find((f: { id: string }) => f.id === 'L-5');
    expect(l5.severityNote).toMatch(/since/);
    expect(l5.severity).toBe('medium');
    const serious = data.findings.filter((f: { severity: string }) => f.severity === 'high' || f.severity === 'medium');
    expect(serious.some((f: { state: string }) => f.state !== 'fixed')).toBe(true);
  });

  it('never words a fixed finding with an open status', () => {
    for (const f of data.findings.filter((x: { state: string }) => x.state === 'fixed')) expect(f.text, f.id).not.toMatch(/Review status: T-212 item/);
  });

  it('reads every finding in the review summary with a severity and a state', () => {
    const review = readFileSync(new URL('docs/reviews/2026-11-03-contract-review.md', root), 'utf8');
    const ids = [...review.matchAll(/^\| ([HML]-\d+) \|/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const f = data.findings.find((x: { id: string }) => x.id === id);
      expect(f, id).toBeDefined();
      expect(['high', 'medium', 'low', 'info']).toContain(f.severity);
      expect(['fixed', 'open', 'accepted', 'cut']).toContain(f.state);
      expect(f.text.length).toBeGreaterThan(10);
    }
  });

  it('takes a finding\'s state from docs/audit/known-issues.md when it lists one: fixed, or not in phase one (T-398)', () => {
    for (const id of ['L-4', 'L-6', 'L-8', 'I-2']) expect(data.findings.find((f: { id: string }) => f.id === id)?.state, id).toBe('fixed');
    for (const id of ['L-2', 'L-3', 'L-5']) expect(data.findings.find((f: { id: string }) => f.id === id)?.state, id).toBe('cut');
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

  it('finds every gas path it names in reports/differential-local.md, and the newest Sepolia smoke deal the deploy record or T-212 records', () => {
    for (const p of data.gas.paths) {
      expect(p.gas, p.fixture).toBeGreaterThan(0);
      expect(p.transactions, p.fixture).toBeGreaterThan(0);
    }
    expect(data.sepoliaGas?.total).toBe(data.sepoliaGas.fund + data.sepoliaGas.deliver + data.sepoliaGas.decide);
  });

  it('versions the page by the latest first-parent commit that touched its inputs, or null without the history', () => {
    for (const path of ['contracts/src/', 'contracts/lib', 'contracts/deployments/']) expect(INPUTS).toContain(path);
    const v = stackVersion();
    expect(data.version).toEqual(v);
    if (shallow()) {
      expect(v).toBeNull(); // CI's one-commit checkout: the console's job must fetch the history
      return;
    }
    expect(v?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(v?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // That commit's change against its first parent touches at least one input (a merge on main included).
    const cwd = new URL('.', root);
    const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', v.commit], { cwd, encoding: 'utf8' }).trim().split(' ');
    const args = parents.length > 1 ? ['diff', '--name-only', `${v.commit}^1`, v.commit] : ['show', '--name-only', '--format=', v.commit];
    const touched = execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(touched.some((f) => INPUTS.some((i: string) => (i.endsWith('/') ? f.startsWith(i) : f === i || f.startsWith(`${i}/`))))).toBe(true);
  });

  it('refuses a deployment record whose address is not an address', () => {
    for (const a of data.deployment.live.addresses) expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
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
