// The machinery of the first full EVM end-to-end round (T-216): the round's agents, one scenario's run with its
// checks and evidence, and the deal steps the scenarios share. Every step goes through the public API as an outside
// agent's would, with agent.ts and verify.ts (the code behind try.mjs, which llms.txt points to): each message an
// operator prepares is rebuilt from the round's own intent and checked before a round key signs it.
//
// Evidence per deal (T-216, How the round runs): the commitment ID; each transaction with its Etherscan link, gas and
// block; dealOf's stage and CPP's payment state; the balances and bonds of every party before and after; the state
// and event log from both operators, and whether they agree; whether the buyer could open the work.
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
  const balance = async () => BigInt((await holdings(run, [agent.address]))[agent.address]!.token);
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
  const before = await holdings(run, parties);
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
 * deal's money moves, so the deltas show the deal alone.
 */
export async function refreshBefore(run: Run, deal: Deal, address: string): Promise<void> {
  const a = address.toLowerCase();
  if (a in deal.record.balances.before) deal.record.balances.before[a] = (await holdings(run, [a]))[a]!;
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
}

/** The states in which a deal still holds the buyer's money. */
const HOLDING = ['Agreed', 'Held', 'Delivered', 'FallbackJudging', 'Escalated'];

/**
 * The run's deals that still hold money, by the chain's stage (or the operators' state on SimChain). After a scenario
 * stops, one of these would settle inside the next scenario's balance window, since every deal has the same parties.
 */
export async function openDeals(run: Run): Promise<Array<{ id: Hex; state: string }>> {
  const open: Array<{ id: Hex; state: string }> = [];
  for (const d of run.deals) {
    const state = run.round.chain ? (await run.round.chain.deal(d.id)).stage : (await get(run.round.agent('master'), `/v1/commitments/${d.id}`)).escrowState;
    if (HOLDING.includes(state)) open.push({ id: d.id, state });
  }
  return open;
}

/** Change in token balance of `address` across the deal, in base units. */
export const delta = (r: DealRecord, address: string, field: keyof Holding = 'token'): bigint =>
  BigInt(r.balances.after?.[address.toLowerCase()]?.[field] ?? '0') - BigInt(r.balances.before[address.toLowerCase()]?.[field] ?? '0');

/** The decoded logs of the deal's transactions, optionally of one event. */
export const logsOf = (r: DealRecord, event?: string) => r.transactions.flatMap((t) => t.logs.filter((l) => !event || l.event === event).map((l) => ({ ...l, tx: t.tx })));
