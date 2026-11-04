// The driver of the first full EVM end-to-end round on Sepolia (docs/tasks/T-216-evm-e2e-round-1.md). It runs the
// round's scenarios as real deals through the public API, plus direct contract calls from the round's own keys where
// the task says so, and prints each scenario's evidence. Test tokens only: it refuses every chain but Sepolia (and
// anvil, in its own tests). It prints addresses, never the secret or a key.
//
//   node --env-file-if-exists=.env examples/e2e-round.ts list
//   node --env-file-if-exists=.env examples/e2e-round.ts run <scenario ...|all> [--t220] [--no-homepage] [--rerun-after <why>]
//   node --env-file-if-exists=.env examples/e2e-round.ts finality <run folder>
//
// `run` writes one JSON record per scenario and summary.md to the checkout's reports/e2e-round-1/<UTC time>/ (E2E_OUT
// names another folder): public data only, the input to the round's report in docs/reviews/. `finality`, about 20
// minutes after the last run, re-reads every recorded transaction's block hash: a change is a reorg.
//
// Environment: E2E_SEPOLIA_SEED (for run; e2e-keys.ts makes it), HOLDBACK_OPERATORS (default the demo's two nodes),
// SEPOLIA_RPC_URL (default a public Sepolia node), HOLDBACK_DEPLOYMENT (a deployment file's JSON: anvil, in the tests).
// --t220 says T-220 has deployed T-217, T-218, T-219 and T-221; no API read shows T-218 or T-219.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatEther, type Hex } from 'viem';
import { SEPOLIA, type DeploymentFile } from './deployments.ts';
import { RoundChain } from './e2e-chain.ts';
import { printable, SEED_VAR } from './e2e-keys.ts';
import { openDeals, Round, Run, short, Waits } from './e2e-run.ts';
import { pick, SCENARIOS } from './e2e-scenarios.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const LIVE_OPERATORS = ['https://api.escrow.stream', 'https://api2.escrow.stream'];
const PUBLIC_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
/** The checkout's reports/e2e-round-1, from whatever folder the driver runs. */
const OUT = process.env['E2E_OUT'] || fileURLToPath(new URL('../reports/e2e-round-1', import.meta.url));

/** The checkout's commit, so each record names the driver that made it; "unknown" outside a git checkout. */
const commit = (): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const operators = () => (process.env['HOLDBACK_OPERATORS'] ? process.env['HOLDBACK_OPERATORS'].split(',') : LIVE_OPERATORS).map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const rpcUrl = () => process.env['SEPOLIA_RPC_URL'] || PUBLIC_RPC;
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '');

function list(): void {
  console.log('Round 1 scenarios (T-216). "waits for" names the tasks T-220 must deploy first.');
  for (const s of SCENARIOS) console.log(`  ${s.id.padEnd(3)} ${s.title}${s.waitsFor.length ? `; waits for ${s.waitsFor.join(', ')}` : ''}${s.needs ? `\n      needs: ${s.needs}` : ''}`);
}

/**
 * No re-rolls (T-216): once scenario 1's live panel has rejected honest work on this deployment, another deal to get
 * a pass is a re-roll. A re-run after a fix says which fix, and the record keeps it.
 */
function rerollGuard(rules: string | null, rerunAfter: string | undefined): void {
  if (!existsSync(OUT)) return;
  for (const dir of readdirSync(OUT)) {
    const file = join(OUT, dir, '1.json');
    if (!existsSync(file)) continue;
    const r = JSON.parse(readFileSync(file, 'utf8')) as J;
    const rejected = r.checks?.some((c: J) => c.name === 'the deal ends Released' && !c.ok) && r.checks?.some((c: J) => c.name === 'a live panel judged' && c.ok);
    if (rejected && String(r.deployment?.rules).toLowerCase() === String(rules).toLowerCase() && !rerunAfter) {
      throw new Refusal(`refusing: scenario 1's live panel rejected honest work in ${file}. A panel verdict is never re-rolled; record it as a finding. After a fix, re-run with --rerun-after "<the fix>"`);
    }
  }
}

/** The report's table: one row per scenario, then each deal's transactions with their links and gas. */
function summary(results: J[], round: Round): string {
  const lines = [
    `# Round 1 run, ${new Date().toISOString().slice(0, 16)}Z`,
    '',
    `Operators: ${round.status.map((s) => `${s.origin} (schema ${s.schemaVersion}, domain ${s.domain?.version})`).join(', ')}. Rules contract: ${round.chain?.deployment.rules ?? 'SimChain'} on chain ${round.pin.domain.chainId}. Driver at commit \`${results[0]?.driverCommit ?? 'unknown'}\`.`,
    '',
    '| Scenario | Result | Checks | Deals | Transactions | Gas |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of results) {
    const txs = r.deals.flatMap((d: J) => d.transactions);
    const gas = txs.reduce((s: bigint, t: J) => s + BigInt(t.gasUsed), 0n);
    lines.push(`| ${r.scenario}. ${r.title} | ${r.status}${r.waitsFor.length ? ` (${r.waitsFor.join(', ')})` : ''} | ${r.checks.filter((c: J) => c.ok).length} of ${r.checks.length} | ${r.deals.map((d: J) => `\`${short(d.id)}\``).join(', ') || 'none'} | ${txs.length} | ${gas.toLocaleString('en-US')} |`);
  }
  for (const r of results) {
    lines.push('', `## ${r.scenario}. ${r.title}: ${r.status}`, '');
    if (r.error) lines.push(`Stopped at ${r.stoppedAt}: ${r.error}`, '');
    for (const c of r.checks) lines.push(`- ${c.ok ? 'ok' : 'FAIL'}: ${c.name}. ${c.detail} [${c.label}]`);
    for (const d of r.deals) {
      lines.push('', `Deal ${d.label}: \`${d.id}\`, relayed by ${d.relay}.`, '');
      for (const t of d.transactions) lines.push(`- ${t.steps.join(', ')}: ${t.link}, ${Number(t.gasUsed).toLocaleString('en-US')} gas, block ${t.block}, sent by ${t.sentBy === 'round' ? 'the round' : 'an operator'}`);
      const after = d.balances.after ?? {};
      for (const [a, before] of Object.entries(d.balances.before as Record<string, J>)) {
        const now = after[a];
        if (now) lines.push(`- \`${short(a)}\`: token ${round.amount(BigInt(now.token) - BigInt(before.token))}, bond ${round.amount(BigInt(now.bond) - BigInt(before.bond))}, free bond ${round.amount(BigInt(now.free) - BigInt(before.free))}`);
      }
      for (const n of d.notes) lines.push(`- ${n}`);
    }
    for (const n of r.notes) lines.push(`- Note: ${n}`);
  }
  return `${lines.join('\n')}\n`;
}

async function run(ids: string[], flags: { t220: boolean; homepage: boolean; rerunAfter?: string }): Promise<number> {
  const scenarios = pick(ids);
  const seed = process.env[SEED_VAR];
  if (!seed) throw new Error(`${SEED_VAR} is not set; run with --env-file-if-exists=<file>, or make one with examples/e2e-keys.ts init <file>`);
  const ops = operators();
  const live = ops.join(',') === LIVE_OPERATORS.join(',');
  const round = await Round.open({ operators: ops, seed, rpcUrl: rpcUrl(), t220: flags.t220, homepage: flags.homepage, ...(live ? { trySeller: 'https://escrow.stream/agents/test-seller', tryBundleUrl: 'https://escrow.stream/try.mjs' } : {}) });
  console.log(`’crow round 1 on ${ops.join(' and ')}: test tokens only, nothing here is real money`);
  console.log(`domain ${round.pin.domain.name} ${round.pin.domain.version} on chain ${round.pin.domain.chainId}, rules ${round.pin.domain.verifyingContract}${round.chain ? ` (read through ${new URL(round.chain.rpcUrl).host})` : ' (SimChain: no chain to read)'}`);
  console.log(`operators serve schema ${round.status.map((s) => s.schemaVersion).join(' and ')}; demo club ${round.demo.clubId}, windows from ${round.demo.minWindowSec} s; adjudicators ${Object.entries(round.demo.adjudicators).map(([k, v]) => `${k} ${short(v)}`).join(', ')}`);
  for (const role of ['buyer', 'seller'] as const) {
    const a = round.address(role);
    console.log(`${role} ${a}${round.chain ? `: ${formatEther(await round.chain.ethBalance(a))} Sepolia ETH for its own direct calls and approvals` : ''}`);
  }
  if (scenarios.some((s) => s.id === '1')) rerollGuard(round.chain?.deployment.rules ?? null, flags.rerunAfter);
  const folder = join(OUT, stamp());
  const driverCommit = commit();
  mkdirSync(folder, { recursive: true });
  const results: J[] = [];
  let blocked: string | undefined;
  for (const s of scenarios) {
    const r = new Run(round, s.id, s.title);
    console.log(`\n[${s.id}] ${s.title}`);
    if (s.id === '1' && flags.rerunAfter) r.notes.push(`re-run after: ${flags.rerunAfter}`);
    try {
      if (blocked) throw new Error(`not run: ${blocked}`);
      await s.run(r);
    } catch (e) {
      r.error = printable(e);
      if (e instanceof Waits) r.waitsFor = e.tasks;
      console.log(`[${s.id}] ${e instanceof Waits ? 'waits' : 'stopped'} at ${r.step}: ${r.error}`);
      // Every deal has the same buyer and seller: one still holding money would settle inside the next scenario's window.
      const open = blocked || e instanceof Waits ? [] : await openDeals(r).catch(() => r.deals.map((d) => ({ id: d.id, state: 'unknown' })));
      if (open.length) blocked = `${open.map((d) => `${d.id} is still ${d.state}`).join('; ')}; let it settle before running more scenarios`;
    }
    const result = { driverCommit, ...r.result() };
    results.push(result);
    writeFileSync(join(folder, `${s.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`[${s.id}] ${result.status.toUpperCase()}: ${result.checks.filter((c: J) => c.ok).length} of ${result.checks.length} checks held${result.deals.length ? `; ${result.deals.map((d: J) => d.id).join(', ')}` : ''}`);
  }
  writeFileSync(join(folder, 'summary.md'), summary(results, round));
  console.log(`\nresults: ${results.map((r) => `${r.scenario} ${r.status}`).join(', ')}`);
  console.log(`evidence: ${join(folder, 'summary.md')} and one JSON record per scenario`);
  return results.some((r) => r.status === 'fail' || r.status === 'error') ? 1 : 0;
}

/** Re-reads the block hash of every transaction a run recorded; a changed or missing one is a reorg. */
async function finality(folder: string): Promise<number> {
  const records = readdirSync(folder).filter((f) => f.endsWith('.json') && f !== 'finality.json').map((f) => JSON.parse(readFileSync(join(folder, f), 'utf8')) as J);
  const rules = records.find((r) => r.deployment?.rules)?.deployment.rules;
  if (!rules) throw new Error(`${folder} holds no run on a chain`);
  const env = process.env['HOLDBACK_DEPLOYMENT'];
  const deployment = [SEPOLIA, env ? (JSON.parse(env) as DeploymentFile) : null].find((d) => d && d.rules.toLowerCase() === String(rules).toLowerCase());
  if (!deployment) throw new Error(`no deployment file pins the rules contract ${rules}`);
  const chain = await RoundChain.open(rpcUrl(), deployment, records[0]?.deployment?.explorer ?? undefined);
  const rows: J[] = [];
  for (const r of records) for (const d of r.deals) for (const t of d.transactions) {
    try {
      const now = await chain.blockHashOf(t.tx as Hex);
      rows.push({ scenario: r.scenario, deal: d.id, tx: t.tx, block: t.block, recorded: t.blockHash, now, same: now === t.blockHash });
    } catch (e) {
      rows.push({ scenario: r.scenario, deal: d.id, tx: t.tx, block: t.block, recorded: t.blockHash, unreadable: printable(e) });
    }
  }
  const unreadable = rows.filter((x) => x.unreadable);
  const changed = rows.filter((x) => !x.unreadable && !x.same);
  const head = await chain.client.getBlockNumber();
  writeFileSync(join(folder, 'finality.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), head: head.toString(), rows }, null, 2)}\n`);
  console.log(`finality at block ${head}: ${rows.length} transactions re-read, ${rows.length - changed.length - unreadable.length} in the same block, ${changed.length} changed, ${unreadable.length} unreadable`);
  for (const x of changed) console.log(`  REORG? scenario ${x.scenario}, ${x.tx}: block ${x.block} was ${x.recorded}, now ${x.now ?? 'no receipt'}`);
  for (const x of unreadable) console.log(`  could not read scenario ${x.scenario}, ${x.tx}: ${x.unreadable}; run finality again`);
  return changed.length || unreadable.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const at = rest.indexOf('--rerun-after');
  const rerunAfter = at >= 0 ? rest[at + 1] : undefined;
  const ids = rest.filter((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
  try {
    if (cmd === 'list') list();
    else if (cmd === 'run' && ids.length) process.exitCode = await run(ids, { t220: rest.includes('--t220'), homepage: !rest.includes('--no-homepage'), ...(rerunAfter ? { rerunAfter } : {}) });
    else if (cmd === 'finality' && ids.length === 1) process.exitCode = await finality(ids[0]!);
    else {
      console.error('usage: node --env-file-if-exists=.env examples/e2e-round.ts <list | run <scenario ...|all> [--t220] [--no-homepage] [--rerun-after <why>] | finality <run folder>>');
      process.exitCode = 2;
    }
  } catch (e) {
    // A refusal or a stop: say why, never a key.
    console.error(`${e instanceof Refusal ? 'refused' : 'stopped'}: ${printable(e)}`);
    process.exitCode = e instanceof Refusal ? 3 : 1;
  }
}
