// The machinery of the first full EVM end-to-end round (T-216): the round's agents, one scenario's run with its
// checks and evidence, and the deal steps the scenarios share. Every step goes through the public API as an outside
// agent's would, with agent.ts and verify.ts (the code behind try.mjs, which llms.txt points to): each message an
// operator prepares is rebuilt from the round's own intent and checked before a round key signs it.
//
// Evidence per deal (T-216, How the round runs): the commitment ID; each transaction with its Etherscan link, gas and
// block; dealOf's stage and CPP's payment state; the balances and bonds of every party before and after; the state
// and event log from both operators, and whether they agree; whether the buyer could open the work.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseError, ContractFunctionRevertedError, recoverTypedDataAddress, type Hex } from 'viem';
import { Agent } from './agent.ts';
import { SEPOLIA, type DeploymentFile } from './deployments.ts';
import { RoundChain, type TxRecord } from './e2e-chain.ts';
import { printable, roundEncryptionKey, roundKey, type Role } from './e2e-keys.ts';
import { commitmentIdOf, jcs, knownPins, operatorFeeOf, Refusal, typedOf, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** JSON with every 0x-hex string lowercased: addresses compare ignoring case. */
const lowerHex = (v: J): J => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'string' && /^0x[0-9a-fA-F]+$/.test(x) ? x.toLowerCase() : x));
export const same = (a: J, b: J) => jcs(lowerHex(a)) === jcs(lowerHex(b));

/** A scenario that cannot run until a prerequisite task is live (T-220's deploy): the run records it as waiting. */
export class Waits extends Error {
  readonly tasks: string[];
  constructor(tasks: string[], why: string) {
    super(`waits for ${tasks.join(' and ')}: ${why}`);
    this.tasks = tasks;
  }
}

export interface RoundOptions {
  /** Operator base URLs at two distinct origins; the first relays unless a step names another. */
  operators: string[];
  /** E2E_SEPOLIA_SEED: every round key derives from it (e2e-keys.ts). Never printed. */
  seed: string;
  /** The chain's RPC: Sepolia's in a live run, anvil's in the tests. */
  rpcUrl: string;
  /** T-220 has deployed T-217, T-218, T-219 and T-221: the only signal for T-218 and T-219, which no API read shows. */
  t220?: boolean;
  /** Scenario 1 runs the homepage command unless this is false. */
  homepage?: boolean;
  /** The homepage command's `--seller`: Crow's test seller, in a live run. */
  trySeller?: string;
  /** Where the homepage serves try.mjs, to compare with site/try.mjs, in a live run. */
  tryBundleUrl?: string;
  log?: (line: string) => void;
}

/** What discovery says about the demo, read from every operator; they must agree. */
export interface Demo {
  clubId: string;
  token: string;
  symbol: string;
  adjudicators: { primary: string; fallback: string; appeal: string };
  minWindowSec: number;
  feeSchedule: J | null;
}

export class Round {
  readonly o: RoundOptions;
  readonly pin: Pin;
  readonly demo: Demo;
  /** The pinned deployment and the chain it is read on; absent on SimChain (the offline tests). */
  readonly chain: RoundChain | undefined;
  /** Each operator's /v1/status when the round opened: schema, domain and fee, recorded with every result. */
  readonly status: J[];
  private readonly agents = new Map<string, Agent>();

  private constructor(o: RoundOptions, pin: Pin, demo: Demo, chain: RoundChain | undefined, status: J[]) {
    this.o = o;
    this.pin = pin;
    this.demo = demo;
    this.chain = chain;
    this.status = status;
  }

  static async open(o: RoundOptions): Promise<Round> {
    const reader = new Agent(o.operators, roundKey(o.seed, 'master'), roundEncryptionKey(o.seed, 'master'));
    const found: J = await reader.trusted('/.well-known/holdback.json', (x) => ({ domain: x.domain, demo: x.demo ? { clubId: x.demo.clubId, token: x.demo.token?.id, adjudicators: x.demo.adjudicators, minWindowSec: x.demo.minWindowSec } : null, fees: x.fees?.operator ?? null }));
    const pin = knownPins().find((p) => same(p.domain, found.domain));
    if (!pin) throw new Refusal(`refusing to sign: the operators serve EIP-712 domain ${jcs(found.domain)}, not one pinned here`);
    if (!found.demo?.clubId || found.demo.token !== pin.token.id) throw new Error(`these operators run no ${pin.token.symbol} demo (discovery has no demo.clubId or demo.token ${pin.token.id})`);
    const role = (r: string): string => {
      const a = found.demo.adjudicators?.find((x: J) => x.role === r)?.address;
      if (!a) throw new Error(`discovery names no ${r} adjudicator under demo.adjudicators`);
      return String(a).toLowerCase();
    };
    const demo: Demo = {
      clubId: found.demo.clubId, token: pin.token.id, symbol: pin.token.symbol,
      adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
      minWindowSec: Number(found.demo.minWindowSec ?? 60), feeSchedule: found.fees,
    };
    let chain: RoundChain | undefined;
    if (pin.chain) {
      const env = process.env['HOLDBACK_DEPLOYMENT'];
      const deployments = [SEPOLIA, env ? (JSON.parse(env) as DeploymentFile) : null].filter((d): d is DeploymentFile => d !== null);
      const deployment = deployments.find((d) => d.rules.toLowerCase() === pin.domain.verifyingContract.toLowerCase());
      if (!deployment) throw new Error(`no deployment file pins the rules contract ${pin.domain.verifyingContract}`);
      chain = await RoundChain.open(o.rpcUrl, deployment, pin.chain.explorer);
    }
    const status = await Promise.all(reader.sources().map(async (api) => ({ origin: new URL(api).origin, ...(await reader.call('GET', '/v1/status', undefined, api)) })));
    return new Round(o, pin, demo, chain, status);
  }

  /** The two operators' origins, the relaying one first. */
  get operators(): string[] {
    return this.o.operators;
  }

  get t220(): boolean {
    return this.o.t220 === true;
  }

  /** A round key's agent, relaying through operator `relay` (0 or 1); every agent reads from both. */
  agent(role: Role, relay = 0): Agent {
    const key = `${role}/${relay}`;
    let a = this.agents.get(key);
    if (!a) {
      const ops = [...this.o.operators.slice(relay), ...this.o.operators.slice(0, relay)];
      a = new Agent(ops, roundKey(this.o.seed, role), roundEncryptionKey(this.o.seed, role), this.pin.domain, this.pin.chain);
      this.agents.set(key, a);
    }
    return a;
  }

  /** A round key itself, for the direct calls. Never printed. */
  key(role: Role): Hex {
    return roundKey(this.o.seed, role);
  }

  address(role: Role): string {
    return this.agent(role).address;
  }

  /** Base units of the 6-decimal test token as "25.5 tUSDC". */
  amount(base: string | bigint): string {
    const v = BigInt(base);
    const neg = v < 0n;
    const a = neg ? -v : v;
    const frac = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    return `${neg ? '-' : ''}${a / 1_000_000n}${frac ? `.${frac}` : ''} ${this.demo.symbol}`;
  }
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  label: 'measured' | 'inferred';
}

/** One deal's evidence. */
export interface DealRecord {
  label: string;
  id: Hex;
  relay: string;
  transactions: Array<TxRecord & { steps: string[]; link: string; sentBy: string }>;
  /** dealOf and CPP's payment state after `block`, the deal's last transaction's block (the latest block when it has none). */
  chain?: { stage: string; appeal: string; attempt: number; payment: { collected: boolean; capturable: string; refundable: string }; block?: number };
  operators?: { views: Array<{ origin: string; escrowState: string; appealState?: string; events: number; head: string | null }>; agree: boolean };
  balances: { before: Record<string, Holding>; after?: Record<string, Holding> };
  /** On a chain: what the deal itself moved for each party, from its own transactions' logs (`flowOf`). */
  flows?: Record<string, Holding>;
  buyerOpened?: boolean;
  notes: string[];
}
export type Holding = { token: string; bond: string; free: string };

/** A deal in progress: its terms and the agents that play it. */
export interface Deal {
  label: string;
  id: Hex;
  terms: J;
  buyer: Agent;
  seller: Agent;
  record: DealRecord;
  operatorFee?: bigint;
  hold?: bigint;
  delivery?: J;
  /** Transactions the round sent itself (direct calls), by step. */
  sent: Array<{ step: string; tx: TxRecord }>;
}

export type Status = 'pass' | 'fail' | 'waits' | 'error';

/** One scenario's run: its lines, checks and deals. */
export class Run {
  readonly round: Round;
  readonly scenario: string;
  readonly title: string;
  step = 'start';
  readonly checks: Check[] = [];
  readonly deals: DealRecord[] = [];
  readonly notes: string[] = [];
  /** Longer output kept with the record, such as a homepage run's lines, with URLs removed (`reason`). */
  readonly attachments: Record<string, string> = {};
  readonly startedAt = new Date().toISOString();
  error?: string;
  waitsFor: string[] = [];

  constructor(round: Round, scenario: string, title: string) {
    this.round = round;
    this.scenario = scenario;
    this.title = title;
  }

  say(text: string): void {
    (this.round.o.log ?? console.log)(`[${this.scenario}] ${this.step.padEnd(9)} ${text}`);
  }

  /** Records a check and prints it; returns whether it held. */
  check(name: string, ok: boolean, detail: string, label: Check['label'] = 'measured'): boolean {
    this.checks.push({ name, ok, detail, label });
    this.say(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}${label === 'inferred' ? ' (inferred)' : ''}`);
    return ok;
  }

  note(text: string): void {
    this.notes.push(text);
    this.say(`note ${text}`);
  }

  /** The result: pass only when every check held and nothing stopped the run. */
  result(): J {
    const status: Status = this.error ? (this.waitsFor.length ? 'waits' : 'error') : this.checks.every((c) => c.ok) ? 'pass' : 'fail';
    return {
      scenario: this.scenario, title: this.title, status, startedAt: this.startedAt, endedAt: new Date().toISOString(),
      ...(this.error ? { stoppedAt: this.step, error: this.error } : {}), waitsFor: this.waitsFor,
      deployment: this.round.chain ? { chainId: this.round.chain.deployment.chainId, rules: this.round.chain.deployment.rules, explorer: this.round.chain.explorer ?? null } : { chainId: this.round.pin.domain.chainId, rules: null, explorer: null },
      domain: this.round.pin.domain, operators: this.round.status, checks: this.checks, deals: this.deals, notes: this.notes, attachments: this.attachments,
    };
  }
}

/**
 * A read retried with backoff (1, 2, then 4 s) when the network, a rate limit or the operator fails it: a public
 * node's 5xx or 429 must not stop a scenario with a deal open. Refusals are not retried.
 */
export async function retry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      const transient = e instanceof TypeError || e instanceof SyntaxError || /internal|rate_limited|unavailable|fetch failed|timed? ?out|ECONNRESET|50\d|429/i.test(String((e as Error).message));
      if (!transient || attempt === 4) throw e;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

/**
 * An error as one line safe to print or save: `printable` (no URL but an Etherscan link), plus the contract's revert
 * name when viem decoded one (`TooEarly`, `WrongStage`), so a failed direct call's record says why.
 */
export function reason(e: unknown): string {
  const reverted = e instanceof BaseError ? (e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null) : null;
  const name = reverted?.data?.errorName;
  return `${printable(e)}${name ? ` (${name})` : ''}`;
}

/** A GET to one operator, retried (`retry`). */
export const get = (agent: Agent, path: string, api = agent.operators[0]): Promise<J> => retry(() => agent.call('GET', path, undefined, api));

/** Polls every operator until each reports one of `states`; a stall names what each saw and their notices. */
export async function until(run: Run, agent: Agent, id: Hex, states: string[], timeoutMs: number): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(1000)) {
    seen = await Promise.all(agent.sources().map((api) => get(agent, `/v1/commitments/${id}`, api)));
    if (seen.every((s) => states.includes(s.escrowState))) return seen[0];
  }
  const notices = [...new Set(seen.flatMap((s) => s.notices ?? []))];
  throw new Error(`${short(id)} still ${seen.map((s) => s.escrowState).join(' / ')} after ${timeoutMs / 1000} s, waiting for ${states.join(' or ')}${notices.length ? `; the operators say: ${notices.join(' | ')}` : ''}`);
}

/** Waits until settlement time, as both operators report it, is past `iso` by `marginSec`. */
export async function waitPast(run: Run, agent: Agent, iso: string, marginSec = 2): Promise<void> {
  const at = Date.parse(iso) + marginSec * 1000;
  for (let now = await retry(() => agent.settlementNow()); now < at; now = await retry(() => agent.settlementNow())) await sleep(Math.min(5000, at - now));
}

/**
 * Sends a timeout trigger through the API (`POST /v1/commitments/<id>/triggers/<kind>`, anyone, no signature). A
 * deadline is judged on the chain's clock, which lags the wall: a refusal as too early is retried every 3 s.
 */
export async function trigger(run: Run, deal: Deal, kind: string, timeoutMs = 120_000): Promise<J> {
  for (const end = Date.now() + timeoutMs; ; await sleep(3000)) {
    try {
      return await deal.buyer.call('POST', `/v1/commitments/${deal.id}/triggers/${kind}`, {});
    } catch (e) {
      if (!/invalid_state: .*(has not passed|too ?early)/i.test((e as Error).message) || Date.now() > end) throw e;
    }
  }
}

/** Every event of a deal from one operator, oldest first (following `nextCursor`). */
export async function eventsOf(agent: Agent, id: Hex, api: string): Promise<J[]> {
  const out: J[] = [];
  let cursor: string | null = null;
  do {
    const page: J = await get(agent, `/v1/commitments/${id}/events?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, api);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out.sort((a, b) => a.seq - b.seq);
}

/**
 * Token balance, bond and free bond of each address: from the chain (after block `at` when given), or on SimChain from
 * the API's views.
 */
export async function holdings(run: Run, addresses: readonly string[], at?: bigint): Promise<Record<string, Holding>> {
  const { chain } = run.round;
  if (chain) return chain.holdings(addresses, at);
  const reader = run.round.agent('master');
  const out: Record<string, Holding> = {};
  for (const a of addresses) {
    const token = (await retry(() => reader.trusted(`/v1/balances/${a}`, (x) => x.amount))) as string;
    const pool = await reader.trusted(`/v1/adjudicators/${a}`, (x) => x.pool ?? null).catch(() => null);
    const bond = BigInt(pool?.junior?.amount ?? '0');
    out[a.toLowerCase()] = { token, bond: bond.toString(), free: (bond - BigInt(pool?.reserved?.amount ?? '0')).toString() };
  }
  return out;
}

/**
 * Holdings now: on a chain, at the latest block, and never before the round's own last transaction (`RoundChain.fresh`).
 * A deal's starting balances read right after the round mints or bonds from its own key then include that step, as the
 * closing balances, read at the deal's last block, do.
 */
export async function holdingsNow(run: Run, addresses: readonly string[]): Promise<Record<string, Holding>> {
  const { chain } = run.round;
  return holdings(run, addresses, chain ? await chain.fresh() : undefined);
}

/** The deal's state and event log from each operator, and whether they agree on both. */
export async function operatorView(run: Run, agent: Agent, id: Hex): Promise<NonNullable<DealRecord['operators']>> {
  const views = await Promise.all(
    agent.sources().map(async (api) => {
      const [s, events] = await Promise.all([get(agent, `/v1/commitments/${id}`, api), eventsOf(agent, id, api)]);
      return { origin: new URL(api).origin, escrowState: s.escrowState, appealState: s.appealState, events: events.length, head: events.at(-1)?.hash ?? null };
    }),
  );
  const agree = views.every((v) => v.escrowState === views[0]!.escrowState && v.events === views[0]!.events && v.head === views[0]!.head);
  return { views, agree };
}

/**
 * The club membership and the test tokens a party needs: the faucet admits and grants once an hour per address; past
 * that, on a chain, the key mints its own (tUSDC is open-mint) and pays the gas from its own Sepolia ETH.
 */
export async function ensureFunds(run: Run, role: Role, need: bigint): Promise<void> {
  const { round } = run;
  const agent = round.agent(role);
  const member = async () => ((await agent.trusted(`/v1/agents/${agent.address}`, (x) => x.mandates ?? []).catch(() => [])) as J[]).some((m) => m.clubId === round.demo.clubId);
  const balance = async () => BigInt((await holdingsNow(run, [agent.address]))[agent.address]!.token);
  if (!(await member()) || (await balance()) < need) {
    try {
      const grant = await agent.call('POST', '/v1/faucet', { address: agent.address });
      run.say(`faucet: ${role} ${short(agent.address)} admitted to ${grant.clubId}, granted ${round.amount(grant.granted.amount)}`);
    } catch (e) {
      run.say(`faucet: ${role} ${short(agent.address)} refused (${reason(e)})`);
    }
  }
  if (!(await member())) throw new Error(`${role} ${agent.address} holds no mandate in ${round.demo.clubId}, and the faucet did not admit it`);
  const held = await balance();
  if (held >= need) return;
  if (!round.chain) throw new Error(`${role} holds ${round.amount(held)}, needs ${round.amount(need)}, and the faucet is spent`);
  const minted = await round.chain.mint(round.key(role), agent.address, need - held);
  run.say(`minted ${round.amount(need - held)} to ${role} from its own key: ${round.chain.link(minted.tx)} (${minted.gasUsed} gas)`);
}

export interface OfferSpec {
  label: string;
  template: 'default' | 'checks-only';
  deliverable: J;
  price: string;
  checks?: J[];
  rubric?: J;
  timing?: Record<string, number>;
  adjudicators?: { primary: string; fallback: string; appeal: string };
  /** Which operator relays this deal's steps: 0 (the first) or 1. */
  relay?: number;
}

/** The demo club's shortest windows (discovery's `demo.minWindowSec`), so a scenario takes minutes. */
export const shortWindows = (run: Run, extra: Record<string, number> = {}) => {
  const m = run.round.demo.minWindowSec;
  return { judgeWithinSec: m, fallbackWithinSec: m, appealWindowSec: m, appealDecideSec: m, ...extra };
};

/** The seller offers through the API; the deal's record starts with every party's holdings. */
export async function offer(run: Run, spec: OfferSpec, parties: readonly string[]): Promise<Deal> {
  const { round } = run;
  const relay = spec.relay ?? 0;
  const seller = round.agent('seller', relay);
  const buyer = round.agent('buyer', relay);
  // Both parties need a mandate in the club before the offer; the buyer's tokens come at funding.
  await ensureFunds(run, 'seller', 0n);
  await ensureFunds(run, 'buyer', 0n);
  const before = await holdingsNow(run, parties);
  run.step = 'offer';
  const offered = await seller.offer({
    template: spec.template, clubId: round.demo.clubId, seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: spec.adjudicators ?? round.demo.adjudicators, price: { token: round.demo.token, amount: spec.price },
    deliverable: spec.deliverable, ...(spec.checks ? { checks: spec.checks } : {}), ...(spec.rubric ? { rubric: spec.rubric } : {}), timing: spec.timing ?? shortWindows(run),
  });
  const record: DealRecord = { label: spec.label, id: offered.id, relay: new URL(seller.operators[0]!).origin, transactions: [], balances: { before }, notes: [] };
  run.deals.push(record);
  run.say(`${short(offered.id)} ${offered.state.escrowState}: ${spec.label}, ${round.amount(spec.price)}, relayed by ${record.relay}`);
  return { label: spec.label, id: offered.id, terms: offered.terms, buyer, seller, record, sent: [] };
}

/**
 * The buyer's checks before agreeing, as try.ts makes them: the terms every operator serves equal the ones the
 * seller sent, the commitment ID recomputes, and the seller's signature recovers to the seller.
 */
export async function checkTerms(run: Run, deal: Deal): Promise<void> {
  run.step = 'check';
  const { id: servedId, signatures, ...served } = await deal.buyer.trusted(`/v1/commitments/${deal.id}/terms`);
  if (!same(served, deal.terms)) throw new Refusal('refusing to agree: the terms the operators serve are not the ones the seller sent');
  if (commitmentIdOf(deal.terms) !== deal.id || String(servedId).toLowerCase() !== deal.id) throw new Refusal('refusing to agree: the commitment ID does not match the terms');
  const signer = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', deal.terms, deal.buyer.domain), signature: signatures?.seller });
  if (signer.toLowerCase() !== deal.seller.address) throw new Refusal("refusing to agree: the seller's signature does not recover to the seller");
  run.say('the buyer: same terms on every operator, ID recomputed, seller signature recovers');
}

/** Offer, the demo primary's acceptance, and the buyer's checks: a deal ready to fund. */
export async function openDeal(run: Run, spec: OfferSpec, parties: readonly string[]): Promise<Deal> {
  const deal = await offer(run, spec, parties);
  run.step = 'accepted';
  await until(run, deal.buyer, deal.id, ['AcceptedByAdjudicator'], 120_000);
  run.say(`AcceptedByAdjudicator on every operator`);
  await checkTerms(run, deal);
  return deal;
}

/**
 * Re-reads one party's holdings as the deal's starting point, after a faucet grant or a mint and before any of the
 * deal's money moves, so the deltas show the deal alone. On a chain it reads no earlier than the mint's block
 * (`holdingsNow`): a node one block behind would otherwise answer the balance from before the mint.
 */
export async function refreshBefore(run: Run, deal: Deal, address: string): Promise<void> {
  const a = address.toLowerCase();
  if (a in deal.record.balances.before) deal.record.balances.before[a] = (await holdingsNow(run, [a]))[a]!;
}

/** The buyer agrees and funds: price and adjudication fee into the hold, and the operator fee it computes itself. */
export async function fund(run: Run, deal: Deal): Promise<void> {
  const { round } = run;
  const t = deal.terms;
  const schedule = await deal.buyer.operatorFeeSchedule();
  const operatorFee = schedule ? operatorFeeOf(t.price, schedule) : 0n;
  const hold = BigInt(t.price.amount) + BigInt(t.adjudication.fee.amount);
  await ensureFunds(run, 'buyer', hold + operatorFee);
  await refreshBefore(run, deal, deal.buyer.address);
  run.step = 'fund';
  const held = await deal.buyer.agreeAndFund(t, hold + operatorFee);
  if (held.escrowState !== 'Held' || held.hold?.amount?.amount !== hold.toString()) throw new Error(`expected Held with ${hold} base units, got ${held.escrowState} ${jcs(held.hold?.amount ?? null)}`);
  deal.operatorFee = operatorFee;
  deal.hold = hold;
  run.say(`Held: ${round.amount(hold)} held (price ${round.amount(t.price.amount)} + adjudication fee ${round.amount(t.adjudication.fee.amount)}), operator fee ${round.amount(operatorFee)}`);
}

/** The seller, once every operator shows Held: encrypt, upload, seal the key to each recipient, sign, deliver. */
export async function deliver(run: Run, deal: Deal, content: string): Promise<void> {
  run.step = 'deliver';
  await until(run, deal.seller, deal.id, ['Held'], 120_000);
  const { state, delivery } = await deal.seller.deliverAndShare(deal.terms, new TextEncoder().encode(content));
  deal.delivery = delivery;
  run.say(`${state.escrowState}: ${delivery.ciphertext.bytes} encrypted bytes, the key sealed to ${delivery.encryptedKeys.length - 1} adjudicators and the buyer`);
}

/** The buyer's released envelope opens the content key, and the work matches the hashes the seller signed. */
export async function buyerOpens(run: Run, deal: Deal, expected: string): Promise<boolean> {
  run.step = 'open';
  try {
    const opened = await deal.buyer.openDelivery(deal.id);
    deal.record.buyerOpened = opened === expected;
  } catch (e) {
    run.say(`the buyer could not open the work: ${reason(e)}`);
    deal.record.buyerOpened = false;
  }
  return deal.record.buyerOpened;
}

/** What each operator serves at the buyer's key read: the envelopes released to the buyer. */
export async function buyerKeys(deal: Deal): Promise<number[]> {
  return Promise.all(deal.buyer.sources().map(async (api) => (await get(deal.buyer, `/v1/commitments/${deal.id}/key?recipient=${deal.buyer.address}`, api)).items.length));
}

/**
 * Closes a deal's record: every transaction its events name (and those the round sent itself) read back from the
 * chain, dealOf and CPP's payment state, both operators' views, and every party's holdings after. The chain reads are
 * pinned to the deal's last transaction's block: a load-balanced RPC can answer the latest block from a node one block
 * behind, which in round 1's 2026-11-05 run reported 3d's dealOf and 10a's CPP state from before the deal's last step.
 */
export async function finish(run: Run, deal: Deal): Promise<void> {
  const { round } = run;
  run.step = 'evidence';
  const r = deal.record;
  const reader = round.agent('master');
  const events = await eventsOf(reader, deal.id, reader.operators[0]!);
  const steps = new Map<string, string[]>();
  for (const e of events) if (typeof e.payload?.tx === 'string') steps.set(e.payload.tx.toLowerCase(), [...(steps.get(e.payload.tx.toLowerCase()) ?? []), e.type]);
  for (const s of deal.sent) steps.set(s.tx.tx.toLowerCase(), [...(steps.get(s.tx.tx.toLowerCase()) ?? []), s.step]);
  let at: bigint | undefined;
  if (round.chain) {
    const sentBy = new Map(deal.sent.map((s) => [s.tx.tx.toLowerCase(), 'round']));
    r.transactions = [];
    for (const [tx, kinds] of steps) {
      const rec = await round.chain.transaction(tx as Hex);
      r.transactions.push({ ...rec, steps: kinds, link: round.chain.link(tx), sentBy: sentBy.get(tx) ?? 'operator' });
    }
    r.transactions.sort((a, b) => a.block - b.block);
    const last = r.transactions.at(-1)?.block;
    at = last === undefined ? undefined : BigInt(last);
    r.chain = { ...(await round.chain.deal(deal.id, at)), payment: await round.chain.payment(deal.terms, deal.id, at), ...(last === undefined ? {} : { block: last }) };
    for (const t of r.transactions) run.say(`${t.steps.join(', ').padEnd(28)} ${t.link} ${t.gasUsed} gas, block ${t.block}${t.status === 'success' ? '' : ' REVERTED'}`);
    run.say(`dealOf${last === undefined ? '' : ` after block ${last}`}: ${r.chain.stage}, appeal ${r.chain.appeal}; CPP capturable ${round.amount(r.chain.payment.capturable)}, refundable ${round.amount(r.chain.payment.refundable)}`);
  } else {
    r.notes.push('SimChain: no chain to read; the evidence is the operators\' view only');
  }
  r.operators = await operatorView(run, reader, deal.id);
  run.say(`operators: ${r.operators.views.map((v) => `${v.origin} ${v.escrowState}, ${v.events} events`).join('; ')}; ${r.operators.agree ? 'they agree' : 'THEY DISAGREE'}`);
  r.balances.after = await holdings(run, Object.keys(r.balances.before), at);
  if (round.chain) r.flows = Object.fromEntries(Object.keys(r.balances.before).map((a) => [a, flowOf(r, a)]));
}

/** The states in which a deal still holds the buyer's money (Defaulted on SimChain, until apply-default). */
const HOLDING = ['Agreed', 'Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Defaulted'];

/** A deal to look at after a scenario: its ID, and its last transaction's block when the run read one (`finish`). */
export type DealRef = { id: Hex; chain?: { block?: number } };

/**
 * The deals among `deals` that still hold money, by the chain's stage (or the operators' state on SimChain). On a chain
 * each is read at its last transaction's block or later, and never before the round's own last transaction
 * (`RoundChain.fresh`): in round 1's 2026-11-05 run, a latest-block read 1 to 15 s after 5a's default found its deal
 * Escalated, the state before that block, and stopped the eleven scenarios after 5a.
 */
export async function openDeals(run: Run, deals: readonly DealRef[] = run.deals): Promise<Array<{ id: Hex; state: string }>> {
  const { chain } = run.round;
  const open: Array<{ id: Hex; state: string }> = [];
  for (const d of deals) {
    let state: string;
    if (chain) {
      const fresh = await chain.fresh();
      const last = BigInt(d.chain?.block ?? 0);
      state = (await chain.deal(d.id, last > fresh ? last : fresh)).stage;
    } else {
      state = (await get(run.round.agent('master'), `/v1/commitments/${d.id}`)).escrowState;
    }
    if (HOLDING.includes(state)) open.push({ id: d.id, state });
  }
  return open;
}

/**
 * What the deal itself moved for `address`, in base units: the test token's Transfer logs to and from it among the
 * deal's own transactions, and HoldbackBonds' events for its bond and its free bond (the bond less what open deals
 * encumber). The round's buyer and seller play every deal, so a wallet's balance change across a deal can take in
 * another deal funded or paid in the same window: in round 1's 2026-11-05 run, 4's buyer showed -61.42 tUSDC and 5a's
 * seller 25 tUSDC from a second run's scenario 1. The relayer bundles only a deal's own operator fee with its funding,
 * so a deal's transactions carry no other deal's transfers [inferred from evm-settlement.ts, agreeAndFund].
 */
export function flowOf(r: DealRecord, address: string): Holding {
  const a = address.toLowerCase();
  const is = (x: unknown) => String(x).toLowerCase() === a;
  let token = 0n;
  let bond = 0n;
  let free = 0n;
  for (const t of r.transactions) {
    for (const l of t.logs) {
      const amount = BigInt(l.args?.amount ?? 0);
      if (l.contract === 'token' && l.event === 'Transfer') token += (is(l.args.to) ? amount : 0n) - (is(l.args.from) ? amount : 0n);
      if (l.contract !== 'bonds') continue;
      // [bond, free] for each HoldbackBonds event that names this address. A slash takes the amount from the bond and
      // from its encumbrance alike, so the free bond stays.
      const step: Record<string, [bigint, bigint]> = { BondDeposited: [amount, amount], BondWithdrawn: [-amount, -amount], BondEncumbered: [0n, -amount], BondReleased: [0n, amount], BondSlashed: [-amount, 0n] };
      if (l.event in step && is(l.args.adjudicator)) {
        bond += step[l.event]![0];
        free += step[l.event]![1];
      }
      if (l.event === 'AppealBondPaid' && l.args.toBond === true && is(l.args.to)) {
        bond += amount;
        free += amount;
      }
    }
  }
  return { token: token.toString(), bond: bond.toString(), free: free.toString() };
}

/**
 * What the deal moved for `address`, in base units: on a chain, from the deal's own transactions (`flowOf`), never a
 * wallet's change across the deal's window; on SimChain, which has no logs to read, the change in its balances.
 */
export const delta = (r: DealRecord, address: string, field: keyof Holding = 'token'): bigint =>
  r.chain
    ? BigInt(flowOf(r, address)[field])
    : BigInt(r.balances.after?.[address.toLowerCase()]?.[field] ?? '0') - BigInt(r.balances.before[address.toLowerCase()]?.[field] ?? '0');

/** How long the gate after a scenario waits for a deal of the round's keys to settle, at most (ms): a scenario's windows are minutes. */
export const SETTLE_WAIT_MS = 15 * 60_000;

/** A timeout that closes a deal holding money: the trigger, the deadline it waits for, when it is due, and when the deal can be closed at the latest (ms). */
export type Timeout = { kind: 'reclaim' | 'fallback' | 'default' | 'apply-default'; deadline?: string; at: number; settleBy: number };

/**
 * The next timeout for a deal in `state`, from its terms' timing and the operators' deadlines; null when the deal holds
 * no money. Funded and undelivered: `reclaim` at deliverBy. Delivered: the fallback takeover at judgeBy, then the
 * default at fallbackBy. Escalated: the default at appealDecideBy, which an escalation sets no later than fallbackBy
 * plus appealDecideSec. Defaulted (SimChain): `apply-default` at once. A primary or fallback that decides first closes
 * the deal sooner; the gate reads it again on each pass.
 */
export function nextTimeout(state: string, timing: J, deadlines: Record<string, string> = {}): Timeout | null {
  const t = (iso: string) => Date.parse(iso);
  switch (state) {
    case 'Agreed':
    case 'Held':
      return { kind: 'reclaim', deadline: 'deliverBy', at: t(timing.deliverBy), settleBy: t(timing.deliverBy) };
    case 'Delivered':
      return { kind: 'fallback', deadline: 'judgeBy', at: t(timing.judgeBy), settleBy: t(timing.fallbackBy) };
    case 'FallbackJudging':
      return { kind: 'default', deadline: 'fallbackBy', at: t(timing.fallbackBy), settleBy: t(timing.fallbackBy) };
    case 'Escalated': {
      const by = deadlines['appealDecideBy'] ? t(deadlines['appealDecideBy']) : t(timing.fallbackBy) + Number(timing.appealDecideSec) * 1000;
      return { kind: 'default', deadline: 'appealDecideBy', at: by, settleBy: by };
    }
    case 'Defaulted':
      return { kind: 'apply-default', at: 0, settleBy: 0 };
    default:
      return null;
  }
}

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const tooEarly = (e: unknown) => /invalid_state: .*(has not passed|too ?early)/i.test(String((e as Error).message));

/**
 * Waits, at most `waitMs`, until none of `deals` holds money, and sends each deal's timeout through the API once it is
 * due: anyone may, and the operators relay a due timeout even for a deal behind the chain (T-228). It refuses at once a
 * deal whose timeouts cannot close it within the wait. Returns what it did, one line per step, for the record; an
 * empty list when nothing held money.
 */
export async function settleOpen(run: Run, deals: readonly DealRef[], o: { waitMs?: number; gapMs?: number } = {}): Promise<string[]> {
  const waitMs = o.waitMs ?? SETTLE_WAIT_MS;
  const reader = run.round.agent('master');
  const lines: string[] = [];
  const terms = new Map<string, J>();
  // Each trigger is sent once per deal: the next pass may still read the state from before it.
  const sent = new Set<string>();
  const started = Date.now();
  const end = started + waitMs;
  let waited: Array<{ id: Hex; state: string }> = [];
  let last = '';
  for (;;) {
    const open = await openDeals(run, deals).catch((e) => {
      last = `reading the deals: ${reason(e)}`;
      return null;
    });
    if (open && !open.length) {
      if (waited.length) lines.push(`waited ${Math.round((Date.now() - started) / 1000)} s for ${waited.map((d) => `${short(d.id)} (${d.state})`).join(', ')} to settle`);
      return lines;
    }
    if (open) {
      waited = open;
      const now = await retry(() => reader.settlementNow());
      for (const d of open) {
        if (!terms.has(d.id)) terms.set(d.id, await get(reader, `/v1/commitments/${d.id}/terms`));
        const view = await get(reader, `/v1/commitments/${d.id}`);
        const next = nextTimeout(d.state, terms.get(d.id).timing, view.deadlines ?? {});
        if (!next) continue;
        if (next.settleBy > now + (end - Date.now())) {
          throw new Error(`${d.id} still holds money: it is ${d.state}, and its timeouts can close it only at ${iso(next.settleBy)}, after this run's ${waitMs / 60_000}-minute wait ends; run the remaining scenarios after then`);
        }
        if (now < next.at || sent.has(`${d.id}/${next.kind}`)) continue;
        try {
          await reader.call('POST', `/v1/commitments/${d.id}/triggers/${next.kind}`, {});
          sent.add(`${d.id}/${next.kind}`);
          lines.push(`${short(d.id)} was ${d.state}${next.deadline ? ` past ${next.deadline} ${iso(next.at)}` : ''}: the driver sent ${next.kind} through the API at ${iso(now)}`);
          run.say(lines.at(-1)!);
        } catch (e) {
          if (!tooEarly(e)) last = `${next.kind} for ${short(d.id)}: ${reason(e)}`;
        }
      }
    }
    if (Date.now() >= end) throw new Error(`${(open ?? waited).map((d) => `${d.id} is still ${d.state}`).join('; ') || "the round's deals could not be read"} after this run's ${waitMs / 60_000}-minute wait${last ? `; last refusal: ${last}` : ''}; run the remaining scenarios once it settles`);
    await sleep(o.gapMs ?? 5000);
  }
}

/** Every commitment state an operator lists for `query`, following `nextCursor`. */
async function listed(agent: Agent, query: string): Promise<J[]> {
  const out: J[] = [];
  let cursor: string | null = null;
  do {
    const page: J = await get(agent, `/v1/commitments?${query}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** The round buyer's deals that still hold money, as the operators list them, with their state and last change: an earlier run's included. */
export async function heldDeals(run: Run): Promise<Array<DealRef & { state: string; updatedAt: string }>> {
  const states = HOLDING.map((s) => `escrowState=${s}`).join('&');
  return (await listed(run.round.agent('master'), `party=${run.round.address('buyer')}&role=buyer&${states}`)).map((v) => ({ id: v.commitmentId as Hex, state: v.escrowState, updatedAt: v.updatedAt }));
}

/** How recently a held deal must have changed for the start to take it as another run's deal in progress (ms). */
export const ACTIVE_MS = 2 * 60_000;

/**
 * Refuses to start while a deal of the round's buyer that holds money changed less than ACTIVE_MS before `nowMs`
 * (settlement time): another run, from another checkout, may still be driving it, and the start gate must not send
 * its timeouts. An older one is a stopped run's, and the start gate closes it.
 */
export function refuseActive(held: ReadonlyArray<{ id: Hex; state: string; updatedAt: string }>, nowMs: number): void {
  const active = held.filter((d) => nowMs - Date.parse(d.updatedAt) < ACTIVE_MS);
  if (!active.length) return;
  throw new Refusal(`refusing to start: ${active.map((d) => `${d.id} (${d.state}) changed at ${d.updatedAt}`).join('; ')}, less than ${ACTIVE_MS / 60_000} minutes before this run, and still holds money; another run of the round's keys may be driving it. Run again once it ends`);
}

/**
 * The round buyer's deals that another run offered: changed since `sinceMs` (settlement time), offered at or after it,
 * and not among `ours`. Every round deal has the same buyer and seller, so a second run of the same keys shows here
 * whichever checkout it runs from.
 */
export async function otherRunDeals(run: Run, ours: ReadonlySet<string>, sinceMs: number): Promise<Array<{ id: Hex; state: string; createdAt: string }>> {
  const reader = run.round.agent('master');
  const recent = (await listed(reader, `party=${run.round.address('buyer')}&role=buyer`)).filter((v) => !ours.has(String(v.commitmentId).toLowerCase()) && Date.parse(v.updatedAt) >= sinceMs);
  const out: Array<{ id: Hex; state: string; createdAt: string }> = [];
  for (const v of recent) {
    const t = await get(reader, `/v1/commitments/${v.commitmentId}/terms`);
    if (Date.parse(t.createdAt) >= sinceMs) out.push({ id: v.commitmentId, state: v.escrowState, createdAt: t.createdAt });
  }
  return out;
}

/** The round's lock: one file per master in the reports folder, held by the process that runs the round. */
export interface RunLock { path: string; pid: number; startedAt: string; folder: string }

export const lockFile = (dir: string, master: string): string => join(dir, `run-${master.toLowerCase()}.lock`);

/** Whether process `pid` is running: signal 0 checks without sending anything; EPERM means it runs as another user. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Takes the round's lock for this process, so two runs of the same round keys never overlap: round 1's 2026-11-05 runs
 * from 19:07 and 19:35 UTC did, from the same checkout, and each counted the other's deals. Refuses while the process
 * named in the lock runs; takes over a lock its process left behind, and says so in `tookOver`.
 */
export function takeLock(dir: string, master: string, o: { folder: string }): { lock: RunLock; tookOver?: string } {
  mkdirSync(dir, { recursive: true });
  const path = lockFile(dir, master);
  const lock: RunLock = { path, pid: process.pid, startedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), folder: o.folder };
  const body = `${JSON.stringify({ pid: lock.pid, startedAt: lock.startedAt, folder: lock.folder })}\n`;
  try {
    writeFileSync(path, body, { flag: 'wx' });
    return { lock };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  let held: { pid?: number; startedAt?: string; folder?: string } = {};
  try {
    held = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // An unreadable lock names no process: taken over below.
  }
  if (typeof held.pid === 'number' && alive(held.pid)) {
    throw new Refusal(`refusing to start: another run of the round's keys is in progress (process ${held.pid}, started ${held.startedAt ?? 'at an unknown time'}, writing ${held.folder ?? 'an unknown folder'}). Two runs share the buyer, the seller and the round's adjudicators, so each would count the other's deals. Wait for it to end or stop it, then run again; if no run is in progress, delete ${path}`);
  }
  writeFileSync(path, body);
  return { lock, tookOver: `the lock of an earlier run (process ${held.pid ?? 'unknown'}, started ${held.startedAt ?? 'at an unknown time'}) was left behind; that process has ended, so this run takes it over` };
}

/** Gives the lock back, unless another process has taken it since. */
export function releaseLock(lock: RunLock): void {
  try {
    if (JSON.parse(readFileSync(lock.path, 'utf8')).pid === lock.pid) unlinkSync(lock.path);
  } catch {
    // Already gone, or unreadable: nothing of ours to give back.
  }
}

/** The decoded logs of the deal's transactions, optionally of one event. */
export const logsOf = (r: DealRecord, event?: string) => r.transactions.flatMap((t) => t.logs.filter((l) => !event || l.event === event).map((l) => ({ ...l, tx: t.tx })));
