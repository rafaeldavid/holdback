// sim:world: one isolated world per run. Each run gets its own SimChain, operators, adjudicators and sim
// service on free ports, its own party accounts (keys derived from the run id, so no two runs share a key or
// a signature), and its own directory: runs/<run-id>/ with world.json, a mailbox per party and a reports
// folder. Parallel runs never share state. The coordinator also gets an audit endpoint, which no party brief
// mentions: sim:check reads the settlement layer's own record from it.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { auditOf } from './audit.ts';

export const RUNS_DIR = fileURLToPath(new URL('./runs/', import.meta.url));
export const DEFAULT_PARTIES = ['buyer-1', 'seller-1', 'buyer-2', 'seller-2'] as const;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A run id or party name: lowercase letters, digits and dashes, at most 64 characters. */
export const validRunId = (id: string): boolean => NAME.test(id);

export interface PartyAccount {
  address: string;
  /** TEST KEY ONLY: derived from the public label sim-run/<run-id>/<party>. */
  privateKey: string;
  encryptionPublicKey: string;
  encryptionSecretKey: string;
  balance: string;
  /** This party's own working directory and mailbox. */
  workdir: string;
  mailbox: string;
}

export interface WorldFile {
  kind: 'holdback-sim-run';
  runId: string;
  pid: number;
  startedAt: string;
  /** The sim service: GET / (where everything is), GET /clock, POST /advance. */
  sim: string;
  operators: string[];
  /** The EIP-712 domain a party pins in its own configuration. */
  pinnedDomain: { name: string; version: string; chainId: number; verifyingContract: string };
  clubId: string;
  token: { symbol: string; decimals: number };
  adjudicators: Array<{ role: string; name: string; address: string }>;
  economics: Record<string, string>;
  parties: Record<string, PartyAccount>;
  /** For the coordinator and sim:check only; never put these in a party brief. */
  coordinator: { runDir: string; auditUrl: string; reports: string; check: string };
}

export interface RunWorldOptions {
  runId: string;
  parties?: readonly string[];
  runsDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  onError?: (e: Error) => void;
}

export interface RunWorld {
  dir: string;
  file: WorldFile;
  world: SimWorld;
  close(): Promise<void>;
}

export async function startRunWorld(o: RunWorldOptions): Promise<RunWorld> {
  if (!validRunId(o.runId)) throw new Error(`run id ${JSON.stringify(o.runId)}: use lowercase letters, digits and dashes (at most 64)`);
  const parties = [...(o.parties ?? DEFAULT_PARTIES)];
  for (const p of parties) if (!validRunId(p)) throw new Error(`party name ${JSON.stringify(p)}: use lowercase letters, digits and dashes`);
  if (new Set(parties).size !== parties.length) throw new Error('party names must be distinct');
  const dir = join(o.runsDir ?? RUNS_DIR, o.runId);
  if (existsSync(join(dir, 'world.json'))) throw new Error(`run ${o.runId} already has a world (${join(dir, 'world.json')}); pick a new run id`);

  const labels = parties.map((p) => `sim-run/${o.runId}/${p}`);
  const world = await startSimWorld({ accounts: labels, spareAccounts: 4, ...(o.env ? { env: o.env } : {}), ...(o.onError ? { onError: o.onError } : {}) });

  const audit: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://audit.invalid').pathname;
    if (req.method !== 'GET' || (path !== '/' && path !== '/audit')) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{"type":"not_found"}');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(auditOf(world.chain, o.runId)));
  });
  await new Promise<void>((resolve, reject) => {
    audit.once('error', reject);
    audit.listen(0, '127.0.0.1', resolve);
  });
  const auditUrl = `http://127.0.0.1:${(audit.address() as AddressInfo).port}/audit`;

  mkdirSync(join(dir, 'reports'), { recursive: true });
  const info = world.info;
  const file: WorldFile = {
    kind: 'holdback-sim-run',
    runId: o.runId,
    pid: process.pid,
    startedAt: world.chain.now(),
    sim: world.url,
    operators: info.operators,
    pinnedDomain: info.domain,
    clubId: info.clubId,
    token: info.token,
    adjudicators: info.adjudicators.map((a) => ({ role: a.role, name: a.name, address: a.address })),
    economics: info.economics,
    parties: Object.fromEntries(
      parties.map((p, i) => {
        const a = info.accounts.find((x) => x.label === labels[i])!;
        const workdir = join(dir, 'parties', p);
        const mailbox = join(dir, 'mailbox', p);
        mkdirSync(workdir, { recursive: true });
        mkdirSync(mailbox, { recursive: true });
        return [p, { address: a.address, privateKey: a.privateKey, encryptionPublicKey: a.encryptionPublicKey, encryptionSecretKey: a.encryptionSecretKey, balance: a.balance, workdir, mailbox }];
      }),
    ),
    coordinator: { runDir: dir, auditUrl, reports: join(dir, 'reports'), check: join(dir, 'check.json') },
  };
  writeFileSync(join(dir, 'world.json'), `${JSON.stringify(file, null, 2)}\n`);

  return {
    dir,
    file,
    world,
    close: async () => {
      await new Promise<void>((r) => {
        audit.close(() => r());
        audit.closeAllConnections();
      });
      await world.close();
    },
  };
}
