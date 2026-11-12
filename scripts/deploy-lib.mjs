// What the three deploys share (T-313): `pnpm demo-cloud:deploy` (the operators), apps/test-agents/scripts/deploy.mjs
// (the test seller) and `pnpm site:deploy` (the site). Each one runs the pre-flight, reads the live version as its
// rollback target, uploads, checks what is live, rolls back on a failed check, and prints one record line. The checks
// themselves differ and stay with each deploy.
//
// Every function that runs a command takes the runner as its last argument, so a test passes a stand-in for the
// shell: no test runs wrangler.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WRANGLER = ['-y', 'wrangler@4'];

/**
 * Runs a command from the repository root, shows its output unless told not to, and keeps it.
 * @returns {Promise<{ code: number | null, stdout: string, out: string }>} `out` is stdout and stderr together; the
 *   code is null after a timeout.
 */
export function sh(cmd, args, { show = true, env = {}, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', out = '';
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const done = (code) => (clearTimeout(timer), resolve({ code, stdout, out }));
    child.stdout.on('data', (d) => {
      stdout += d;
      out += d;
      if (show) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += d;
      if (show) process.stderr.write(d);
    });
    child.on('error', (e) => {
      out += e.message;
      done(1);
    });
    child.on('close', (code, signal) => done(signal ? null : code));
  });
}

/**
 * The version that serves all of a Worker's traffic.
 * @param {string} stdout what `wrangler deployments status --json` printed
 * @returns {string | null} null when wrangler does not say: it is logged out, the Worker does not exist, or two
 *   versions split the traffic.
 */
export function versionAt100(stdout) {
  try {
    const v = JSON.parse(stdout).versions;
    return v.length === 1 && v[0].percentage === 100 && typeof v[0].version_id === 'string' ? v[0].version_id : null;
  } catch {
    return null;
  }
}

/** The version the Worker `name` serves to all traffic, or null when wrangler cannot say. */
export async function liveVersion(name, run = sh) {
  return versionAt100((await run('npx', [...WRANGLER, 'deployments', 'status', '--name', name, '--json'], { show: false })).stdout);
}

/**
 * Puts the Worker `name` back on `version`.
 * @returns {Promise<boolean>} true when wrangler accepted the rollback and the Worker serves `version` again.
 */
export async function rollback(name, version, message, run = sh) {
  const r = await run('npx', [...WRANGLER, 'rollback', version, '--name', name, '--message', message, '--yes']);
  return r.code === 0 && (await liveVersion(name, run)) === version;
}

const lastLine = (out) => String(out ?? '').trim().split('\n').at(-1)?.trim() ?? '';
const said = (out) => (lastLine(out) ? ` (${lastLine(out)})` : '');

/**
 * The pre-flight decision, as a pure function. Wrangler uploads whatever tree is checked out. A tracked change makes
 * the upload differ from the commit the record line names, and a checkout without main's commits can upload an old
 * wrangler file and drop the custom domains (docs/operations.md). Untracked files are fine: the builds read tracked
 * sources.
 *
 * @param {{
 *   command: string,
 *   branch: string,
 *   status: { code: number | null, out: string },
 *   fetch: { code: number | null, out: string },
 *   ancestor: { code: number | null, out: string },
 * }} facts `command` is the deploy to run again, as its user types it; `branch` is `git branch --show-current` (empty
 *   on a detached HEAD); `status` is `git status --porcelain --untracked-files=no --ignore-submodules=dirty`; `fetch` is `git fetch origin main`;
 *   `ancestor` is `git merge-base --is-ancestor origin/main HEAD`. A code of null means the command timed out.
 * @returns {string | null} null when the deploy may go on; otherwise the one sentence that refuses it.
 */
export function preflight({ command, branch, status, fetch, ancestor }) {
  if (status.code !== 0) return `Refused: git status failed${said(status.out)}, so the deploy cannot tell whether tracked files differ from the commit; run it from the repository's checkout.`;
  const changed = status.out.split('\n').filter((l) => l.trim()).map((l) => l.slice(3));
  if (changed.length > 0) {
    const shown = changed.slice(0, 5).join(', ') + (changed.length > 5 ? ` and ${changed.length - 5} more` : '');
    return `Refused: ${changed.length} tracked ${changed.length === 1 ? 'file differs' : 'files differ'} from the checked-out commit (${shown}), so the upload would not match the commit the record names; commit or stash the change, then run ${command} again.`;
  }
  if (fetch.code !== 0) return `Refused: \`git fetch origin main\` failed${said(fetch.out)}, so the deploy cannot tell whether this checkout holds main's commits; check the network and the origin remote, then run ${command} again.`;
  const here = branch ? `branch \`${branch}\`` : 'this detached checkout';
  if (ancestor.code === 1) return `Refused: ${here} lacks commits from origin/main, and a deploy without them can drop the custom domains; merge or rebase onto origin/main, then run ${command} again.`;
  if (ancestor.code !== 0) return `Refused: git cannot compare this checkout with origin/main${said(ancestor.out)}, so the deploy cannot tell whether it holds main's commits; run it from a checkout whose origin is the repository.`;
  return null;
}

/**
 * Reads the checkout with git and runs the pre-flight on it.
 * @param {string} command the deploy to run again, as its user types it
 * @returns {Promise<{ refused: string | null, branch: string, commit: string }>} `refused` is the sentence that
 *   refuses the deploy, or null; `branch` is empty on a detached HEAD; `commit` is HEAD's full hash.
 */
export async function checkout(command, run = sh) {
  const git = async (...args) => {
    const r = await run('git', args, { show: false, env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 120_000 });
    return { code: r.code, out: r.out, stdout: r.stdout.trim() };
  };
  const branch = (await git('branch', '--show-current')).stdout;
  const refused = preflight({
    command,
    branch,
    // A changed or untracked file inside a submodule is ignored: no deploy uploads anything from one (contracts/lib),
    // and such a file refused the first deploy from the main checkout (2026-11-11). A moved submodule commit still counts.
    status: await git('status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty'),
    fetch: await git('fetch', 'origin', 'main'),
    ancestor: await git('merge-base', '--is-ancestor', 'origin/main', 'HEAD'),
  });
  return { refused, branch, commit: (await git('rev-parse', 'HEAD')).stdout };
}

/**
 * The Markdown line for docs/operations.md.
 * @param {{
 *   title: string,
 *   startedAt: Date,
 *   commit: string,
 *   branch?: string,
 *   failure: string | null,
 *   workers: { name: string, version?: string | null, before?: string | null, rolledBack?: boolean }[],
 *   note?: string,
 * }} run `title` opens the line ("Deploy"); the line names the branch when `branch` is given (empty: a detached
 *   HEAD); `rolledBack` is true or false after a rollback was tried; `note` follows the versions.
 */
export function recordLine({ title, startedAt, commit, branch, failure, workers, note = '' }) {
  const when = `${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const on = branch === undefined ? '' : ` on ${branch ? `branch \`${branch}\`` : 'a detached HEAD'}`;
  const versions = workers.map((w) => {
    const back = w.rolledBack === true ? ', rolled back' : w.rolledBack === false ? ', ROLLBACK FAILED' : '';
    return `${w.name} \`${w.version ?? 'not deployed'}\` (rollback target \`${w.before ?? 'unknown'}\`${back})`;
  });
  return `**${title} ${when}, commit \`${commit.slice(0, 7) || 'unknown'}\`${on}: ${failure ? `FAIL, ${failure}` : 'pass'}.** ${versions.join(', ')}.${note}`;
}

/**
 * Waits until every node's discovery (`GET <node>/`) names `commit` as `demo.build.commit`, so a check that follows
 * runs against the code just deployed. The World Durable Object kept serving the previous instance for about five
 * minutes after a new version reached 100% (T-370, measured 2026-11-12), and /v1/status answers 200 all the while.
 * A read that fails, times out or is not JSON counts as not yet.
 * @param {{ nodes: string[], commit: string, deadline: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>,
 *   now?: () => number, everyMs?: number }} o
 * @returns {Promise<{ failure: string | null, seconds: number }>} `failure` is null once every node names the commit;
 *   `seconds` is how long the wait took.
 */
export async function waitForCommit({ nodes, commit, deadline, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, everyMs = 5000 }) {
  const start = now();
  const seconds = () => Math.round((now() - start) / 1000);
  if (!/^[0-9a-f]{40}$/.test(String(commit))) return { failure: `the deploy has no commit to look for in discovery (got ${JSON.stringify(String(commit).slice(0, 60))})`, seconds: 0 };
  for (const node of nodes) {
    let seen = null;
    for (;;) {
      seen = await fetchImpl(`${node}/`, { signal: AbortSignal.timeout(30_000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (typeof d?.demo?.build?.commit === 'string' ? d.demo.build.commit : null), () => null);
      if (seen === commit) break;
      if (now() > deadline) return { failure: `${node} still names commit ${seen ? seen.slice(0, 7) : 'none'} in discovery, not ${commit.slice(0, 7)}, after ${seconds()} s`, seconds: seconds() };
      await sleep(everyMs);
    }
  }
  return { failure: null, seconds: seconds() };
}

// ---------------------------------------------------------------------------------------------------------------------
// The deploy guard (ADR-0036 section 4, T-377). Before any upload, `pnpm demo-cloud:deploy` refuses a deploy after
// which an open deal the live build can judge could no longer be judged. It reads the live build's kept-policies file
// at the commit discovery names, the open deals from the public reads, and asks of each deal what the adjudicator's
// binding asks: is each of the bound policy's four values, and the bound registry, carried and not withdrawn? It
// restricts only the operator: it refuses nothing a party sends, and a party cannot block a deploy through it, since
// it refuses only what the new build dropped.

/** The escrow states from the primary's acceptance until the first decision; Released and Refunded count while an appeal is open or may still be filed. */
export const OPEN_STATES = ['AcceptedByAdjudicator', 'Agreed', 'Held', 'Delivered', 'FallbackJudging', 'Escalated'];
export const APPEALABLE_STATES = ['Released', 'Refunded'];

const VERSION_FIELDS = ['screenVersion', 'promptTemplateHash', 'appealPromptTemplateHash', 'aggregationVersion'];

/**
 * What a build carries, from its kept-policies file: the values marked kept, and the withdrawn ones by label.
 * A build whose commit predates the file carries exactly its registered defaults: `fallback` lists them.
 */
export function carriedBy(kept, fallback = []) {
  if (!kept) {
    return {
      screens: new Set(fallback.map((p) => p.policy.screenVersion)),
      pairs: new Set(fallback.map((p) => `${p.policy.promptTemplateHash}/${p.policy.appealPromptTemplateHash}`)),
      aggregations: new Set(fallback.map((p) => p.policy.aggregationVersion)),
      registries: new Set(fallback.map((p) => p.registryHash)),
      withdrawn: new Map(),
    };
  }
  const keptOnly = (xs, key) => new Set(xs.filter((x) => x.status === 'kept').map(key));
  const withdrawn = new Map();
  for (const s of kept.screens) if (s.status === 'withdrawn') withdrawn.set(s.version, s.decision);
  for (const p of kept.templatePairs) if (p.status === 'withdrawn') withdrawn.set(`${p.promptTemplateHash}/${p.appealPromptTemplateHash}`, p.decision);
  for (const a of kept.aggregations) if (a.status === 'withdrawn') withdrawn.set(a.version, a.decision);
  for (const r of kept.registries) if (r.status === 'withdrawn') withdrawn.set(r.hash, r.decision);
  return {
    screens: keptOnly(kept.screens, (s) => s.version),
    pairs: keptOnly(kept.templatePairs, (p) => `${p.promptTemplateHash}/${p.appealPromptTemplateHash}`),
    aggregations: keptOnly(kept.aggregations, (a) => a.version),
    registries: keptOnly(kept.registries, (r) => r.hash),
    withdrawn,
  };
}

/** The values of a policy and a registry that `carried` lacks, by label; empty when it can judge. */
export function missingFrom(carried, versions, registryHash) {
  const pair = `${versions.promptTemplateHash}/${versions.appealPromptTemplateHash}`;
  const out = [];
  if (!carried.screens.has(versions.screenVersion)) out.push(versions.screenVersion);
  if (!carried.pairs.has(pair)) out.push(`template pair ${versions.promptTemplateHash.slice(0, 10)}`);
  if (!carried.aggregations.has(versions.aggregationVersion)) out.push(versions.aggregationVersion);
  if (!carried.registries.has(registryHash)) out.push(`registry ${registryHash.slice(0, 10)}`);
  return out;
}

/**
 * Every policy hash a deal at these adjudicators could bind, mapped to its four values: each registered policy with
 * its version fields set to each combination either file lists. A deal binding a hash outside the index names a policy
 * neither build registered (an outside primary's), which the guard cannot read and reports as unchecked.
 */
export function policyIndex({ registrations, files, hashOf }) {
  const screens = new Set(), pairs = new Set(), aggregations = new Set();
  // Every set of the other policy fields a released default used (kept-policies.json `policyParams`), so a deal accepted
  // before a change of, say, judgeTimeoutSec is still indexed (T-377 red team M6).
  const params = new Map();
  for (const f of files.filter(Boolean)) for (const p of f.policyParams ?? []) params.set(JSON.stringify(p.params), p.params);
  for (const f of files.filter(Boolean)) {
    for (const s of f.screens) screens.add(s.version);
    for (const p of f.templatePairs) pairs.add(`${p.promptTemplateHash}/${p.appealPromptTemplateHash}`);
    for (const a of f.aggregations) aggregations.add(a.version);
  }
  for (const r of registrations) {
    screens.add(r.policy.screenVersion);
    pairs.add(`${r.policy.promptTemplateHash}/${r.policy.appealPromptTemplateHash}`);
    aggregations.add(r.policy.aggregationVersion);
  }
  const index = new Map();
  for (const r of registrations)
    for (const p of [r.policy, ...params.values()])
      for (const screenVersion of screens)
        for (const pair of pairs)
          for (const aggregationVersion of aggregations) {
            const [promptTemplateHash, appealPromptTemplateHash] = pair.split('/');
            const versions = { screenVersion, promptTemplateHash, appealPromptTemplateHash, aggregationVersion };
            index.set(hashOf({ ...r.policy, ...p, id: r.policy.id, ...versions }), versions);
          }
  return index;
}

/**
 * The guard's decision, a pure function.
 * @param {{ live: { kept: object | null, registrations: Array<{ policy: object, registryHash: string }> },
 *   next: object, deals: Array<{ id: string, state: string, nextDeadline?: string, policyHash: string, registryHash: string }> | null,
 *   readError?: string, hashOf: (policy: object) => string, override?: string | null }} facts `next` is the kept file of
 *   the build about to deploy; `deals` is null when the open deals could not be read; `override` names one value the
 *   next file marks withdrawn (HOLDBACK_DEPLOY_WITHDRAWN).
 * @returns {{ refused: string | null, warnings: string[], orphans: object[], withdrawnOrphans: object[] }}
 */
export function guardDecision({ live, next, deals, readError, hashOf, override = null }) {
  const warnings = [];
  const liveCarries = carriedBy(live.kept, live.registrations);
  const nextCarries = carriedBy(next);
  // A build judges only under a registry it has a provider for, and a deploy keeps the Worker's secrets: so both builds
  // reach exactly the registries the live adjudicators use now, less what the file marks out (T-377 red team M3).
  const reached = new Set(live.registrations.map((r) => r.registryHash));
  if (reached.size) for (const c of [liveCarries, nextCarries]) c.registries = new Set([...c.registries].filter((h) => reached.has(h)));
  const refuse = (why) => ({ refused: `Refused: ${why}`, warnings, orphans: [], withdrawnOrphans: [] });
  const blind = (why) => {
    warnings.push(`WARNING: the open deals could not be read (${why}); the guard checked the kept-policies files only. Check the deals by hand if this deploy is not the fix for that outage (docs/operations.md, The deal guard).`);
    return { refused: null, warnings, orphans: [], withdrawnOrphans: [] };
  };
  // The override names one recorded withdrawal and nothing else.
  if (override !== null && !nextCarries.withdrawn.has(override)) {
    return refuse(`HOLDBACK_DEPLOY_WITHDRAWN names ${JSON.stringify(override)}, which kept-policies.json does not mark withdrawn with a decision; record the withdrawal first (ADR-0036 section 2), or unset it.`);
  }
  // Without the live build's kept file or its registrations, what it carries is unknown: warn, never refuse on a guess
  // (T-377 red team M4).
  if (deals === null && !live.kept && !live.registrations.length) return blind(readError ?? 'no reason given');
  // A new default ships in two deploys: carried first, default second. So a rollback always lands on a build that can
  // judge every deal accepted under the new default.
  const lacking = missingFrom(liveCarries, next.default, [...liveCarries.registries][0] ?? '').filter((m) => !m.startsWith('registry '));
  if (lacking.length) {
    return refuse(`the new default names ${lacking.join(', ')}, which the live build does not carry, so a rollback could not judge a deal accepted under it. Ship it in two deploys: first a build that carries it, then one that makes it the default (ADR-0036 section 4).`);
  }
  if (deals === null) return blind(readError ?? 'no reason given');
  const index = policyIndex({ registrations: live.registrations, files: [live.kept, next], hashOf });
  const orphans = [], withdrawnOrphans = [], unknown = [];
  const ours = new Set(live.registrations.map((r) => String(r.address ?? '').toLowerCase()).filter(Boolean));
  for (const d of deals) {
    const versions = index.get(d.policyHash);
    if (!versions) {
      // A deal this operator's own primary accepted must bind a policy the index names; if it does not, the guard cannot
      // tell what it binds, so it refuses rather than guess (T-377 red team M6). An outside primary's policy is reported.
      if (d.primary && ours.has(String(d.primary).toLowerCase())) unknown.push(d);
      else warnings.push(`WARNING: deal ${d.id} (${d.state}) binds policy ${d.policyHash}, which an adjudicator this operator does not run registered; not checked.`);
      continue;
    }
    if (missingFrom(liveCarries, versions, d.registryHash).length) continue; // the live build cannot judge it either
    const missing = missingFrom(nextCarries, versions, d.registryHash);
    if (!missing.length) continue;
    const pair = `${versions.promptTemplateHash}/${versions.appealPromptTemplateHash}`;
    const marked = [versions.screenVersion, pair, versions.aggregationVersion, d.registryHash].filter((k) => nextCarries.withdrawn.has(k));
    const row = { ...d, missing };
    // Under the override, a deal orphaned only by that withdrawal goes through; every other orphan still refuses.
    const onlyOverride = override !== null && marked.length === missing.length && marked.every((k) => k === override);
    (onlyOverride ? withdrawnOrphans : orphans).push(row);
  }
  if (unknown.length) {
    const lines = unknown.map((o) => `  ${o.id} ${o.state}, next deadline ${o.nextDeadline ?? 'unknown'}: binds policy ${o.policyHash}`);
    return { refused: `Refused: ${unknown.length} open deal${unknown.length === 1 ? '' : 's'} this operator's primary accepted bind${unknown.length === 1 ? 's' : ''} a policy no kept version and no released policyParams entry in kept-policies.json produce, so the guard cannot tell what ${unknown.length === 1 ? 'it binds' : 'they bind'}:\n${lines.join('\n')}\nAdd the released policy's other fields to policyParams (ADR-0036 section 4).`, warnings, orphans: unknown, withdrawnOrphans };
  }
  if (orphans.length) {
    const lines = orphans.map((o) => `  ${o.id} ${o.state}, next deadline ${o.nextDeadline ?? 'unknown'}: the new build does not carry ${o.missing.join(', ')}`);
    return { refused: `Refused: after this deploy the adjudicators could not judge ${orphans.length} open deal${orphans.length === 1 ? '' : 's'} the live build can judge:\n${lines.join('\n')}\nKeep the version in kept-policies.json and the code, or record its withdrawal and set HOLDBACK_DEPLOY_WITHDRAWN to it (ADR-0036 sections 2 and 4).`, warnings, orphans, withdrawnOrphans };
  }
  return { refused: null, warnings, orphans, withdrawnOrphans, checked: deals.length };
}

/** The four version values of a policy. */
export const versionsOf = (policy) => Object.fromEntries(VERSION_FIELDS.map((k) => [k, policy[k]]));

/**
 * Reads the open deals at this operator's adjudicators through the public reads (T-367's Handoff): the adjudicator
 * listing, each one's open deals, and each deal's terms for its policy and registry hashes. Any failed read throws.
 * @returns {Promise<{ registrations: Array<{ address: string, policy: object, registryHash: string }>, deals: object[] }>}
 */
export async function readOpenDeals(node, fetchImpl = fetch) {
  const get = async (path) => {
    const r = await fetchImpl(`${node}${path}`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`GET ${path} answered ${r.status}`);
    return r.json();
  };
  const pages = async (path) => {
    const items = [];
    for (let cursor = null, n = 0; n < 1000; n++) {
      const page = await get(`${path}${cursor ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`);
      items.push(...(page.items ?? []));
      if (!page.nextCursor) return items;
      cursor = page.nextCursor;
    }
    throw new Error(`${path} has more than 1000 pages`);
  };
  const listing = await pages('/v1/adjudicators?limit=200');
  const discovery = await get('/');
  const ours = new Set(Object.values(discovery?.demo?.adjudicators ?? []).map((a) => String(a.address).toLowerCase()));
  const registrations = listing
    .filter((a) => ours.size === 0 || ours.has(String(a.address).toLowerCase()))
    .map((a) => ({ address: String(a.address).toLowerCase(), policy: a.policy, registryHash: a.registry?.hash }));
  const seen = new Map();
  for (const a of registrations) {
    const states = [...OPEN_STATES, ...APPEALABLE_STATES].map((s) => `escrowState=${s}`).join('&');
    for (const v of await pages(`/v1/commitments?party=${a.address}&role=adjudicator&limit=200&${states}`)) {
      // Released or Refunded: open while an appeal is open, or may still be filed before appealBy (T-377 red team M2).
      const appealable = v.appealState === 'open' || (v.appealState === 'none' && Date.parse(v.deadlines?.appealBy ?? '') > Date.now());
      if (APPEALABLE_STATES.includes(v.escrowState) && !appealable) continue;
      seen.set(v.commitmentId, v);
    }
  }
  const deals = [];
  for (const v of seen.values()) {
    const terms = await get(`/v1/commitments/${v.commitmentId}/terms`);
    const adjudication = terms.adjudication ?? terms.terms?.adjudication ?? {};
    const next = Object.entries(v.deadlines ?? {}).map(([k, t]) => [k, t]).filter(([, t]) => Date.parse(t) > Date.now()).sort((x, y) => Date.parse(x[1]) - Date.parse(y[1]))[0];
    deals.push({ id: v.commitmentId, state: v.escrowState, nextDeadline: next ? `${next[0]} ${next[1]}` : undefined, policyHash: adjudication.policyHash, registryHash: adjudication.registryHash, primary: adjudication.adjudicator });
  }
  return { registrations, deals };
}

/**
 * The live side of the guard: the commit discovery names, the live build's kept-policies file at that commit (null when
 * the commit predates the file), and the open deals; then the decision. Prints what it found. A failed read of the
 * discovery or the deals warns and goes on: the deploy may be the fix for the outage, and the static check has passed.
 * @param {{ node: string, root: string, hashOf: (policy: object) => string, override?: string | null, run?: typeof sh, fetchImpl?: typeof fetch }} o
 */
export async function dealGuard({ node, root, hashOf, override = null, run = sh, fetchImpl = fetch }) {
  const { readFileSync } = await import('node:fs');
  const next = JSON.parse(readFileSync(`${root}apps/adjudicator/src/kept-policies.json`, 'utf8'));
  let live = { kept: null, registrations: [] }, deals = null, readError;
  try {
    const d = await fetchImpl(`${node}/`, { signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GET / answered ${r.status}`))));
    const commit = d?.demo?.build?.commit;
    if (typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit)) {
      const shown = await run('git', ['show', `${commit}:apps/adjudicator/src/kept-policies.json`], { show: false });
      if (shown.code === 0) live.kept = JSON.parse(shown.stdout);
      else if (!/does not exist|exists on disk, but not in/.test(shown.out)) throw new Error(`git cannot read commit ${commit.slice(0, 7)} (fetch it first)`);
    }
    const read = await readOpenDeals(node, fetchImpl);
    live.registrations = read.registrations;
    deals = read.deals;
  } catch (e) {
    readError = String(e?.message ?? e).slice(0, 200);
  }
  return guardDecision({ live, next, deals, readError, hashOf, override });
}
