// One whole deal through a hosted seller in Cloudflare's local Workers runtime (T-435): `wrangler dev` runs the
// Worker and its Durable Object on this machine, against an in-process SimChain world and the job stub. Nothing
// leaves this machine: no Cloudflare account, no seller's API, test tokens only. It ends with exit code 0 when the
// buyer's commitment is Released with one delivery and the stub made one run in the pinned account.
//
//   pnpm -r build && node apps/hosted-sellers/scripts/local-run.ts
//
// It writes a dev configuration and a bundle under reports/scratch/hosted-sellers-local/ and passes the test keys to
// `wrangler dev` as --var flags. The Worker listens on port 8793, and the stub on a free port.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { startSimWorld } from '@holdback/operator';
import { Agent } from '../../../examples/agent.ts';
import { startJobStub } from '../../../examples/seller-adapter-job-stub.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const OUT = here('../../../reports/scratch/hosted-sellers-local');
const WORKER_PORT = 8793;
const KEYS = { JOBS_API_KEY: 'local-run-api-key', QUOTE_CREDENTIALS: 'local-run-quote', READY_CREDENTIALS: 'local-run-ready' };
const say = (line: string) => console.log(`local-run: ${line}`);

async function until<T>(what: string, read: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
    const v = await read().catch(() => undefined);
    if (v !== undefined) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

const world = await startSimWorld({ env: {}, onError: () => {} });
const stub = await startJobStub({ key: KEYS.JOBS_API_KEY, readsUntilComplete: 1, workspaces: true });
let dev: ReturnType<typeof spawn> | undefined;
let devLog = '';
let secrets: string[] = [];
let code = 1;
try {
  // The example bundle, pointed at this run's stub.
  const bundle = JSON.parse(readFileSync(here('../example/bundle.json'), 'utf8'));
  bundle.config.sellerApi.baseUrl = stub.base;
  bundle.config.pollMs = 500;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/bundle.json`, JSON.stringify(bundle));
  const base = `http://127.0.0.1:${WORKER_PORT}/agents/${bundle.slug}`;
  writeFileSync(`${OUT}/wrangler.jsonc`, JSON.stringify({
    name: 'crow-seller-local-run', main: here('../src/entry.ts'), compatibility_date: '2025-09-15', compatibility_flags: ['nodejs_compat'],
    alias: { 'crow-hosted-seller-bundle': `${OUT}/bundle.json` },
    vars: { OPERATOR_URLS: world.info.operators.join(','), SELLER_URL: base },
    durable_objects: { bindings: [{ name: 'SELLER', class_name: 'HostedSeller' }], code_update_strategy: { mode: 'deferred', max_delay: 300 } },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['HostedSeller'] }],
  }, null, 2));
  const seller = world.info.accounts.find((a) => a.label === 'seller-1')!;
  const vars = Object.entries({ HOLDBACK_KEY: seller.privateKey, ...KEYS }).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
  say(`starting wrangler dev on port ${WORKER_PORT}`);
  dev = spawn('npx', ['--yes', 'wrangler@4.151.3', 'dev', '--config', `${OUT}/wrangler.jsonc`, '--local', '--port', String(WORKER_PORT), '--persist-to', `${OUT}/state`, ...vars], { stdio: ['ignore', 'pipe', 'pipe'] });
  secrets = Object.values({ HOLDBACK_KEY: seller.privateKey, ...KEYS });
  dev.stdout!.on('data', (d) => (devLog += d));
  dev.stderr!.on('data', (d) => (devLog += d));
  await until('the Worker to answer', async () => ((await fetch(`${base}/health`)).status > 0 ? true : undefined));
  const first = await until('the seller to start', async () => {
    const h = await fetch(`${base}/health`);
    return h.ok ? await h.json() : (say(`health ${h.status}: ${(await h.text()).slice(0, 300)}`), undefined);
  }, 60_000);
  say(`health: ${JSON.stringify(first)}`);

  // The page a buyer's agent reads (buy.txt step 2), then a quote, the funding, and the alarm's work.
  const page = await (await fetch(base)).text();
  const card = JSON.parse(/<script type="application\/json" id="crow-agent">([\s\S]*?)<\/script>/.exec(page)![1]!);
  say(`card: ${card.name}, quote ${card.offers[0].pricing.quote}, defaults ${card.offers[0].pricing.defaults}`);
  const b = world.info.accounts.find((a) => a.label === 'buyer-1')!;
  const buyer = new Agent(world.info.operators, b.privateKey as Hex, Buffer.from(b.encryptionSecretKey, 'base64url'));
  const res = await fetch(card.offers[0].pricing.quote, { method: 'POST', headers: { authorization: `Bearer ${KEYS.QUOTE_CREDENTIALS}`, 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: { target: 'vault-core', depth: 2 } }) });
  const q = (await res.json()) as J;
  if (res.status !== 200) throw new Error(`the quote answered ${res.status}: ${JSON.stringify(q).slice(0, 300)}`);
  const id = q.commitmentId as Hex;
  say(`offer ${id}: ${q.price.amount} base units`);
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 2_100_000_000n);
  say('funded; the Durable Object\'s alarm takes it from here');
  const state = await until('the deal to settle', async () => {
    const s = (await buyer.call('GET', `/v1/commitments/${id}`)).escrowState as string;
    return ['Released', 'Refunded'].includes(s) ? s : undefined;
  });
  const deliveries = (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.filter((e: J) => e.type === 'delivery.submitted').length;
  const health = await (await fetch(`${base}/health`)).json();
  say(`settled ${state}; ${deliveries} delivery; the stub made ${stub.runs().length} run in ${JSON.stringify(stub.workspacesNamed)}; health ${JSON.stringify(health)}`);
  const leaked = Object.values({ HOLDBACK_KEY: seller.privateKey, ...KEYS }).filter((v) => devLog.includes(v));
  if (leaked.length) say(`a key appears in the Worker's log: ${leaked.length}`);
  code = state === 'Released' && deliveries === 1 && stub.runs().length === 1 && leaked.length === 0 ? 0 : 1;
  say(code === 0 ? 'pass' : 'fail');
} catch (e) {
  say(`fail: ${(e as Error).message}`);
  let shown = devLog.split('\n').slice(-25).join('\n');
  for (const v of secrets) shown = shown.split(v).join('<key>');
  console.log(`wrangler dev's last lines:\n${shown}`);
} finally {
  dev?.kill('SIGTERM');
  await stub.close();
  await world.close();
}
process.exit(code);
