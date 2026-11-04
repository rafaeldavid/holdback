// Operator proposes, agent verifies. An operator's /v1/prepare answer is a proposal: before signing, the agent
// rebuilds the message from its own intent (what it asked for, the terms it agreed to, the hashes it computed),
// pins the EIP-712 domain and types from its own configuration, picks its own nonces, and accepts from the
// operator only a time within bounds of settlement-layer time. Any other difference, in the typed data, the digest, the slots or the body,
// refuses. The agent then signs its own typed data and submits its own body. Standard libraries only (viem), and
// tweetnacl with Web Crypto to open the buyer's own envelope before an early accept (openOwnEnvelope).
import nacl from 'tweetnacl';
import { encodeAbiParameters, hashStruct, hashTypedData, keccak256, parseAbiParameters, recoverTypedDataAddress, toBytes, type Hex } from 'viem';
import { SEPOLIA, type DeploymentFile } from './deployments.ts';

export type Domain = { name: 'Holdback'; version: string; chainId: number; verifyingContract: Hex };
/** SimChain's domain, as `pnpm sim` prints it. Configure yours; never take it from an operator. */
export const SIMCHAIN_DOMAIN: Domain = { name: 'Holdback', version: '0.7', chainId: 31337, verifyingContract: '0x00000000000000000000000000000000484f4c44' };
export const configuredDomain = (): Domain => ({
  ...SIMCHAIN_DOMAIN,
  ...(process.env['HOLDBACK_CHAIN_ID'] ? { chainId: Number(process.env['HOLDBACK_CHAIN_ID']) } : {}),
  ...(process.env['HOLDBACK_VERIFYING_CONTRACT'] ? { verifyingContract: process.env['HOLDBACK_VERIFYING_CONTRACT'] as Hex } : {}),
});

/**
 * On a chain, what the buyer funds through (ADR-0025): the token's own EIP-712 domain, the escrow and its ERC-3009
 * collector, the rules contract and the expiry margin. Pinned from the deployment, never taken from an operator.
 */
export type ChainPin = {
  tokenDomain: { name: string; version: string; chainId: number; verifyingContract: Hex };
  escrow: Hex;
  collector: Hex;
  rules: Hex;
  expiryMarginSec: number;
  /** A block explorer, for links to the transactions a deal made. */
  explorer?: string;
};
/** A settlement layer this agent signs for: its domain, the token identifier deals use, and on a chain the funding pin. */
export type Pin = { domain: Domain; token: { id: string; symbol: string; decimals: number }; chain?: ChainPin };

/** A pin from a deployment file (contracts/deployments/<network>.json). */
export function pinOf(d: DeploymentFile, explorer?: string): Pin {
  const lc = (a: string) => a.toLowerCase() as Hex;
  return {
    domain: { name: 'Holdback', version: '0.7', chainId: d.chainId, verifyingContract: lc(d.rules) },
    token: { id: lc(d.token.address), symbol: d.token.symbol, decimals: d.token.decimals },
    chain: {
      tokenDomain: { name: d.token.name, version: d.token.version, chainId: d.chainId, verifyingContract: lc(d.token.address) },
      escrow: lc(d.escrow), collector: lc(d.erc3009Collector), rules: lc(d.rules), expiryMarginSec: d.expiryMarginSec ?? 86_400,
      ...(explorer ? { explorer } : {}),
    },
  };
}

/**
 * The settlement layers this agent knows: SimChain, Sepolia's deployment when it is pinned (examples/deployments.ts),
 * and HOLDBACK_DEPLOYMENT (a deployment file's JSON) for another test chain.
 */
export function knownPins(): Pin[] {
  const env = process.env['HOLDBACK_DEPLOYMENT'];
  return [
    { domain: configuredDomain(), token: { id: 'tUSD', symbol: 'tUSD', decimals: 6 } },
    ...(SEPOLIA ? [pinOf(SEPOLIA, 'https://sepolia.etherscan.io')] : []),
    ...(env ? [pinOf(JSON.parse(env) as DeploymentFile)] : []),
  ];
}

const ERC3009 = ['from:address', 'to:address', 'value:uint256', 'validAfter:uint256', 'validBefore:uint256', 'nonce:bytes32'].map((s) => ({ name: s.split(':')[0]!, type: s.split(':')[1]! }));
/** USDC's ERC-3009 types, signed under the token's own domain: the funding and the operator fee on a chain. */
export const ERC3009_TYPES = { ReceiveWithAuthorization: ERC3009, TransferWithAuthorization: ERC3009 };
const ZERO_ADDRESS: Hex = `0x${'0'.repeat(40)}`;
const PAYMENT_INFO_TYPEHASH = keccak256(toBytes('PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)'));

/**
 * The funding nonce on a chain (ADR-0025): CPP's PaymentInfo hash with the payer zeroed. Every field comes from the
 * terms and the pinned deployment (operator = the rules contract, receiver = seller, maxAmount = price + fee,
 * preApprovalExpiry = fundBy, both other expiries = fallbackBy + appealDecideSec + margin, salt = commitment ID).
 */
export function fundingNonceOf(t: J, id: Hex, c: ChainPin): Hex {
  const total = BigInt(t.price.amount) + BigInt(t.adjudication.fee.amount);
  const expiry = Number(secs(t.timing.fallbackBy)) + Number(t.timing.appealDecideSec) + c.expiryMarginSec;
  const inner = keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, address, address, address, address, uint120, uint48, uint48, uint48, uint16, uint16, address, uint256'), [
      PAYMENT_INFO_TYPEHASH, c.rules, ZERO_ADDRESS, t.seller, t.price.token, total, Number(secs(t.timing.fundBy)), expiry, expiry, 0, 10_000, ZERO_ADDRESS, BigInt(id),
    ]),
  );
  return keccak256(encodeAbiParameters(parseAbiParameters('uint256, address, bytes32'), [BigInt(c.tokenDomain.chainId), c.escrow, inner]));
}
/** The operator fee's ERC-3009 nonce: keccak256(abi.encode(commitmentId, "operator_fee")) (ADR-0023 amendment). */
export const operatorFeeNonceOf = (id: Hex): Hex => keccak256(encodeAbiParameters(parseAbiParameters('bytes32, string'), [id, 'operator_fee']));
const erc3009Typed = (primaryType: string, c: ChainPin, m: J): J => ({
  domain: c.tokenDomain,
  types: { [primaryType]: ERC3009 },
  primaryType,
  message: { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) },
});

const f = (name: string, type: string) => ({ name, type });
const exp = [f('nonce', 'bytes32'), f('expiresAt', 'uint64')];
/** The EIP-712 types of schema 0.9, domain version 0.7 (packages/core/src/eip712.ts), pinned here. */
export const TYPES = {
  TokenAmount: [f('token', 'string'), f('amount', 'uint256')],
  Adjudication: [f('adjudicator', 'address'), f('fallbackAdjudicator', 'address'), f('appealAdjudicator', 'address'), f('policyId', 'string'), f('fee', 'TokenAmount'), f('registryHash', 'bytes32'), f('policyHash', 'bytes32')],
  Timing: [...['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy', 'appealWindowSec', 'appealDecideSec'].map((n) => f(n, 'uint64')), f('maxSubmissions', 'uint8'), ...['disputeBy', 'disputeJudgeSec', 'disputeFallbackSec'].map((n) => f(n, 'uint64'))],
  Settlement: [f('mode', 'string'), f('token', 'string')],
  Remedy: [f('onReject', 'string')],
  Disclosure: [f('level', 'string')],
  CommitmentTerms: [f('schemaVersion', 'string'), f('clubId', 'string'), f('rulebookHash', 'bytes32'), f('buyer', 'address'), f('seller', 'address'), f('deliverableHash', 'bytes32'), f('acceptanceHash', 'bytes32'), f('price', 'TokenAmount'), f('adjudication', 'Adjudication'), f('timing', 'Timing'), f('settlement', 'Settlement'), f('remedy', 'Remedy'), f('disclosure', 'Disclosure'), f('buyerEncryptionPublicKey', 'string'), f('nonce', 'bytes32'), f('createdAt', 'uint64')],
  Agree: [f('commitmentId', 'bytes32'), f('buyer', 'address'), ...exp],
  FundingAuthorization: [f('scheme', 'string'), f('commitmentId', 'bytes32'), f('from', 'address'), f('value', 'uint256'), f('token', 'string'), f('validAfter', 'uint64'), f('validBefore', 'uint64'), ...exp],
  // Schema 0.7 (ADR-0023), same domain version 0.6: the buyer's operator fee.
  TransferAuthorization: [f('scheme', 'string'), f('purpose', 'string'), f('commitmentId', 'bytes32'), f('from', 'address'), f('to', 'address'), f('value', 'uint256'), f('token', 'string'), f('validAfter', 'uint64'), f('validBefore', 'uint64'), ...exp],
  // Schema 0.9 (ADR-0029), domain version 0.7: the accept names the delivery the buyer opened.
  EarlyAccept: [f('commitmentId', 'bytes32'), f('buyer', 'address'), f('attempt', 'uint8'), f('deliveryHash', 'bytes32'), ...exp],
  Ciphertext: [f('uri', 'string'), f('sha256', 'string'), f('bytes', 'uint64'), f('cipher', 'string')],
  KeyUnlock: [f('kind', 'string'), f('round', 'uint64')],
  EncryptedKey: [f('recipient', 'address'), f('scheme', 'string'), f('ciphertext', 'string'), f('unlock', 'KeyUnlock')],
  Delivery: [f('commitmentId', 'bytes32'), f('attempt', 'uint8'), f('ciphertext', 'Ciphertext'), f('plaintextSha256', 'string'), f('plaintextMime', 'string'), f('encryptedKeys', 'EncryptedKey[]'), f('submittedAt', 'uint64')],
  Appeal: [f('commitmentId', 'bytes32'), f('appellant', 'string'), f('appellantAddress', 'address'), f('grounds', 'string'), f('bond', 'TokenAmount'), f('filedAt', 'uint64')],
  Payout: [f('to', 'address'), f('amount', 'TokenAmount')],
  MutualSettlement: [f('commitmentId', 'bytes32'), f('hasDelivery', 'bool'), f('deliveryHash', 'bytes32'), f('payouts', 'Payout[]'), f('releaseKey', 'bool'), ...exp],
  // Schema 0.8 (ADR-0024), same domain version 0.6: private reads, per-deal key certificates, publication.
  Scope: [f('roles', 'string[]'), f('maxPerCommitment', 'TokenAmount'), f('maxDaily', 'TokenAmount'), f('hasCategories', 'bool'), f('categories', 'string[]'), f('expiresAt', 'uint64')],
  ReadToken: [f('viewer', 'address'), f('commitmentId', 'bytes32'), f('hasAudience', 'bool'), f('audience', 'address'), ...exp],
  Delegation: [f('principal', 'address'), f('agent', 'address'), f('dealKey', 'address'), f('dealEncryptionKey', 'string'), f('clubId', 'string'), f('scope', 'Scope'), ...exp],
  Publish: [f('commitmentId', 'bytes32'), f('level', 'string'), ...exp],
};
const DEFAULT_TIMING: Record<string, number> = { offerExpiresInSec: 900, fundWithinSec: 1800, deliverWithinSec: 86_400, judgeWithinSec: 300, fallbackWithinSec: 300, appealWindowSec: 300, appealDecideSec: 300 };

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export class Refusal extends Error {}
const refuse = (why: string): never => {
  throw new Refusal(`refusing to sign: ${why}`);
};
/** RFC 8785 JSON for plain JSON values, and its keccak256 (how the terms bind deliverable, acceptance, policy). */
export const jcs = (v: J): string =>
  Array.isArray(v) ? `[${v.map(jcs).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}` : JSON.stringify(v);
export const jcsHash = (v: J): Hex => keccak256(toBytes(jcs(v)));
const lower = (v: J): J => (typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v) ? v.toLowerCase() : Array.isArray(v) ? v.map(lower) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lower(x)])) : v);
const secs = (ts: string) => BigInt(Date.parse(ts) / 1000);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const amt = (a: J) => ({ token: a.token, amount: BigInt(a.amount) });
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
/** A fresh random nonce for the agent to send with its prepare request. */
export const freshNonce = (): Hex => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
/** The agent picks its nonces; the operator must echo exactly the one the agent sent. */
const own = (mine: J, theirs: J, name: string) =>
  typeof mine !== 'string' || !HEX32.test(mine) ? refuse(`generate ${name} yourself (32 random bytes) and send it with the prepare request`) : String(theirs).toLowerCase() === mine.toLowerCase() ? mine : refuse(`${name} is not the one you sent`);
/** An operator-chosen time must lie within [now - behind, now + ahead] seconds of settlement-layer time. */
const nearTo = (now: number) => (ts: J, behind: number, ahead: number, name: string) => {
  const d = (Date.parse(ts) - now) / 1000;
  return typeof ts === 'string' && d >= -behind && d <= ahead ? ts : refuse(`${name} ${ts} is not within the expected window around settlement time`);
};
/** An appeal bond is the rulebook's rate of the price, rounded up; the settlement layer would accept more. */
export const appealBondOf = (price: J, rateBps: number): string => ((BigInt(price.amount) * BigInt(rateBps) + 9_999n) / 10_000n).toString();
const DEC = /^(0|[1-9][0-9]{0,77})$/;
/**
 * ADR-0023: the operator fee a published schedule (`fees.operator` in /.well-known/holdback.json) gives for a price:
 * max(min, ceil(price x bps / 10000)), capped at max, in base units; 0 in another token than the schedule's.
 */
export const operatorFeeOf = (price: J, s: J): bigint => {
  if (!s || !/^0x[0-9a-fA-F]{40}$/.test(s.to) || !Number.isSafeInteger(s.bps) || s.bps < 0 || s.bps > 10_000 || !DEC.test(s.min) || !(s.max === null || DEC.test(s.max)) || s.refundable !== false || s.appliesAt !== 'agree-and-fund') {
    return refuse('the operator fee schedule is malformed; read fees.operator from at least two operators');
  }
  if (price.token !== s.token) return 0n;
  let fee = (BigInt(price.amount) * BigInt(s.bps) + 9_999n) / 10_000n;
  if (fee < BigInt(s.min)) fee = BigInt(s.min);
  if (s.max !== null && fee > BigInt(s.max)) fee = BigInt(s.max);
  return fee;
};

const termsMessage = (t: J) => ({
  ...t, deliverableHash: jcsHash(t.deliverable), acceptanceHash: jcsHash(t.acceptance), price: amt(t.price), adjudication: { ...t.adjudication, fee: amt(t.adjudication.fee) }, createdAt: secs(t.createdAt),
  timing: { ...Object.fromEntries(['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy'].map((k) => [k, secs(t.timing[k])])), appealWindowSec: BigInt(t.timing.appealWindowSec), appealDecideSec: BigInt(t.timing.appealDecideSec), maxSubmissions: t.timing.maxSubmissions, disputeBy: 0n, disputeJudgeSec: 0n, disputeFallbackSec: 0n },
});
/** The commitment ID: the EIP-712 struct hash of the terms. */
export const commitmentIdOf = (t: J): Hex => hashStruct({ types: TYPES, primaryType: 'CommitmentTerms', data: termsMessage(t) });
const ENCODE: Record<string, (m: J) => J> = {
  CommitmentTerms: termsMessage,
  Agree: (m) => ({ ...m, expiresAt: secs(m.expiresAt) }),
  FundingAuthorization: (m) => ({ ...m, value: BigInt(m.value), validAfter: secs(m.validAfter), validBefore: secs(m.validBefore), expiresAt: secs(m.expiresAt) }),
  TransferAuthorization: (m) => ({ ...m, value: BigInt(m.value), validAfter: secs(m.validAfter), validBefore: secs(m.validBefore), expiresAt: secs(m.expiresAt) }),
  EarlyAccept: (m) => ({ ...m, expiresAt: secs(m.expiresAt) }),
  Delivery: (m) => ({ ...m, ciphertext: { ...m.ciphertext, bytes: BigInt(m.ciphertext.bytes) }, encryptedKeys: m.encryptedKeys.map((k: J) => ({ ...k, unlock: { kind: '', round: 0n } })), submittedAt: secs(m.submittedAt) }),
  Appeal: (m) => ({ ...m, bond: amt(m.bond), filedAt: secs(m.filedAt) }),
  MutualSettlement: (m) => ({ ...m, hasDelivery: m.deliveryHash !== null, deliveryHash: m.deliveryHash ?? `0x${'0'.repeat(64)}`, payouts: m.payouts.map((p: J) => ({ to: p.to, amount: amt(p.amount) })), expiresAt: secs(m.expiresAt) }),
  ReadToken: (m) => ({ viewer: m.viewer, commitmentId: m.commitmentId, hasAudience: m.audience !== undefined, audience: m.audience ?? `0x${'0'.repeat(40)}`, nonce: m.nonce, expiresAt: secs(m.expiresAt) }),
  Delegation: (m) => ({
    ...m, nonce: m.nonce, expiresAt: secs(m.expiresAt),
    scope: { roles: m.scope.roles, maxPerCommitment: amt(m.scope.maxPerCommitment), maxDaily: amt(m.scope.maxDaily), hasCategories: m.scope.categories !== undefined, categories: m.scope.categories ?? [], expiresAt: secs(m.scope.expiresAt) },
  }),
  Publish: (m) => ({ commitmentId: m.commitmentId, level: m.level, nonce: m.nonce, expiresAt: secs(m.expiresAt) }),
};
/** EIP-712 typed data for a message this agent builds itself, under its own pinned domain. */
export const typedOf = (primaryType: string, message: J, domain: Domain): J => ({ domain, types: TYPES, primaryType, message: ENCODE[primaryType]!(message) });

/** What the agent itself intends, per kind. `terms` are the commitment terms the agent signed or agreed to. */
export type Intent =
  | { kind: 'offer'; request: J; registration: { policy: J; policyHash: Hex; registry: { hash: Hex }; fee: { min: J } }; rulebookHash: Hex }
  /**
   * expectedPrice: the price you negotiated, checked exactly (maxTotal alone lets a price raised within budget pass).
   * expectedCommitmentId: optionally, the ID of the exact terms you expect (commitmentIdOf of your own copy).
   */
  /**
   * operatorFee (ADR-0023): the relaying operator's `fees.operator` as at least two operators serve it, and your own
   * nonce for the fee. Without it, no fee slot is accepted. maxTotal covers price, adjudication fee and operator fee.
   */
  /**
   * chain: on a chain (ADR-0025) the funding and the fee are the token's ERC-3009 authorizations, rebuilt from this pin,
   * and their nonces are fixed by the terms (fundingNonceOf, operatorFeeNonceOf): pass those as fundingNonce and the fee nonce.
   */
  | { kind: 'agree-and-fund'; terms: J; me: string; encryptionPublicKey: string; maxTotal: bigint; agreeNonce: Hex; fundingNonce: Hex; expectedPrice?: { token: string; amount: string }; expectedCommitmentId?: Hex; operatorFee?: { schedule: J; nonce: Hex } | undefined; chain?: ChainPin }
  | { kind: 'delivery'; terms: J; ciphertext: { uri: string; sha256: string; bytes: number }; plaintextSha256: string; encryptedKeys: J[] }
  /**
   * Run openOwnEnvelope on the seller's signed delivery first: an early accept pays for the envelope the seller filed.
   * deliveryHash: what openOwnEnvelope returned for the delivery you opened; the accept names it (ADR-0029).
   */
  | { kind: 'early-accept'; terms: J; nonce: Hex; deliveryHash: Hex }
  /** appealBondRateBps: from the club rulebook as at least two operators serve it. */
  | { kind: 'appeal'; terms: J; me: string; grounds?: string; appealBondRateBps: number }
  | { kind: 'settlement'; terms: J; payouts: J[]; releaseKey: boolean; deliveryHash: Hex | null; nonce: Hex };
/** A slot's typed data is the message under the pinned Holdback domain, unless `typed` gives another (ERC-3009 on a chain). */
type Plan = { path: string; body: J; slots: Array<{ slot: string; primaryType: string; signer: string; message: J; typed?: J }> };

/** Builds the body the agent expects, taking from the operator's proposal only times bounded around `now`. */
function expected(intent: Intent, op: J, now: number): Plan {
  const plus = (ts: string, s: number) => iso(Date.parse(ts) + s * 1000);
  const near = nearTo(now);
  if (intent.kind === 'offer') {
    const r = intent.request, reg = intent.registration;
    if (jcsHash(reg.policy) !== reg.policyHash) refuse("the adjudicator's policyHash does not match its policy");
    const timing = { ...DEFAULT_TIMING, ...r.timing }, createdAt = near(op.createdAt, 600, 60, 'createdAt');
    const deliverBy = plus(createdAt, timing['deliverWithinSec']!), judgeBy = plus(deliverBy, timing['judgeWithinSec']!);
    const terms = {
      schemaVersion: '0.7', clubId: r.clubId, rulebookHash: intent.rulebookHash, buyer: r.buyer.address.toLowerCase(), seller: r.seller.toLowerCase(), deliverable: r.deliverable,
      acceptance: { deterministicChecks: r.checks ?? [], rubric: r.template === 'checks-only' ? { criteria: [], passThreshold: 0 } : r.rubric }, price: r.price,
      adjudication: { adjudicator: r.adjudicators.primary, fallbackAdjudicator: r.adjudicators.fallback, appealAdjudicator: r.adjudicators.appeal, policyId: reg.policy.id, fee: r.fee ?? reg.fee.min, registryHash: reg.registry.hash, policyHash: reg.policyHash },
      timing: { offerExpiresAt: plus(createdAt, timing['offerExpiresInSec']!), fundBy: plus(createdAt, timing['fundWithinSec']!), deliverBy, judgeBy, fallbackBy: plus(judgeBy, timing['fallbackWithinSec']!), appealWindowSec: timing['appealWindowSec'], appealDecideSec: timing['appealDecideSec'], maxSubmissions: 1 },
      settlement: { mode: 'guaranteed_on_decision', token: r.price.token }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
      buyerEncryptionPublicKey: r.buyer.encryptionPublicKey, nonce: own(r.nonce, op.nonce, 'nonce'), createdAt,
    };
    return { path: '/v1/commitments', body: { ...terms, id: commitmentIdOf(terms), signatures: { seller: null } }, slots: [{ slot: 'signatures.seller', primaryType: 'CommitmentTerms', signer: terms.seller, message: terms }] };
  }
  const t = intent.terms, id = commitmentIdOf(t);
  if (intent.kind === 'agree-and-fund') {
    if (t.buyer.toLowerCase() !== intent.me.toLowerCase()) refuse('the terms name another buyer');
    if (t.buyerEncryptionPublicKey !== intent.encryptionPublicKey) refuse('the terms seal the work to a key you do not hold');
    const want = intent.expectedPrice;
    // Money is a decimal string of base units (no floats, no leading zeros): compared as strings, never parsed loosely.
    if (want && (typeof want.token !== 'string' || typeof want.amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(want.amount))) refuse('expectedPrice must be {"token", "amount"} with amount in base units as a decimal string, e.g. "25000000"');
    if (want && (t.price.token !== want.token || t.price.amount !== want.amount)) refuse(`price ${t.price.amount} ${t.price.token} is not the ${want.amount} ${want.token} you agreed`);
    if (intent.expectedCommitmentId && id.toLowerCase() !== intent.expectedCommitmentId.toLowerCase()) refuse(`the terms you were sent are not the ones you expected (commitment ${id}, expected ${intent.expectedCommitmentId})`);
    const total = BigInt(t.price.amount) + BigInt(t.adjudication.fee.amount);
    // ADR-0023: the fee comes from the schedule you read, never from the prepared message.
    const due = intent.operatorFee ? operatorFeeOf(t.price, intent.operatorFee.schedule) : 0n;
    const asked = op.operatorFee === undefined ? undefined : DEC.test(String(op.operatorFee?.value)) ? BigInt(op.operatorFee.value) : refuse('the operator fee value is not base units');
    if (asked !== undefined && asked > due) refuse(`the operator asks for an operator fee of ${asked} base units, above the schedule you read (${due})`);
    if (total + due > intent.maxTotal) refuse(`price plus fee${due ? ' plus operator fee' : ''} ${total + due} exceeds your limit ${intent.maxTotal}`);
    if (String(intent.agreeNonce).toLowerCase() === String(intent.fundingNonce).toLowerCase()) refuse('agreeNonce and fundingNonce must differ');
    const agree = { type: 'Agree', commitmentId: id, buyer: t.buyer, nonce: own(intent.agreeNonce, op.nonce, 'agreeNonce'), expiresAt: t.timing.offerExpiresAt };
    // On a chain the token pulls the funds on its own ERC-3009 signature: valid from 0, nonce fixed by the terms.
    const c = intent.chain;
    if (c && intent.fundingNonce.toLowerCase() !== fundingNonceOf(t, id, c).toLowerCase()) refuse('on this chain the funding nonce is fixed by the terms: pass fundingNonceOf(terms)');
    const fund = { type: 'FundingAuthorization', scheme: 'erc3009', commitmentId: id, from: t.buyer, value: total.toString(), token: t.price.token, validAfter: c ? '1970-01-01T00:00:00Z' : t.createdAt, validBefore: t.timing.fundBy, nonce: own(intent.fundingNonce, op.fund?.nonce, 'fundingNonce'), expiresAt: t.timing.fundBy };
    const fundTyped = c ? erc3009Typed('ReceiveWithAuthorization', c, { from: t.buyer, to: c.collector, value: total, validAfter: 0n, validBefore: secs(t.timing.fundBy), nonce: fund.nonce }) : undefined;
    const slots = [{ slot: 'signature', primaryType: 'Agree', signer: t.buyer, message: agree }, { slot: 'fund.signature', primaryType: fundTyped ? 'ReceiveWithAuthorization' : 'FundingAuthorization', signer: t.buyer, message: fund, ...(fundTyped ? { typed: fundTyped } : {}) }];
    if (due === 0n) return { path: `/v1/commitments/${id}/agree`, body: { ...agree, signature: null, fund: { ...fund, signature: null } }, slots };
    const feeNonce = intent.operatorFee!.nonce;
    if ([intent.agreeNonce, intent.fundingNonce].some((n) => String(n).toLowerCase() === String(feeNonce).toLowerCase())) refuse('the operator fee nonce must differ from agreeNonce and fundingNonce');
    if (c && feeNonce.toLowerCase() !== operatorFeeNonceOf(id).toLowerCase()) refuse('on this chain the operator fee nonce is fixed by the commitment: pass operatorFeeNonceOf(id)');
    const fee = {
      type: 'TransferAuthorization', scheme: 'erc3009', purpose: 'operator_fee', commitmentId: id, from: t.buyer, to: intent.operatorFee!.schedule.to, value: due.toString(), token: t.price.token,
      validAfter: c ? '1970-01-01T00:00:00Z' : t.createdAt, validBefore: t.timing.fundBy, nonce: own(feeNonce, op.operatorFee?.nonce, 'operatorFeeNonce'), expiresAt: t.timing.fundBy,
    };
    const feeTyped = c ? erc3009Typed('TransferWithAuthorization', c, { from: t.buyer, to: fee.to, value: due, validAfter: 0n, validBefore: secs(t.timing.fundBy), nonce: fee.nonce }) : undefined;
    return {
      path: `/v1/commitments/${id}/agree`,
      body: { ...agree, signature: null, fund: { ...fund, signature: null }, operatorFee: { ...fee, signature: null } },
      slots: [...slots, { slot: 'operatorFee.signature', primaryType: feeTyped ? 'TransferWithAuthorization' : 'TransferAuthorization', signer: t.buyer, message: fee, ...(feeTyped ? { typed: feeTyped } : {}) }],
    };
  }
  if (intent.kind === 'delivery') {
    const m = { commitmentId: id, attempt: 1, ciphertext: { ...intent.ciphertext, cipher: 'aes-256-gcm' }, plaintextSha256: intent.plaintextSha256, plaintextMime: t.deliverable.format, encryptedKeys: intent.encryptedKeys, submittedAt: near(op.submittedAt, 600, 60, 'submittedAt') };
    return { path: `/v1/commitments/${id}/deliveries`, body: { ...m, signature: null }, slots: [{ slot: 'signature', primaryType: 'Delivery', signer: t.seller, message: m }] };
  }
  if (intent.kind === 'early-accept') {
    // The accept names the delivery you opened; a prepared accept for any other delivery differs here and is refused.
    const m = { type: 'EarlyAccept', commitmentId: id, buyer: t.buyer, attempt: 1, deliveryHash: String(intent.deliveryHash).toLowerCase(), nonce: own(intent.nonce, op.nonce, 'nonce'), expiresAt: near(op.expiresAt, 0, 86_400, 'expiresAt') };
    return { path: `/v1/commitments/${id}/accept`, body: { ...m, signature: null }, slots: [{ slot: 'signature', primaryType: 'EarlyAccept', signer: t.buyer, message: m }] };
  }
  if (intent.kind === 'appeal') {
    const role = intent.me.toLowerCase() === t.buyer.toLowerCase() ? 'buyer' : intent.me.toLowerCase() === t.seller.toLowerCase() ? 'seller' : refuse('you are neither party');
    if (!Number.isSafeInteger(intent.appealBondRateBps) || intent.appealBondRateBps < 0 || intent.appealBondRateBps > 10_000) refuse('appealBondRateBps must come from the club rulebook');
    const bond = { token: t.price.token, amount: appealBondOf(t.price, intent.appealBondRateBps) };
    const m = { commitmentId: id, appellant: role, appellantAddress: intent.me.toLowerCase(), grounds: intent.grounds ?? 'wrong-outcome', bond, filedAt: near(op.filedAt, 600, 60, 'filedAt') };
    return { path: `/v1/commitments/${id}/appeals`, body: { ...m, signature: null }, slots: [{ slot: 'signature', primaryType: 'Appeal', signer: intent.me, message: m }] };
  }
  const m = { type: 'MutualSettlement', commitmentId: id, deliveryHash: intent.deliveryHash, payouts: intent.payouts, releaseKey: intent.releaseKey, nonce: own(intent.nonce, op.nonce, 'nonce'), expiresAt: near(op.expiresAt, 0, 86_400, 'expiresAt') };
  const slots = [{ slot: 'buyerSignature', signer: t.buyer }, { slot: 'sellerSignature', signer: t.seller }].map((s) => ({ ...s, primaryType: 'MutualSettlement', message: m }));
  return { path: `/v1/commitments/${id}/settlements`, body: { ...m, buyerSignature: null, sellerSignature: null }, slots };
}

/** The first path where two JSON values differ, for a refusal message. */
const diff = (a: J, b: J, at = 'body'): string | null => {
  if (jcs(a) === jcs(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], `${at}.${k}`); if (d) return d; }
  return at;
};
const ints = (types: J, type: string, v: J): J =>
  type.endsWith('[]') ? v.map((x: J) => ints(types, type.slice(0, -2), x)) : types[type] ? Object.fromEntries(types[type].map((x: J) => [x.name, ints(types, x.type, v?.[x.name])])) : /^u?int\d*$/.test(type) ? BigInt(v) : v;

/**
 * Checks a prepared message against the agent's intent and pinned domain. Returns the body to submit and the
 * typed data the agent built itself for each slot `me` signs. Throws Refusal on any difference.
 */
export function verifyPrepared(prepared: J, intent: Intent, me: string, domain: Domain, settlementNowMs: number): { path: string; body: J; toSign: Array<{ slot: string; typed: J }> } {
  if (prepared?.kind !== intent.kind) refuse(`expected a ${intent.kind}, got ${prepared?.kind}`);
  if (!Number.isFinite(settlementNowMs)) refuse('settlement-layer time is unknown');
  const plan = expected(intent, prepared.submit?.body ?? {}, settlementNowMs);
  if (prepared.submit.path !== plan.path) refuse(`submit path ${prepared.submit.path} is not ${plan.path}`);
  const where = diff(lower(plan.body), lower(prepared.submit.body));
  if (where) refuse(`${where} differs from what you asked for`);
  if (!Array.isArray(prepared.sign) || prepared.sign.length !== plan.slots.length) refuse(`expected ${plan.slots.length} signature slot(s), got ${prepared.sign?.length}`);
  const toSign = [];
  for (const [i, want] of plan.slots.entries()) {
    const got = prepared.sign[i];
    if (got.slot !== want.slot || got.typedData?.primaryType !== want.primaryType || got.signer.toLowerCase() !== want.signer.toLowerCase()) refuse(`slot ${i} is ${got.slot}/${got.typedData?.primaryType}, expected ${want.slot}/${want.primaryType}`);
    const typed = want.typed ?? { domain, types: TYPES, primaryType: want.primaryType, message: ENCODE[want.primaryType]!(want.message) };
    const mine = hashTypedData(typed as J);
    let theirs: string | undefined;
    try {
      const td = got.typedData, types = { ...td.types };
      delete types.EIP712Domain;
      theirs = hashTypedData({ ...td, types, message: ints(types, td.primaryType, td.message) });
    } catch {
      theirs = undefined;
    }
    if (theirs !== mine || got.digest !== mine) refuse(`the typed data for ${want.slot} (domain, types or message) is not the message you intend`);
    if (want.signer.toLowerCase() === me.toLowerCase()) toSign.push({ slot: want.slot, typed });
  }
  return { path: plan.path, body: plan.body, toSign };
}

/** The delivery hash the settlement layer records (EIP-712 struct hash of the delivery without its signature). */
export const deliveryHashOf = (d: J): Hex =>
  hashStruct({
    types: TYPES,
    primaryType: 'Delivery',
    data: {
      ...d, ciphertext: { uri: d.ciphertext.uri, sha256: d.ciphertext.sha256, bytes: BigInt(d.ciphertext.bytes), cipher: d.ciphertext.cipher }, submittedAt: secs(d.submittedAt),
      encryptedKeys: d.encryptedKeys.map((k: J) => ({ recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext, unlock: k.unlock ? { kind: k.unlock.kind, round: BigInt(k.unlock.round ?? 0) } : { kind: '', round: 0n } })),
    },
  });

/** What the buyer gathers before an early accept. */
export type EnvelopeMaterial = {
  /** The terms you agreed to. */
  terms: J;
  /** The seller's signed delivery body as the seller handed it to you: it carries your envelope. */
  delivery: J;
  /**
   * The `delivery.submitted` payload: what the settlement layer holds. It MUST come from at least two distinct
   * operators that agree (Agent.envelopeMaterial reads it that way); one operator's answer could match a forged
   * delivery, and then the check proves nothing.
   */
  recorded: { deliveryHash: Hex; plaintextSha256: string; ciphertext: { uri: string; sha256: string } };
  /** The ciphertext bytes fetched from `recorded.ciphertext.uri`. */
  ciphertext: Uint8Array;
  /** Your x25519 secret key, whose public half the terms name as buyerEncryptionPublicKey. */
  encryptionSecretKey: Uint8Array;
};
/** What openOwnEnvelope opened: the work, for the buyer to inspect before accepting. */
export type Opened = { commitmentId: Hex; attempt: number; deliveryHash: Hex; plaintextSha256: string; plaintext: Uint8Array };
const sha256Of = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex')}`;

/**
 * Opens the buyer's own envelope before an early accept (D32). The settlement layer cannot check
 * that the seller sealed the buyer's envelope to the buyer's key, and an early accept releases exactly that
 * envelope with the payment. So, with your own key: the handed delivery must be the one the settlement layer
 * holds, your one envelope must open, the ciphertext must match its signed hash and decrypt, and the plaintext
 * must match the signed plaintextSha256. Throws Refusal saying which check failed. The plaintext is yours to
 * inspect before you accept.
 */
export async function openOwnEnvelope(x: EnvelopeMaterial): Promise<Opened> {
  const t = x.terms, d = x.delivery, id = commitmentIdOf(t);
  if (String(d?.commitmentId).toLowerCase() !== id.toLowerCase()) refuse(`the delivery you were handed is for another commitment (${d?.commitmentId}), not ${id}`);
  if (x.encryptionSecretKey?.length !== 32 || Buffer.from(nacl.box.keyPair.fromSecretKey(x.encryptionSecretKey).publicKey).toString('base64url') !== t.buyerEncryptionPublicKey) {
    refuse(`your encryption key is not the buyerEncryptionPublicKey in the terms (${t.buyerEncryptionPublicKey}); open with the secret key for that public key`);
  }
  const hash = deliveryHashOf(d);
  if (hash !== String(x.recorded?.deliveryHash).toLowerCase()) refuse(`the delivery you were handed (${hash}) is not the one the settlement layer holds (${x.recorded?.deliveryHash}); ask the seller for the signed delivery it submitted`);
  const mine = (d.encryptedKeys as J[]).filter((k) => String(k.recipient).toLowerCase() === String(t.buyer).toLowerCase());
  if (mine.length !== 1) refuse(mine.length ? 'the delivery has more than one envelope for you; which one is released is not yours to choose' : 'the delivery has no envelope for you');
  const env = Buffer.from(String(mine[0].ciphertext), 'base64url');
  const key = mine[0].scheme === 'x25519-xsalsa20poly1305' && env.length === 104 ? nacl.box.open(env.subarray(56), env.subarray(32, 56), env.subarray(0, 32), x.encryptionSecretKey) : null;
  if (!key || key.length !== 32) {
    refuse('your envelope does not open with your encryption key: the seller sealed it to another key. Do not accept early; an adjudicator\'s decision re-seals the key to your terms key');
  }
  const ct = new Uint8Array(x.ciphertext);
  if ((await sha256Of(ct)) !== d.ciphertext.sha256) refuse(`the ciphertext you fetched (${await sha256Of(ct)}) does not match the delivery's signed ciphertext.sha256 ${d.ciphertext.sha256}`);
  let plaintext: Uint8Array | undefined;
  try {
    const aes = await crypto.subtle.importKey('raw', new Uint8Array(key!), 'AES-GCM', false, ['decrypt']);
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.slice(0, 12) }, aes, ct.slice(12)));
  } catch {
    refuse('the ciphertext does not decrypt with the content key in your envelope');
  }
  const got = await sha256Of(plaintext!);
  if (got !== d.plaintextSha256) refuse(`the decrypted work's hash ${got} is not the delivery's signed plaintextSha256 ${d.plaintextSha256}`);
  return { commitmentId: id, attempt: d.attempt, deliveryHash: hash, plaintextSha256: got, plaintext: plaintext! };
}

// Private deals (ADR-0024): the client-side prepare recipe, the two-part encrypted terms, Delegation checks

const SALT = /^0x[0-9a-f]{64}$/;
const whole = (ts: J) => typeof ts === 'string' && Number.isFinite(Date.parse(ts)) && Date.parse(ts) % 1000 === 0;

/** What the recipe takes. Every value is the agent's own or read from at least two operators; none is the relay's. */
export type PrivateOfferInput = {
  clubId: string;
  /** The club's rulebookHash, as two operators serve it and checked against the rulebook (Agent.club). */
  rulebookHash: Hex;
  /** The seller's per-deal address. */
  seller: string;
  /** The buyer's per-deal address and x25519 key, as its Delegation certifies them. */
  buyer: { address: string; encryptionPublicKey: string };
  adjudicators: { primary: string; fallback: string; appeal: string };
  /** The primary's registration, as two operators serve it (Agent.registration). */
  registration: { policy: J; policyHash: Hex; registry: { hash: Hex }; fee: { min: J } };
  price: J;
  /** Default: the primary's published minimum. */
  fee?: J;
  /** kind, description, format, and optionally inputs and notes. */
  deliverable: J;
  /** deterministicChecks and rubric (and optionally sealedChecks), written out in full: the recipe has no templates. */
  acceptance: J;
  /** Windows in seconds, as in POST /v1/prepare/offer; defaults as there. */
  timing?: Record<string, number>;
  /** Default private (ADR-0024). */
  level?: 'private' | 'judgment';
  /** The seller's per-deal x25519 public key, bound in the deliverable body. */
  sellerEncryptionPublicKey: string;
  /** Settlement-layer time in whole seconds, as at least two operators report it (Agent.settlementNow). */
  createdAt: string;
  /** 32 random bytes each, generated by the agent. */
  nonce: Hex;
  salts: { deliverable: Hex; acceptance: Hex };
};

/**
 * The client-side prepare recipe (ADR-0024 §4, docs/api.md "Private deals"): the plaintext terms of a private offer
 * from the agent's own inputs, with no operator call. Pure and deterministic: field for field what POST
 * /v1/prepare/offer would build, plus the level, the salts and the seller's per-deal key in the bodies. Its
 * commitmentIdOf is the ID the sealed form carries.
 */
export function privateOfferTerms(x: PrivateOfferInput): J {
  if (jcsHash(x.registration.policy) !== x.registration.policyHash) refuse("the adjudicator's policyHash does not match its policy");
  if (!whole(x.createdAt)) refuse('createdAt must be settlement-layer time in whole seconds');
  if (!SALT.test(String(x.nonce)) || !SALT.test(String(x.salts?.deliverable)) || !SALT.test(String(x.salts?.acceptance))) refuse('nonce and both salts must be 32 random bytes of lowercase hex');
  if (x.salts.deliverable === x.salts.acceptance) refuse('use a different salt for each body');
  const level = x.level ?? 'private';
  if (level !== 'private' && level !== 'judgment') refuse('a private offer is at level private or judgment');
  const plus = (ts: string, s: number) => iso(Date.parse(ts) + s * 1000);
  const timing = { ...DEFAULT_TIMING, ...x.timing };
  const createdAt = iso(Date.parse(x.createdAt));
  const deliverBy = plus(createdAt, timing['deliverWithinSec']!), judgeBy = plus(deliverBy, timing['judgeWithinSec']!);
  return {
    schemaVersion: '0.7', clubId: x.clubId, rulebookHash: x.rulebookHash, buyer: x.buyer.address.toLowerCase(), seller: x.seller.toLowerCase(),
    deliverable: { ...x.deliverable, salt: x.salts.deliverable, sellerEncryptionPublicKey: x.sellerEncryptionPublicKey },
    acceptance: { ...x.acceptance, salt: x.salts.acceptance },
    price: x.price,
    adjudication: { adjudicator: x.adjudicators.primary.toLowerCase(), fallbackAdjudicator: x.adjudicators.fallback.toLowerCase(), appealAdjudicator: x.adjudicators.appeal.toLowerCase(), policyId: x.registration.policy.id, fee: x.fee ?? x.registration.fee.min, registryHash: x.registration.registry.hash, policyHash: x.registration.policyHash },
    timing: { offerExpiresAt: plus(createdAt, timing['offerExpiresInSec']!), fundBy: plus(createdAt, timing['fundWithinSec']!), deliverBy, judgeBy, fallbackBy: plus(judgeBy, timing['fallbackWithinSec']!), appealWindowSec: timing['appealWindowSec'], appealDecideSec: timing['appealDecideSec'], maxSubmissions: 1 },
    settlement: { mode: 'guaranteed_on_decision', token: x.price.token }, remedy: { onReject: 'full_refund' }, disclosure: { level },
    buyerEncryptionPublicKey: x.buyer.encryptionPublicKey, nonce: x.nonce, createdAt,
  };
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const hexBytes = (h: string) => new Uint8Array(Buffer.from(h.slice(2), 'hex'));
/** AAD for one part: the commitment ID's 32 bytes, then the part name in UTF-8 (ADR-0024 §2). */
const aadOf = (id: Hex, name: 'deliverable' | 'acceptance') => new Uint8Array([...hexBytes(id), ...new TextEncoder().encode(name)]);

/** AES-256-GCM of the body's RFC 8785 JSON under `key`, AAD bound to the deal and part: iv || ciphertext || tag, base64url. */
export async function sealPart(body: J, id: Hex, name: 'deliverable' | 'acceptance', key: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(id, name) }, aes, new TextEncoder().encode(jcs(body))));
  return b64u(new Uint8Array([...iv, ...ct]));
}

/** Opens one part and checks it is the canonical JSON whose keccak256 the terms bind. Throws Refusal. */
export async function openPart(part: J, id: Hex, name: 'deliverable' | 'acceptance', key: Uint8Array): Promise<J> {
  const bytes = new Uint8Array(Buffer.from(String(part?.ciphertext), 'base64url'));
  let text: string;
  try {
    const aes = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['decrypt']);
    text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aadOf(id, name) }, aes, bytes.slice(12)));
  } catch {
    return refuse(`the ${name} does not decrypt with its key for this commitment`);
  }
  let body: J;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(`the ${name} is not JSON`);
  }
  if (jcs(body) !== text || jcsHash(body) !== String(part.hash).toLowerCase()) refuse(`the ${name} does not hash to the ${name}Hash the terms bind`);
  return body;
}

/** Seals a 32-byte key to one reader's x25519 key, as delivery envelopes are (x25519-xsalsa20poly1305). */
export function sealKeyTo(key: Uint8Array, recipient: string, encryptionPublicKey: string): J {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(key, nonce, new Uint8Array(Buffer.from(encryptionPublicKey, 'base64url')), eph.secretKey);
  return { recipient: recipient.toLowerCase(), scheme: 'x25519-xsalsa20poly1305', ciphertext: b64u(new Uint8Array([...eph.publicKey, ...nonce, ...box])) };
}

/** Opens this reader's one envelope among `envelopes`. Throws Refusal. */
export function openEnvelopeKey(envelopes: J[], me: string, secretKey: Uint8Array): Uint8Array {
  const mine = (envelopes ?? []).filter((e) => String(e.recipient).toLowerCase() === me.toLowerCase());
  if (mine.length !== 1) refuse(mine.length ? 'more than one envelope names you' : 'no envelope names you');
  const env = Buffer.from(String(mine[0].ciphertext), 'base64url');
  const key = mine[0].scheme === 'x25519-xsalsa20poly1305' && env.length === 104 ? nacl.box.open(env.subarray(56), env.subarray(32, 56), env.subarray(0, 32), secretKey) : null;
  return key && key.length === 32 ? key : refuse('your envelope does not open with your key');
}

/**
 * The sealed wire form (ADR-0024 §2): both bodies encrypted under separate fresh keys and each key sealed to every
 * reader (at offer: the buyer and the primary). The keys come back for the seller to keep for later disclosure.
 */
export async function sealPrivateTerms(terms: J, readers: Array<{ address: string; encryptionPublicKey: string }>): Promise<{ sealed: J; id: Hex; keys: { deliverable: Uint8Array; acceptance: Uint8Array } }> {
  const id = commitmentIdOf(terms);
  const keys = { deliverable: crypto.getRandomValues(new Uint8Array(32)), acceptance: crypto.getRandomValues(new Uint8Array(32)) };
  const part = async (name: 'deliverable' | 'acceptance') => ({ hash: jcsHash(terms[name]), ciphertext: await sealPart(terms[name], id, name, keys[name]), envelopes: readers.map((r) => sealKeyTo(keys[name], r.address, r.encryptionPublicKey)) });
  const { deliverable: _d, acceptance: _a, ...rest } = terms; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { sealed: { ...rest, privateTerms: { deliverable: await part('deliverable'), acceptance: await part('acceptance') } }, id, keys };
}

/** A reader opens the sealed terms with its own envelopes: the plaintext terms, checked to have the same ID. Throws Refusal. */
export async function openPrivateTerms(sealed: J, id: Hex, me: string, secretKey: Uint8Array): Promise<J> {
  const p = sealed?.privateTerms ?? refuse('these terms carry no privateTerms');
  const { privateTerms: _p, id: _i, signatures: _s, adjudicatorAcceptance: _a, ...rest } = sealed; // eslint-disable-line @typescript-eslint/no-unused-vars
  const deliverable = await openPart(p.deliverable, id, 'deliverable', openEnvelopeKey(p.deliverable.envelopes, me, secretKey));
  const acceptance = await openPart(p.acceptance, id, 'acceptance', openEnvelopeKey(p.acceptance.envelopes, me, secretKey));
  const terms = { ...rest, deliverable, acceptance };
  if (commitmentIdOf(terms) !== id) refuse('the opened terms are not the commitment you asked for');
  return terms;
}

/**
 * Checks a counterparty's per-deal key certificate before you sign anything with that party (ADR-0024 §7): signed by
 * the long-term agent it names, for exactly the per-deal keys in the terms, this club and role, the price within its
 * per-commitment cap, unexpired. Then check the agent's mandate from `principal` as two operators serve it
 * (Agent.checkDelegation does both). Throws Refusal.
 */
export async function verifyDelegation(d: J, want: { dealKey: string; dealEncryptionKey?: string; clubId: string; role: 'buyer' | 'seller'; price: J; nowMs: number }, domain: Domain): Promise<void> {
  if (d?.type !== 'Delegation') refuse('not a Delegation');
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({ ...typedOf('Delegation', d, domain), signature: d.signature });
  } catch {
    return refuse('the delegation signature does not parse');
  }
  if (signer.toLowerCase() !== String(d.agent).toLowerCase()) refuse('the delegation is not signed by the agent it names');
  if (String(d.dealKey).toLowerCase() !== want.dealKey.toLowerCase()) refuse(`the delegation certifies ${d.dealKey}, not ${want.dealKey}`);
  if (want.dealEncryptionKey !== undefined && d.dealEncryptionKey !== want.dealEncryptionKey) refuse('the delegation certifies another encryption key than the terms use');
  if (d.clubId !== want.clubId) refuse(`the delegation is for club ${d.clubId}, not ${want.clubId}`);
  if (!d.scope?.roles?.includes(want.role)) refuse(`the delegation does not allow the ${want.role} role`);
  if (!(want.nowMs < Date.parse(d.expiresAt)) || !(want.nowMs < Date.parse(d.scope.expiresAt))) refuse('the delegation has expired');
  if (d.scope.maxPerCommitment.token !== want.price.token || BigInt(d.scope.maxPerCommitment.amount) < BigInt(want.price.amount)) refuse('the price exceeds the delegation per-commitment cap');
}
