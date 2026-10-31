// Mutation sweep for the idempotency and failover guards (T-007): break one guard at a time, run the operator
// and SDK tests, and require that some test fails ("killed"). Restores every file, even on error.
// Usage (from the repo root, after `pnpm typecheck`): node apps/operator/scripts/mutants.mjs [filter]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const op = (f) => `apps/operator/src/${f}`;
const sdk = (f) => `packages/sdk/src/${f}`;

/** [group, description, file, find, replace] */
const MUTANTS = [
  ['idempotency', 'another body replays instead of 409', op('idempotency.ts'), "seen.fingerprint === fp ? { kind: 'replay', response: seen.response } : { kind: 'conflict' }", "{ kind: 'replay', response: seen.response }"],
  ['idempotency', 'nothing is stored, so a repeat runs again', op('idempotency.ts'), 'if (response.status < 300) this.done.set', 'if (false) this.done.set'],
  ['idempotency', 'refusals are stored too', op('idempotency.ts'), 'if (response.status < 300) this.done.set', 'if (true) this.done.set'],
  ['idempotency', 'concurrent calls with one key are not serialized', op('idempotency.ts'), 'const current = previous.then(() => this.once(key, fp, handler));', 'const current = this.once(key, fp, handler);'],
  ['idempotency', 'fingerprint ignores the body', op('idempotency.ts'), 'canonicalKeccak({ method, path, body: body ?? null })', 'canonicalKeccak({ method, path })'],
  ['idempotency', 'operator accepts a mutation without a key', op('server.ts'), "if (typeof key !== 'string' || key.length < 1 || key.length > 255) fail(", "if (false) fail("],
  ['idempotency', 'operator relays under fresh settlement keys', op('server.ts'), 'idempotencyKey: keys[i]!, via: this.o.operatorId', 'idempotencyKey: `${keys[i]!}/${this.o.operatorId}`, via: this.o.operatorId'],
  ['idempotency', 'dry run records an idempotency key', op('server.ts'), 'if (dryRun) return this.send(ctx, await this.dryRun(op));', "if (dryRun) return this.idempotent(ctx, raw, () => this.dryRun(op));"],
  ['failover', 'SDK waits on every 429', sdk('client.ts'), 'if (!r.ok && r.retryAfterMs !== undefined && !waited) {', 'if (!r.ok && r.retryAfterMs !== undefined) {'],
  ['failover', 'Retry-After not capped', sdk('client.ts'), 'return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);', 'return Math.max(ms, 0);'],
  ['failover', 'SDK stops at the first operator', sdk('client.ts'), 'last = { problem: r.problem, via: base };', 'return { ok: false, problem: r.problem, via: base };'],
  ['failover', 'no direct submission', sdk('client.ts'), "return { via: 'direct', state: await this.direct(op, key) };", 'throw new HoldbackError(relayed.problem, relayed.via);'],
  ['failover', 'direct path uses a fresh key', sdk('client.ts'), 'const keys = submissionKeys(key, subs.length);', 'const keys = submissionKeys(`${key}-direct`, subs.length);'],
  ['failover', 'a new key per operator', sdk('client.ts'), "const r = await this.request(base, 'POST', path, body, { 'idempotency-key': key });", "const r = await this.request(base, 'POST', path, body, { 'idempotency-key': `${key}@${base}` });"],
  ['failover', 'preview sends signatures', sdk('client.ts'), 'const bare = unsigned(op);', 'const bare = op;'],
  ['receipts', 'receipt signed by the wrong key', op('server.ts'), 'signMessage(this.o.signerKey, this.domain,', "signMessage(`0x${'11'.repeat(32)}`, this.domain,"],
  ['guards', 'live Stripe keys allowed', op('guards.ts'), "if (!value.startsWith('sk_test_')) throw", 'if (false) throw'],
  ['guards', 'mainnet chain IDs allowed', op('guards.ts'), 'if (MAINNET_CHAIN_IDS.has(id)) throw', 'if (false) throw'],
];

const filter = process.argv[2];
const results = [];
for (const [group, description, file, find, replace] of MUTANTS) {
  if (filter && !`${group} ${description}`.includes(filter)) continue;
  const path = `${root}${file}`;
  const original = readFileSync(path, 'utf8');
  if (!original.includes(find)) {
    results.push([group, description, 'STALE (pattern not found)']);
    continue;
  }
  try {
    writeFileSync(path, original.replace(find, replace));
    const r = spawnSync('npx', ['vitest', 'run', 'apps/operator', 'packages/sdk'], { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
    results.push([group, description, r.status === 0 ? 'SURVIVED' : 'killed']);
  } finally {
    writeFileSync(path, original);
  }
}
for (const [g, d, s] of results) console.log(`${s.padEnd(26)} ${g}: ${d}`);
const bad = results.filter(([, , s]) => s !== 'killed');
console.log(`${results.length - bad.length}/${results.length} killed`);
process.exit(bad.length ? 1 : 0);
