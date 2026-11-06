// The driver of the first full EVM end-to-end round on Sepolia (docs/tasks/T-216-evm-e2e-round-1.md). It runs the
// round's scenarios as real deals through the public API, plus direct contract calls from the round's own keys where
// the task says so, and prints each scenario's evidence. Test tokens only: it refuses every chain but Sepolia (and
// anvil, in its own tests). It prints addresses, never the secret or a key.
//
//   node --env-file-if-exists=.env examples/e2e-round.ts list
//   node --env-file-if-exists=.env examples/e2e-round.ts run <scenario ...|all> [--t220] [--no-homepage] [--rerun-after <why>]
//   node --env-file-if-exists=.env examples/e2e-round.ts finality <run folder>
//   node --env-file-if-exists=.env examples/e2e-round.ts settle <commitmentId> [--to-buyer|--to-seller] [--dry-run]
//
// `run` writes one JSON record per scenario and summary.md to the checkout's reports/e2e-round-1/<UTC time>/ (E2E_OUT
// names another folder): public data only, the input to the round's report in docs/reviews/. `finality`, about 20
// minutes after the last run, re-reads every recorded transaction's block hash: a change is a reorg. `settle` closes one
// of the round's own open deals by a MutualSettlement both round keys sign, the price back to the buyer by default
// (e2e-settle.ts); `--dry-run` prints the message and signs nothing.
//
// Environment: E2E_SEPOLIA_SEED (for run and settle; e2e-keys.ts makes it), HOLDBACK_OPERATORS (default the demo's two nodes),
// SEPOLIA_RPC_URL (default a public Sepolia node), HOLDBACK_DEPLOYMENT (a deployment file's JSON: anvil, in the tests).
// --t220 says T-220 has deployed T-217, T-218, T-219 and T-221; no API read shows T-218 or T-219.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatEther, type Hex } from 'viem';
import { SEPOLIA, type DeploymentFile } from './deployments.ts';
import { RoundChain } from './e2e-chain.ts';
import { roundAddresses, ROLES, SEED_VAR } from './e2e-keys.ts';
import { heldDeals, otherRunDeals, reason, refuseActive, releaseLock, retry, Round, Run, settleOpen, sharedReports, short, takeLock, Waits } from './e2e-run.ts';
import { pick, SCENARIOS } from './e2e-scenarios.ts';
import { parseSettle, settleDeal } from './e2e-settle.ts';
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
const USAGE = 'usage: node --env-file-if-exists=.env examples/e2e-round.ts <list | run <scenario ...|all> [--t220] [--no-homepage] [--rerun-after <why>] | finality <run folder> | settle <commitmentId> [--to-buyer|--to-seller] [--dry-run]>';

/** The round's seed, from the environment; never printed. */
function seedOf(): string {
  const seed = process.env[SEED_VAR];
  if (!seed) throw new Error(`${SEED_VAR} is not set; run with --env-file-if-exists=<file>, or make one with examples/e2e-keys.ts init <file>`);
  return seed;
}

/**
 * Where the round's lock lives: the clone's shared reports folder, so every worktree meets it (round 1's 2026-11-05
 * runs overlapped); E2E_OUT, as the tests set it, keeps it there.
 */
const lockDir = () => (process.env['E2E_OUT'] ? OUT : (sharedReports(fileURLToPath(new URL('.', import.meta.url))) ?? OUT));

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
      const by = (s: string) => (s === 'round' ? 'the round' : s === 'chain' ? "a sender neither operator's events name" : 'an operator');
      for (const t of d.transactions) lines.push(`- ${t.steps.join(', ')}: ${t.link}, ${Number(t.gasUsed).toLocaleString('en-US')} gas, block ${t.block}, sent by ${by(t.sentBy)}`);
      const after = d.balances.after ?? {};
      const line = (x: { token: bigint; bond: bigint; free: bigint }) => `token ${round.amount(x.token)}, bond ${round.amount(x.bond)}, free bond ${round.amount(x.free)}`;
      for (const [a, before] of Object.entries(d.balances.before as Record<string, J>)) {
        const now = after[a];
        const wallet = now ? { token: BigInt(now.token) - BigInt(before.token), bond: BigInt(now.bond) - BigInt(before.bond), free: BigInt(now.free) - BigInt(before.free) } : null;
        const own = d.flows?.[a] ? { token: BigInt(d.flows[a].token), bond: BigInt(d.flows[a].bond), free: BigInt(d.flows[a].free) } : null;
        // On a chain the deal's own transfers and bond events are the evidence; the wallet's change across the deal
        // can take in another deal of the same party, and is shown only when it differs.
        if (own) lines.push(`- \`${short(a)}\`: this deal moved ${line(own)}${wallet && line(wallet) !== line(own) ? `; the address changed by ${line(wallet)} over the deal, other deals included` : ''}`);
        else if (wallet) lines.push(`- \`${short(a)}\`: ${line(wallet)}`);
      }
      for (const n of d.notes) lines.push(`- ${n}`);
    }
    for (const n of r.notes) lines.push(`- Note: ${n}`);
  }
  return `${lines.join('\n')}\n`;
}

async function run(ids: string[], flags: { t220: boolean; homepage: boolean; rerunAfter?: string }): Promise<number> {
  const scenarios = pick(ids);
  const seed = seedOf();
  const keys = roundAddresses(seed);
  const folder = join(OUT, stamp());
  // One run of the round's keys at a time, before any network call.
  const { lock, tookOver } = takeLock(lockDir(), keys.master, { folder });
  if (tookOver) console.log(tookOver);
  try {
    return await runLocked(scenarios, seed, keys, folder, flags);
  } finally {
    releaseLock(lock);
  }
}

async function runLocked(scenarios: ReturnType<typeof pick>, seed: string, keys: ReturnType<typeof roundAddresses>, folder: string, flags: { t220: boolean; homepage: boolean; rerunAfter?: string }): Promise<number> {
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
  // A run from another checkout takes no lock here, but its sends show as pending on the round's keys.
  if (round.chain) await round.chain.untilIdle(Object.fromEntries(ROLES.filter((k) => k !== 'master').map((k) => [k, keys[k]])));
  const since = await retry(() => round.agent('master').settlementNow());
  // An earlier run's deal that still holds money is closed by its timeouts first, within the gate's wait; one that
  // changed in the last 2 minutes may be another run's, still in progress.
  const start = new Run(round, 'start', 'before the first scenario');
  const held = await heldDeals(start);
  refuseActive(held, since);
  const earlier = await settleOpen(start, held).catch((e) => {
    throw new Refusal(`refusing to start: ${reason(e).replace(/; run the remaining scenarios (after then|once it settles)$/, '')}; run the round again once it has settled`);
  });
  const driverCommit = commit();
  mkdirSync(folder, { recursive: true });
  const results: J[] = [];
  const ours = new Set<string>();
  let blocked: string | undefined;
  for (const s of scenarios) {
    const r = new Run(round, s.id, s.title);
    console.log(`\n[${s.id}] ${s.title}`);
    if (s.id === '1' && flags.rerunAfter) r.notes.push(`re-run after: ${flags.rerunAfter}`);
    if (results.length === 0) for (const line of earlier) r.notes.push(`before the first scenario: ${line}`);
    try {
      if (blocked) throw new Error(`not run: ${blocked}`);
      await s.run(r);
    } catch (e) {
      r.error = reason(e);
      if (e instanceof Waits) r.waitsFor = e.tasks;
      console.log(`[${s.id}] ${e instanceof Waits ? 'waits' : 'stopped'} at ${r.step}: ${r.error}`);
    }
    for (const d of r.deals) ours.add(d.id.toLowerCase());
    // The record goes to disk before the gate's wait, so a stop during it keeps the scenario, and again after it with
    // the gate's notes; its end time stays the scenario's own.
    const ended = new Date().toISOString();
    const index = results.length;
    const save = () => {
      results[index] = { driverCommit, ...r.result(ended) };
      writeFileSync(join(folder, `${s.id}.json`), `${JSON.stringify(results[index], null, 2)}\n`);
      writeFileSync(join(folder, 'summary.md'), summary(results, round));
    };
    save();
    if (!blocked) {
      blocked = await between(r, ours, since);
      save();
    }
    const result = results[index];
    console.log(`[${s.id}] ${result.status.toUpperCase()}: ${result.checks.filter((c: J) => c.ok).length} of ${result.checks.length} checks held${result.deals.length ? `; ${result.deals.map((d: J) => d.id).join(', ')}` : ''}`);
  }
  writeFileSync(join(folder, 'summary.md'), summary(results, round));
  console.log(`\nresults: ${results.map((r) => `${r.scenario} ${r.status}`).join(', ')}`);
  console.log(`evidence: ${join(folder, 'summary.md')} and one JSON record per scenario`);
  return results.some((r) => r.status === 'fail' || r.status === 'error') ? 1 : 0;
}

/**
 * The gate after a scenario. A deal it left holding money (it stopped, or failed a check before its end) is closed by
 * its timeouts through the API, within SETTLE_WAIT_MS; then a deal of the round's buyer that another run offered since
 * this run started stops the rest, since two runs of the same keys count each other's deals and their adjudicators
 * act on each other's deals. Returns why the remaining scenarios cannot run, or undefined. Its steps go into the
 * scenario's record.
 */
async function between(r: Run, ours: ReadonlySet<string>, since: number): Promise<string | undefined> {
  if (r.deals.length) {
    try {
      for (const line of await settleOpen(r, r.deals)) r.notes.push(`after the scenario: ${line}`);
    } catch (e) {
      r.note(`after the scenario: ${reason(e)}`);
      return reason(e);
    }
  }
  const others = await otherRunDeals(r, ours, since).catch((e) => {
    r.note(`after the scenario: the check for another run's deals could not read the operators' list (${reason(e)})`);
    return [];
  });
  if (!others.length) return undefined;
  const why = `another run is using the round's keys: ${others.map((d) => `${d.id} (${d.state}, offered ${d.createdAt})`).join('; ')} was offered after this run started at ${new Date(since).toISOString().replace(/\.\d+Z$/, 'Z')}, and this run did not offer it. Two runs of the same keys count each other's deals; let the other run end, then run the remaining scenarios`;
  r.note(`after the scenario: ${why}`);
  return why;
}

/**
 * Closes one of the round's own open deals by a MutualSettlement both round keys sign (e2e-settle.ts). It holds the
 * round's lock while it signs and sends, as a run does; a dry run only reads, and takes none.
 */
async function settle(args: string[]): Promise<number> {
  const parsed = parseSettle(args);
  if ('error' in parsed) {
    console.error(`usage error: ${parsed.error}`);
    console.error(USAGE);
    return 2;
  }
  const seed = seedOf();
  const held = parsed.dryRun ? undefined : takeLock(lockDir(), roundAddresses(seed).master, { folder: `settle ${parsed.id}` });
  if (held?.tookOver) console.log(held.tookOver);
  try {
    const ops = operators();
    const round = await Round.open({ operators: ops, seed, rpcUrl: rpcUrl() });
    console.log(`’crow round 1, settle on ${ops.join(' and ')}: test tokens only, nothing here is real money`);
    return await settleDeal(round, parsed.id, parsed);
  } finally {
    if (held) releaseLock(held.lock);
  }
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
      rows.push({ scenario: r.scenario, deal: d.id, tx: t.tx, block: t.block, recorded: t.blockHash, unreadable: reason(e) });
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
    else if (cmd === 'settle') process.exitCode = await settle(rest);
    else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } catch (e) {
    // A refusal or a stop: say why, never a key.
    console.error(`${e instanceof Refusal ? 'refused' : 'stopped'}: ${reason(e)}`);
    process.exitCode = e instanceof Refusal ? 3 : 1;
  }
}
