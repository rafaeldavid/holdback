// Sends a deal's due timeout to HoldbackRules with no operator and no Crow service (T-365, the cutover's gap 2).
// Every timeout in the rules contract is permissionless: once a deadline has passed, anyone may send the step that
// moves the deal on, and it needs no party's signature, only a transaction from any funded sender. Each call takes the
// deal's full terms, which the parties hold. This command takes those terms and the deployment record, reads the
// deal's stage from `dealOf` and the chain's own clock, and sends the one timeout due now, if any.
//
//   node --env-file-if-exists=.env examples/send-timeout.ts --terms <file> --deployment <file> [--rpc <url>] [--dry-run]
//
// --terms       the deal's terms as JSON: the body GET /v1/commitments/<id>/terms serves a party, or a buyer
//               signer's `checked.terms` (`jq .checked.terms <key file>`). Public or private wire form.
// --deployment  a deployment record, such as contracts/deployments/sepolia.json.
// --rpc         the chain's RPC URL; SEPOLIA_RPC_URL when omitted.
// --dry-run     reads and prints the plan, then stops: nothing is signed or sent.
//
// The sender key comes from TIMEOUT_SENDER_KEY, only for a real send; it is never printed. Exit 0 when the timeout was
// sent (or the dry run printed it), 1 on a refusal or a failed send, 2 on a bad command line.
//
// It sends only reclaim, triggerFallback and triggerDefault, the timeouts of the phase-one contracts (EIP-712 domain
// 0.8, ADR-0031). An unfunded offer stores nothing on chain, so it has no timeout to send (§7), and a decision is final
// when written, so no appeal expires (§8). It never signs or sends a party's message, a decision, a delivery or a
// settlement. The contracts on main (domain 0.7) take main's version of this command, from a checkout of main.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getAddress, hashStruct, isHex, keccak256, toBytes, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { DeploymentFile } from './deployments.ts';
import { assertRoundChain, RoundChain, STAGES, type TxRecord } from './e2e-chain.ts';
import { jcsHash, Refusal, TYPES } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The environment variable that holds the sender's key: any funded key, since a timeout needs no party's signature. */
export const SENDER_KEY_VAR = 'TIMEOUT_SENDER_KEY';

/** The timeouts the phase-one HoldbackRules exposes, and nothing else this command can send. */
export const TIMEOUT_FUNCTIONS = ['reclaim', 'triggerFallback', 'triggerDefault'] as const;
export type TimeoutFunction = (typeof TIMEOUT_FUNCTIONS)[number];

const ABIS = JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as Record<'rules', Abi>;

const lc = (a: string) => a.toLowerCase();
const HEX32 = /^0x[0-9a-f]{64}$/;
const iso = (sec: bigint | number) => new Date(Number(sec) * 1000).toISOString().replace('.000Z', 'Z');

// The command line

export type Args = { terms: string; deployment: string; rpc: string | null; dryRun: boolean };

/** The command line: the known options only, so a mistyped --dry-run never sends. */
export function parseArgs(argv: readonly string[]): Args | { error: string } {
  const out: { terms?: string; deployment?: string; rpc?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    const key = { '--terms': 'terms', '--deployment': 'deployment', '--rpc': 'rpc' }[a] as 'terms' | 'deployment' | 'rpc' | undefined;
    if (!key) return { error: `send-timeout does not take ${a}` };
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    if (out[key] !== undefined) return { error: `${a} is given twice` };
    out[key] = v;
  }
  if (!out.terms) return { error: 'send-timeout needs --terms <file>' };
  if (!out.deployment) return { error: 'send-timeout needs --deployment <file>' };
  return { terms: out.terms, deployment: out.deployment, rpc: out.rpc ?? null, dryRun: out.dryRun };
}

export const USAGE = 'usage: node --env-file-if-exists=.env examples/send-timeout.ts --terms <file> --deployment <file> [--rpc <url>] [--dry-run]';

// The inputs

const readJson = (file: string, what: string): J => {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Refusal(`refusing: cannot read the ${what} file ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal(`refusing: the ${what} file ${file} is not JSON`);
  }
};

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

/** A deployment record with the fields this command reads, or a refusal naming the first one missing. */
export function deploymentOf(d: J, file = 'the deployment record'): DeploymentFile {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Refusal(`refusing: ${file} is not a deployment record`);
  if (!Number.isSafeInteger(d.chainId)) throw new Refusal(`refusing: ${file} has no chainId`);
  for (const k of ['rules', 'escrow', 'multicall'] as const) if (!isAddress(d[k])) throw new Refusal(`refusing: ${file} has no ${k} address`);
  if (!isAddress(d.token?.address)) throw new Refusal(`refusing: ${file} has no token address`);
  return d as DeploymentFile;
}

/**
 * The body hashes the commitment ID binds: from the bodies in the clear (public), or from privateTerms (private and
 * judgment), whose hashes are the same ones (ADR-0024). An outsider's projection carries neither set with the rest of
 * the terms, so it is refused.
 */
function bodyHashesOf(t: J): { deliverableHash: Hex; acceptanceHash: Hex } {
  if (t.deliverable !== undefined && t.acceptance !== undefined) return { deliverableHash: jcsHash(t.deliverable), acceptanceHash: jcsHash(t.acceptance) };
  const d = t.privateTerms?.deliverable?.hash;
  const a = t.privateTerms?.acceptance?.hash;
  if (typeof d === 'string' && HEX32.test(lc(d)) && typeof a === 'string' && HEX32.test(lc(a))) return { deliverableHash: lc(d) as Hex, acceptanceHash: lc(a) as Hex };
  throw new Refusal('refusing: the terms carry neither the deliverable and acceptance bodies nor privateTerms with their hashes. An operator serves outsiders only a projection of a private deal; the buyer and the seller hold the full terms');
}

const seconds = (v: unknown, name: string): bigint => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || ms % 1000 !== 0) throw new Refusal(`refusing: the terms' ${name} is not a whole-second timestamp`);
  return BigInt(ms / 1000);
};
const count = (v: unknown, name: string): bigint => {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Refusal(`refusing: the terms' ${name} is not a whole number of seconds`);
  return BigInt(v as number);
};

/** The terms, normalized once: the commitment ID and the HoldbackRules tuple are both built from these values. */
function normalized(t: J) {
  const required = ['schemaVersion', 'clubId', 'rulebookHash', 'buyer', 'seller', 'buyerPaymentAddress', 'sellerPayoutAddress', 'price', 'adjudication', 'timing', 'settlement', 'remedy', 'disclosure', 'buyerEncryptionPublicKey', 'nonce', 'createdAt'];
  const missing = required.filter((k) => t?.[k] === undefined);
  if (missing.length) throw new Refusal(`refusing: the terms lack ${missing.join(', ')}; pass the deal's full signed terms`);
  // ADR-0033: the two money addresses are signed fields; a refund goes to the payment address, a release to the payout address.
  for (const k of ['buyerPaymentAddress', 'sellerPayoutAddress'] as const) if (!isAddress(t[k])) throw new Refusal(`refusing: the terms' ${k} is not an address`);
  // HoldbackRules hashes the settlement as guaranteed_on_decision in the price's token (HoldbackTypes.commitmentId):
  // terms with another mode or token would name a different commitment on chain from the one they sign.
  if (t.settlement.mode !== 'guaranteed_on_decision' || t.settlement.token !== t.price.token) {
    throw new Refusal(`refusing: these contracts settle only guaranteed_on_decision in the price's token; the terms say ${JSON.stringify(t.settlement)}`);
  }
  // The contract rebuilds every token string from one address, as lowercase hex (ADR-0025, HoldbackTypes.tokenIdHash):
  // a fee in another token, or a mixed-case address, would hash to another commitment than the terms' own.
  if (typeof t.price.token !== 'string' || !/^0x[0-9a-f]{40}$/.test(t.price.token) || t.adjudication?.fee?.token !== t.price.token) {
    throw new Refusal(`refusing: on these contracts the price and the fee are in one token, named by its lowercase address; the terms name ${JSON.stringify(t.price.token)} and ${JSON.stringify(t.adjudication?.fee?.token)}`);
  }
  const tm = t.timing;
  const timing = {
    offerExpiresAt: seconds(tm.offerExpiresAt, 'offerExpiresAt'), fundBy: seconds(tm.fundBy, 'fundBy'), deliverBy: seconds(tm.deliverBy, 'deliverBy'),
    judgeBy: seconds(tm.judgeBy, 'judgeBy'), fallbackBy: seconds(tm.fallbackBy, 'fallbackBy'),
    appealWindowSec: count(tm.appealWindowSec, 'appealWindowSec'), appealDecideSec: count(tm.appealDecideSec, 'appealDecideSec'), maxSubmissions: Number(tm.maxSubmissions),
    // As packages/core encodes them: absent dispute fields are zero.
    disputeBy: tm.disputeBy === undefined ? 0n : seconds(tm.disputeBy, 'disputeBy'),
    disputeJudgeSec: tm.disputeJudgeSec === undefined ? 0n : count(tm.disputeJudgeSec, 'disputeJudgeSec'),
    disputeFallbackSec: tm.disputeFallbackSec === undefined ? 0n : count(tm.disputeFallbackSec, 'disputeFallbackSec'),
  };
  return { t, timing, ...bodyHashesOf(t), createdAt: seconds(t.createdAt, 'createdAt') };
}
type Normalized = ReturnType<typeof normalized>;

/** The commitment ID: the EIP-712 struct hash of the terms under the pinned types (verify.ts, packages/core). */
const idOf = (n: Normalized): Hex => {
  const { t } = n;
  const amt = (a: J) => ({ token: a.token, amount: BigInt(a.amount) });
  const message = {
    schemaVersion: t.schemaVersion, clubId: t.clubId, rulebookHash: t.rulebookHash, buyer: t.buyer, seller: t.seller,
    buyerPaymentAddress: t.buyerPaymentAddress, sellerPayoutAddress: t.sellerPayoutAddress, deliverableHash: n.deliverableHash, acceptanceHash: n.acceptanceHash,
    price: amt(t.price), adjudication: { ...t.adjudication, fee: amt(t.adjudication.fee) }, timing: n.timing, settlement: t.settlement, remedy: t.remedy, disclosure: t.disclosure,
    buyerEncryptionPublicKey: t.buyerEncryptionPublicKey, nonce: t.nonce, createdAt: n.createdAt,
  };
  return hashStruct({ types: TYPES, primaryType: 'CommitmentTerms', data: message } as Parameters<typeof hashStruct>[0]);
};

/** HoldbackTypes.Terms, the argument every timeout takes: the same values, the strings and nested structs as their hashes. */
const tupleOf = (n: Normalized) => {
  const { t } = n;
  // EIP-712 encodes a string as its keccak256.
  const str = (s: string): Hex => keccak256(toBytes(s));
  return {
    schemaVersionHash: str(t.schemaVersion), clubIdHash: str(t.clubId), rulebookHash: t.rulebookHash as Hex, buyer: getAddress(t.buyer), seller: getAddress(t.seller),
    buyerPaymentAddress: getAddress(t.buyerPaymentAddress), sellerPayoutAddress: getAddress(t.sellerPayoutAddress), // ADR-0033
    deliverableHash: n.deliverableHash, acceptanceHash: n.acceptanceHash, token: getAddress(t.price.token), price: BigInt(t.price.amount),
    adjudicator: getAddress(t.adjudication.adjudicator), fallbackAdjudicator: getAddress(t.adjudication.fallbackAdjudicator), appealAdjudicator: getAddress(t.adjudication.appealAdjudicator),
    policyIdHash: str(t.adjudication.policyId), fee: BigInt(t.adjudication.fee.amount), registryHash: t.adjudication.registryHash as Hex, policyHash: t.adjudication.policyHash as Hex,
    timing: n.timing,
    remedyHash: hashStruct({ types: TYPES, primaryType: 'Remedy', data: t.remedy }), disclosureHash: hashStruct({ types: TYPES, primaryType: 'Disclosure', data: t.disclosure }),
    buyerKeyHash: str(t.buyerEncryptionPublicKey), nonce: t.nonce as Hex, createdAt: n.createdAt,
  };
};

export type Deal = { id: Hex; terms: J; tuple: ReturnType<typeof tupleOf>; timing: Normalized['timing'] };

/**
 * The deal the terms file names: its terms and the tuple the contract takes, or a refusal. The file must not be a key
 * file, and when it carries an `id`, the terms must hash to it.
 */
export function dealOfTerms(raw: J): Deal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Refusal('refusing: the terms file is not a JSON object');
  if ('privateKey' in raw || 'encryptionSecretKey' in raw) {
    throw new Refusal("refusing: the terms file holds a key; pass only the deal's terms, such as `jq .checked.terms <key file> > terms.json`");
  }
  const n = normalized(raw);
  const id = idOf(n);
  if (raw.id !== undefined && lc(String(raw.id)) !== id) throw new Refusal(`refusing: the terms name the commitment ID ${raw.id}, but they hash to ${id}`);
  return { id, terms: raw, tuple: tupleOf(n), timing: n.timing };
}

// The plan

/** `dealOf` as this command reads it: the stage and `t1` (the time of the decision, the escalation or the takeover). */
export type OnChain = { stage: string; t1: bigint };

export type Plan =
  | { kind: 'due'; fn: TimeoutFunction; deadline: string; at: bigint; effect: string }
  | { kind: 'wait'; fn: TimeoutFunction; deadline: string; at: bigint }
  | { kind: 'closed'; why: string };

/**
 * The timeout due for a deal in `d` at chain time `now` (seconds), by the phase-one HoldbackRules' own checks: each
 * timeout's stage guard and its `block.timestamp < deadline` refusal. The next block's time is at least `now`, so a
 * deadline at or before `now` is due when the transaction lands.
 */
export function planTimeout(d: OnChain, timing: Deal['timing'], now: bigint): Plan {
  const at = (fn: TimeoutFunction, deadline: string, when: bigint, effect: string): Plan => (now >= when ? { kind: 'due', fn, deadline, at: when, effect } : { kind: 'wait', fn, deadline, at: when });
  const refund = "the price and fee go back to the buyer's payment address";
  switch (d.stage) {
    case 'None':
      // ADR-0031 §7: no on-chain record of an unfunded offer, so nothing to expire; the operators mark it by their clock.
      return { kind: 'closed', why: 'it is None: nothing is held on chain. An unfunded offer stores nothing on these contracts, and from offerExpiresAt or fundBy it can no longer be funded' };
    case 'Held':
      return at('reclaim', 'deliverBy', timing.deliverBy, `nothing was delivered: ${refund}`);
    case 'Delivered':
      return at('triggerFallback', 'judgeBy', timing.judgeBy, 'the primary adjudicator missed judgeBy: the fallback adjudicator takes over until fallbackBy');
    case 'FallbackJudging':
      return at('triggerDefault', 'fallbackBy', timing.fallbackBy, `the fallback adjudicator missed fallbackBy: ${refund}`);
    case 'Escalated':
      return at('triggerDefault', `appealDecideBy (escalated at ${iso(d.t1)} + appealDecideSec ${timing.appealDecideSec} s)`, d.t1 + timing.appealDecideSec, `the appeal adjudicator missed its deadline: ${refund}`);
    case 'Released':
    case 'Refunded':
      // ADR-0031 §8: no party appeal, so a decision is final when written.
      return { kind: 'closed', why: `it is ${d.stage}: the decision is final` };
    case 'Settled':
      return { kind: 'closed', why: 'it is Settled: both parties signed a settlement' };
    default:
      return { kind: 'closed', why: `dealOf reads an unknown stage, ${d.stage}` };
  }
}

// The run

export type Io = { say(line: string): void; env: Record<string, string | undefined> };

/**
 * The rules contract must have code and sign under Holdback's EIP-712 domain at the terms' version on the record's
 * chain and address. The phase-one contracts sign under 0.8 (T-358), so the domain check alone refuses the contracts on
 * main, which sign under 0.7 and keep other timeouts.
 */
async function checkDomain(chain: RoundChain, d: DeploymentFile, terms: J): Promise<void> {
  const rules = getAddress(d.rules);
  const code = await chain.client.getCode({ address: rules });
  if (!code || code === '0x') throw new Refusal(`refusing: the deployment record's rules contract ${rules} has no code on chain ${d.chainId}`);
  let domain: readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
  try {
    domain = (await chain.client.readContract({ address: rules, abi: ABIS.rules, functionName: 'eip712Domain' })) as typeof domain;
  } catch {
    throw new Refusal(`refusing: ${rules} on chain ${d.chainId} does not answer eip712Domain(); it is not a HoldbackRules contract`);
  }
  const [, name, version, chainId, verifyingContract] = domain;
  const want = `Holdback ${terms.schemaVersion}, chain ${d.chainId}, ${lc(rules)}`;
  const got = `${name} ${version}, chain ${chainId}, ${lc(verifyingContract)}`;
  if (got !== want) throw new Refusal(`refusing: the rules contract signs under ${got}, and the terms are signed under ${want}`);
}

/** Reads dealOf at block `at`. */
async function onChain(chain: RoundChain, d: DeploymentFile, id: Hex, at: bigint): Promise<OnChain> {
  const r = (await chain.client.readContract({ address: getAddress(d.rules), abi: ABIS.rules, functionName: 'dealOf', args: [id], blockNumber: at })) as { stage: number; t1: number | bigint };
  return { stage: STAGES[r.stage] ?? `stage ${r.stage}`, t1: BigInt(r.t1) };
}

/** The sender's key from the environment, checked for shape only; no message carries its value. */
function senderKey(env: Io['env']): Hex {
  const k = env[SENDER_KEY_VAR];
  if (!k) throw new Refusal(`refusing to send: ${SENDER_KEY_VAR} is not set. Any key with gas can send a timeout; run with --dry-run to see the plan without one`);
  if (!isHex(k) || k.length !== 66) throw new Refusal(`refusing to send: ${SENDER_KEY_VAR} is not a 32-byte hex private key (0x and 64 hex digits)`);
  // A key of the right shape can still be out of the curve's range; viem's error would print it, so it is replaced.
  try {
    privateKeyToAccount(k);
  } catch {
    throw new Refusal(`refusing to send: ${SENDER_KEY_VAR} is not a valid secp256k1 private key`);
  }
  return k;
}

/** The HoldbackRules events of a transaction that name the commitment `id`. */
const eventsFor = (tx: TxRecord, id: Hex) => tx.logs.filter((l) => l.contract === 'rules' && lc(String(l.args.id ?? l.args.jobId ?? '')) === id).map((l) => l.event);

/**
 * Reads the deal, prints the plan in one line, and with `dryRun` false sends the one due timeout. Returns the exit
 * code: 0 when sent (or planned in a dry run), 1 when the send failed. A refusal throws.
 */
export async function sendTimeout(args: Args, io: Io): Promise<number> {
  const deployment = deploymentOf(readJson(args.deployment, 'deployment'), args.deployment);
  // The record's own chain first, before any connection: a mainnet record is refused by name.
  assertRoundChain(deployment.chainId, deployment.chainId);
  const deal = dealOfTerms(readJson(args.terms, 'terms'));
  const rpc = args.rpc ?? io.env['SEPOLIA_RPC_URL'];
  if (!rpc) throw new Refusal('refusing: give the chain\'s RPC URL with --rpc, or set SEPOLIA_RPC_URL');
  const key = args.dryRun ? null : senderKey(io.env);

  const chain = await RoundChain.open(rpc, deployment);
  await checkDomain(chain, deployment, deal.terms);
  const block = await chain.client.getBlock({ blockTag: 'latest' });
  const now = block.timestamp;
  const before = await onChain(chain, deployment, deal.id, block.number);
  const plan = planTimeout(before, deal.timing, now);
  const where = `on chain ${deployment.chainId} (rules ${lc(deployment.rules)})`;
  const clock = `the latest block ${block.number} is at ${iso(now)}`;
  if (plan.kind === 'closed') throw new Refusal(`refusing: no timeout remains for ${deal.id} ${where}: ${plan.why}`);
  if (plan.kind === 'wait') {
    throw new Refusal(`refusing: no timeout is due for ${deal.id}, ${before.stage} ${where}. The next one, ${plan.fn}, opens at ${plan.deadline} ${iso(plan.at)}, in ${plan.at - now} s; ${clock}`);
  }
  io.say(`${deal.id} is ${before.stage} ${where}: ${plan.deadline} passed at ${iso(plan.at)} and ${clock}. Due: ${plan.fn}, which ${plan.effect}.`);
  if (args.dryRun) {
    io.say('dry run: nothing signed or sent');
    return 0;
  }

  const sender = privateKeyToAccount(key!).address;
  if ((await chain.ethBalance(sender)) === 0n) throw new Refusal(`refusing to send: the sender ${sender} has no ETH for gas on chain ${deployment.chainId}`);
  let tx: TxRecord;
  try {
    // RoundChain.send simulates the call first, so a refusal reads as the contract's revert, then caps the fee.
    tx = await chain.send(key!, 'rules', plan.fn, [deal.tuple]);
  } catch (e) {
    const after = await onChain(chain, deployment, deal.id, await chain.fresh()).catch(() => null);
    io.say(`${plan.fn} failed: ${(e as Error).message.split('\n')[0]}${after ? `; dealOf now reads ${after.stage}` : ''}`);
    return 1;
  }
  const after = await onChain(chain, deployment, deal.id, BigInt(tx.block));
  const named = eventsFor(tx, deal.id);
  if (tx.status !== 'success' || named.length === 0) {
    io.say(`${plan.fn} did not move ${deal.id}: transaction ${tx.tx} ${tx.status} in block ${tx.block}, with ${named.length ? named.join(', ') : 'no event naming the deal'}; dealOf reads ${after.stage}`);
    return 1;
  }
  io.say(`sent ${plan.fn} from ${sender}: transaction ${tx.tx} in block ${tx.block}, ${Number(tx.gasUsed).toLocaleString('en-US')} gas, events ${named.join(', ')}. ${deal.id} is now ${after.stage}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(`${args.error}\n${USAGE}`);
    process.exit(2);
  }
  let code: number;
  try {
    code = await sendTimeout(args, { say: (l) => console.log(l), env: process.env });
  } catch (e) {
    console.error(e instanceof Refusal ? e.message : `failed: ${(e as Error).message.split('\n')[0]}`);
    code = 1;
  }
  process.exit(code);
}
