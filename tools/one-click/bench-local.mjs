// The scripted runs' world (T-412): the public demo's own world (apps/demo-cloud, the code the live operators run) on
// two origins in this process, with Crow's test seller and test buyer (apps/test-agents, the code the live test agents
// run) served over HTTP beside it, as apps/test-agents/src/try.test.ts serves them. A scenario's scripted agent then
// runs in its own Node process, a plain HTTP client of all three, with the fetch probe preloaded to count its calls.
// No key, no model and no network beyond 127.0.0.1. It imports TypeScript, so bench.mjs runs it under
// `node --experimental-transform-types`.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { ROOT } from '../../scripts/metrics/lib.mjs';

const src = (p) => join(ROOT, p);

/** Serves a test agent's fetch(request, client) at http://127.0.0.1:<port><path>, and works it as its Durable Object's alarm does. */
async function serveAgent(path, make) {
  let agent = null;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
      const r = await agent.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method ?? 'GET', headers: req.headers, ...(body ? { body } : {}) }), req.socket.remoteAddress ?? 'unknown');
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e?.message ?? e));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}${path}`;
  agent = make(url);
  let running = true;
  const loop = (async () => {
    while (running) {
      await agent.work().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  return {
    url,
    close: async () => {
      running = false;
      await loop;
      await new Promise((r) => server.close(() => r()));
      server.closeAllConnections();
    },
  };
}

/** Starts the world and the one test agent the scenario needs. */
export async function startLocal(needs) {
  const [{ serveWorld }, { MemoryStorage }, { knownPins }] = await Promise.all([
    import(src('apps/test-agents/src/test-world.ts')),
    import(src('apps/demo-cloud/dist/index.js')),
    import(src('examples/verify.ts')),
  ]);
  // A fresh seed for the test agent's keys, held in this process only (TEST_AGENTS_SEED's format: 32 bytes of hex).
  const generatePrivateKey = () => `0x${randomBytes(32).toString('hex')}`;
  const pin = knownPins()[0]; // SimChain, as the in-process world settles
  const demo = await serveWorld();
  const closers = [() => demo.close()];
  let party;
  try {
    if (needs === 'seller') {
      const { TestSeller } = await import(src('apps/test-agents/src/seller.ts'));
      party = await serveAgent('/agents/test-seller', (base) => new TestSeller({ storage: new MemoryStorage(), operators: [...demo.urls], seed: generatePrivateKey(), pin, base, log: () => {} }));
    } else {
      const { TestBuyer } = await import(src('apps/test-agents/src/buyer.ts'));
      party = await serveAgent('/agents/test-buyer', (base) => new TestBuyer({ storage: new MemoryStorage(), operators: [...demo.urls], seed: generatePrivateKey(), pin, base, log: () => {} }));
    }
    closers.unshift(() => party.close());
  } catch (e) {
    await demo.close();
    throw e;
  }
  return {
    operators: [...demo.urls],
    party: party.url,
    close: async () => {
      for (const c of closers) await c().catch(() => undefined);
    },
  };
}

/**
 * Runs a scripted agent: `node --experimental-transform-types --import=<probe> <script> <args>`, with the operators and
 * the test agent's URL in its environment. Returns its exit code, its output and its wall time.
 */
export function runScripted({ script, args, operators, party, needs, probe, timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const argv = args.map((a) => a.replace('{seller}', party));
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', HOLDBACK_OPERATORS: operators.join(','), ...(needs === 'buyer' ? { CROW_TEST_BUYER: party } : {}) };
    const child = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', `--import=${probe}`, src(script), ...argv], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, timedOut: signal === 'SIGKILL', out: out.slice(-20_000), wallMs: Date.now() - started });
    });
  });
}

/** What the operator reports for a commitment: its escrowState, or null when it cannot be read. */
export async function operatorState(operator, id) {
  try {
    const r = await fetch(`${operator}/v1/commitments/${id}`, { signal: AbortSignal.timeout(10_000) });
    const j = r.ok ? await r.json() : null;
    return typeof j?.escrowState === 'string' ? j.escrowState : null;
  } catch {
    return null;
  }
}

/** The scripted agent's outcome from its output: the last `done commitment <id> <state>` line, and whether Crow's test agent took part. */
export function scriptedOutcome(run, scenario) {
  const done = [...run.out.matchAll(/^done +commitment (0x[0-9a-fA-F]{64}) (Released|Refunded)$/gm)].pop();
  const errors = [];
  // try.ts plays both sides when the test seller fails; the scenario then did not happen as written.
  const selfPlayed = !!done && scenario.party === 'test-seller' && !/with Crow's test seller as the other party/.test(run.out);
  if (selfPlayed) errors.push('the test seller did not take part: the script played both sides');
  if (run.timedOut) errors.push('the scripted agent ran out of time');
  else if (run.code !== 0) errors.push(`the scripted agent exited ${run.code}`);
  const stoppedAt = /^(?:stopped|refused) at:? ?(.*)$/m.exec(run.out)?.[0] ?? (run.code !== 0 ? run.out.trim().split('\n').pop() : null);
  const state = run.timedOut ? 'timedOut' : done && run.code === 0 && !selfPlayed ? done[2] : 'stopped';
  return { state, commitmentId: done?.[1] ?? null, stoppedAt, errors };
}
