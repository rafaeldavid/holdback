// What sim:check reads. The audit is the settlement layer's own record (genesis, ledger, journal of signed
// submissions, hash-chained event log), served by sim:world to the coordinator only. Operator reads are what
// any party sees over the public API. Party reports are what the model agents claim; they are compared, never
// trusted.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address, Club, CommitmentStateView, Hex32, Judgment, SettlementEvent } from '@holdback/core';
import type { JournalEntry, SimChain } from '@holdback/settlement/sim';
import type { WorldFile } from './world.ts';

export interface Audit {
  kind: 'holdback-sim-audit';
  runId: string;
  /** Settlement-layer time when the audit was taken. */
  now: string;
  chainId: number;
  token: string;
  genesis: { balances: Record<string, string>; bonds: Record<string, { junior: string; senior: string }>; clubs: Club[] };
  /** What the chain says it minted (genesis plus faucet). sim:check recomputes it. */
  minted: string;
  /** Every non-zero ledger account, as the chain holds it. */
  ledger: Record<string, string>;
  /** Every accepted submission, signatures included, in order. */
  journal: JournalEntry[];
  log: SettlementEvent[];
}

export interface CommitmentRead {
  view: CommitmentStateView | null;
  events: SettlementEvent[];
  judgment: Judgment | null;
}

/** One operator's public answers for the run's commitments and party balances. */
export interface OperatorRead {
  operator: string;
  commitments: Record<string, CommitmentRead>;
  balances: Record<string, string>;
}

/** What a party agent writes to runs/<run-id>/reports/<party>.json (briefs/README.md). */
export interface PartyReport {
  party: string;
  address: string;
  model?: string;
  profile?: string;
  commitments: Array<{ id: string; role: 'buyer' | 'seller'; finalState: string }>;
  actions?: string[];
  outcome?: string;
  friction?: string[];
}

export interface CheckInput {
  audit: Audit;
  reads: OperatorRead[];
  reports?: PartyReport[];
  /** A decided commitment must have its judgment record served (default true; unit chains have none). */
  requireJudgmentRecords?: boolean;
}

const json = <T>(v: unknown): T => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x))) as T;

/** The audit of a SimChain, as plain JSON. */
export function auditOf(chain: SimChain, runId: string): Audit {
  const g = chain.genesis;
  return json<Audit>({
    kind: 'holdback-sim-audit',
    runId,
    now: chain.now(),
    chainId: g.chainId,
    token: g.token,
    genesis: { balances: g.balances, bonds: g.bonds, clubs: g.clubs },
    minted: chain.minted(),
    ledger: chain.ledger(),
    journal: chain.journal(),
    log: chain.log(),
  });
}

export async function fetchAudit(auditUrl: string): Promise<Audit> {
  const res = await fetch(auditUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`audit ${auditUrl} answered ${res.status}`);
  return (await res.json()) as Audit;
}

async function get<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Everything a party can read from one operator about these commitments and addresses. */
export async function readOperator(base: string, ids: readonly string[], addresses: readonly string[]): Promise<OperatorRead> {
  const commitments: Record<string, CommitmentRead> = {};
  for (const id of ids) {
    const events: SettlementEvent[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: SettlementEvent[]; nextCursor: string | null } | null = await get(`${base}/v1/commitments/${id}/events?limit=200${cursor ? `&cursor=${cursor}` : ''}`);
      if (!page) break;
      events.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    events.sort((x, y) => x.seq - y.seq);
    commitments[id] = { view: await get(`${base}/v1/commitments/${id}`), events, judgment: await get(`${base}/v1/commitments/${id}/judgment`) };
  }
  const balances: Record<string, string> = {};
  for (const a of addresses) balances[a.toLowerCase()] = (await get<{ amount: string }>(`${base}/v1/balances/${a}`))?.amount ?? '0';
  return { operator: base, commitments, balances };
}

/** The same reads taken straight from a chain (unit tests; no operator, no judgment records). */
export async function readsFromChain(chain: SimChain, operator: string, ids: readonly Hex32[], addresses: readonly Address[]): Promise<OperatorRead> {
  const log = chain.log();
  const commitments: Record<string, CommitmentRead> = {};
  for (const id of ids) commitments[id] = json<CommitmentRead>({ view: await chain.state(id), events: log.filter((e) => e.commitmentId === id), judgment: null });
  const bal = await chain.balances(addresses);
  return { operator, commitments, balances: Object.fromEntries(addresses.map((a) => [a.toLowerCase(), bal[a]!.amount])) };
}

/** The ids of every commitment the log records, and every party address the terms name. */
export function subjects(audit: Audit): { ids: string[]; parties: string[] } {
  const ids: string[] = [];
  const parties = new Set<string>();
  for (const e of audit.log) {
    if (e.type !== 'commitment.offered' || !e.commitmentId) continue;
    ids.push(e.commitmentId);
    const t = e.payload['terms'] as { buyer: string; seller: string };
    parties.add(t.buyer.toLowerCase());
    parties.add(t.seller.toLowerCase());
  }
  return { ids, parties: [...parties] };
}

/** Reports the party agents wrote; a file that does not parse is itself returned as a finding. */
export function readReports(dir: string): { reports: PartyReport[]; unreadable: string[] } {
  const reports: PartyReport[] = [];
  const unreadable: string[] = [];
  if (!existsSync(dir)) return { reports, unreadable };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as PartyReport;
      if (typeof r.party !== 'string' || !Array.isArray(r.commitments)) throw new Error('not a party report');
      reports.push(r);
    } catch (e) {
      unreadable.push(`${f}: ${(e as Error).message}`);
    }
  }
  return { reports, unreadable };
}

/** The whole input for a run: the audit plus every operator's answers, and any party reports. */
export async function readRun(world: WorldFile, audit: Audit, reports: PartyReport[] = []): Promise<CheckInput> {
  const { ids, parties } = subjects(audit);
  const addresses = [...new Set([...parties, ...Object.values(world.parties).map((p) => p.address.toLowerCase())])];
  const reads = await Promise.all(world.operators.map((o) => readOperator(o, ids, addresses)));
  return { audit, reads, reports };
}
