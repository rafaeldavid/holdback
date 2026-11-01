// Operator proposes, agent verifies. An operator's /v1/prepare answer is a proposal: before signing, the agent
// rebuilds the message from its own intent (what it asked for, the terms it agreed to, the hashes it computed),
// pins the EIP-712 domain and types from its own configuration, picks its own nonces, and accepts from the
// operator only a time within bounds of settlement-layer time. Any other difference, in the typed data, the digest, the slots or the body,
// refuses. The agent then signs its own typed data and submits its own body. Standard libraries only (viem), and
// tweetnacl with Web Crypto to open the buyer's own envelope before an early accept (openOwnEnvelope).
import nacl from 'tweetnacl';
import { hashStruct, hashTypedData, keccak256, toBytes, type Hex } from 'viem';

export type Domain = { name: 'Holdback'; version: string; chainId: number; verifyingContract: Hex };
/** SimChain's domain, as `pnpm sim` prints it. Configure yours; never take it from an operator. */
export const SIMCHAIN_DOMAIN: Domain = { name: 'Holdback', version: '0.6', chainId: 31337, verifyingContract: '0x00000000000000000000000000000000484f4c44' };
export const configuredDomain = (): Domain => ({
  ...SIMCHAIN_DOMAIN,
  ...(process.env['HOLDBACK_CHAIN_ID'] ? { chainId: Number(process.env['HOLDBACK_CHAIN_ID']) } : {}),
  ...(process.env['HOLDBACK_VERIFYING_CONTRACT'] ? { verifyingContract: process.env['HOLDBACK_VERIFYING_CONTRACT'] as Hex } : {}),
});

const f = (name: string, type: string) => ({ name, type });
const exp = [f('nonce', 'bytes32'), f('expiresAt', 'uint64')];
/** The EIP-712 types of schema 0.6 (packages/core/src/eip712.ts), pinned here. */
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
  EarlyAccept: [f('commitmentId', 'bytes32'), f('buyer', 'address'), f('attempt', 'uint8'), ...exp],
  Ciphertext: [f('uri', 'string'), f('sha256', 'string'), f('bytes', 'uint64'), f('cipher', 'string')],
  KeyUnlock: [f('kind', 'string'), f('round', 'uint64')],
  EncryptedKey: [f('recipient', 'address'), f('scheme', 'string'), f('ciphertext', 'string'), f('unlock', 'KeyUnlock')],
  Delivery: [f('commitmentId', 'bytes32'), f('attempt', 'uint8'), f('ciphertext', 'Ciphertext'), f('plaintextSha256', 'string'), f('plaintextMime', 'string'), f('encryptedKeys', 'EncryptedKey[]'), f('submittedAt', 'uint64')],
  Appeal: [f('commitmentId', 'bytes32'), f('appellant', 'string'), f('appellantAddress', 'address'), f('grounds', 'string'), f('bond', 'TokenAmount'), f('filedAt', 'uint64')],
  Payout: [f('to', 'address'), f('amount', 'TokenAmount')],
  MutualSettlement: [f('commitmentId', 'bytes32'), f('hasDelivery', 'bool'), f('deliveryHash', 'bytes32'), f('payouts', 'Payout[]'), f('releaseKey', 'bool'), ...exp],
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
  EarlyAccept: (m) => ({ ...m, expiresAt: secs(m.expiresAt) }),
  Delivery: (m) => ({ ...m, ciphertext: { ...m.ciphertext, bytes: BigInt(m.ciphertext.bytes) }, encryptedKeys: m.encryptedKeys.map((k: J) => ({ ...k, unlock: { kind: '', round: 0n } })), submittedAt: secs(m.submittedAt) }),
  Appeal: (m) => ({ ...m, bond: amt(m.bond), filedAt: secs(m.filedAt) }),
  MutualSettlement: (m) => ({ ...m, hasDelivery: m.deliveryHash !== null, deliveryHash: m.deliveryHash ?? `0x${'0'.repeat(64)}`, payouts: m.payouts.map((p: J) => ({ to: p.to, amount: amt(p.amount) })), expiresAt: secs(m.expiresAt) }),
};

/** What the agent itself intends, per kind. `terms` are the commitment terms the agent signed or agreed to. */
export type Intent =
  | { kind: 'offer'; request: J; registration: { policy: J; policyHash: Hex; registry: { hash: Hex }; fee: { min: J } }; rulebookHash: Hex }
  /**
   * expectedPrice: the price you negotiated, checked exactly (maxTotal alone lets a price raised within budget pass).
   * expectedCommitmentId: optionally, the ID of the exact terms you expect (commitmentIdOf of your own copy).
   */
  | { kind: 'agree-and-fund'; terms: J; me: string; encryptionPublicKey: string; maxTotal: bigint; agreeNonce: Hex; fundingNonce: Hex; expectedPrice?: { token: string; amount: string }; expectedCommitmentId?: Hex }
  | { kind: 'delivery'; terms: J; ciphertext: { uri: string; sha256: string; bytes: number }; plaintextSha256: string; encryptedKeys: J[] }
  /** Run openOwnEnvelope on the seller's signed delivery first: an early accept pays for the envelope the seller filed. */
  | { kind: 'early-accept'; terms: J; nonce: Hex }
  /** appealBondRateBps: from the club rulebook as at least two operators serve it. */
  | { kind: 'appeal'; terms: J; me: string; grounds?: string; appealBondRateBps: number }
  | { kind: 'settlement'; terms: J; payouts: J[]; releaseKey: boolean; deliveryHash: Hex | null; nonce: Hex };
type Plan = { path: string; body: J; slots: Array<{ slot: string; primaryType: string; signer: string; message: J }> };

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
      schemaVersion: '0.6', clubId: r.clubId, rulebookHash: intent.rulebookHash, buyer: r.buyer.address.toLowerCase(), seller: r.seller.toLowerCase(), deliverable: r.deliverable,
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
    if (total > intent.maxTotal) refuse(`price plus fee ${total} exceeds your limit ${intent.maxTotal}`);
    if (String(intent.agreeNonce).toLowerCase() === String(intent.fundingNonce).toLowerCase()) refuse('agreeNonce and fundingNonce must differ');
    const agree = { type: 'Agree', commitmentId: id, buyer: t.buyer, nonce: own(intent.agreeNonce, op.nonce, 'agreeNonce'), expiresAt: t.timing.offerExpiresAt };
    const fund = { type: 'FundingAuthorization', scheme: 'erc3009', commitmentId: id, from: t.buyer, value: total.toString(), token: t.price.token, validAfter: t.createdAt, validBefore: t.timing.fundBy, nonce: own(intent.fundingNonce, op.fund?.nonce, 'fundingNonce'), expiresAt: t.timing.fundBy };
    return { path: `/v1/commitments/${id}/agree`, body: { ...agree, signature: null, fund: { ...fund, signature: null } }, slots: [{ slot: 'signature', primaryType: 'Agree', signer: t.buyer, message: agree }, { slot: 'fund.signature', primaryType: 'FundingAuthorization', signer: t.buyer, message: fund }] };
  }
  if (intent.kind === 'delivery') {
    const m = { commitmentId: id, attempt: 1, ciphertext: { ...intent.ciphertext, cipher: 'aes-256-gcm' }, plaintextSha256: intent.plaintextSha256, plaintextMime: t.deliverable.format, encryptedKeys: intent.encryptedKeys, submittedAt: near(op.submittedAt, 600, 60, 'submittedAt') };
    return { path: `/v1/commitments/${id}/deliveries`, body: { ...m, signature: null }, slots: [{ slot: 'signature', primaryType: 'Delivery', signer: t.seller, message: m }] };
  }
  if (intent.kind === 'early-accept') {
    const m = { type: 'EarlyAccept', commitmentId: id, buyer: t.buyer, attempt: 1, nonce: own(intent.nonce, op.nonce, 'nonce'), expiresAt: near(op.expiresAt, 0, 86_400, 'expiresAt') };
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
    const typed = { domain, types: TYPES, primaryType: want.primaryType, message: ENCODE[want.primaryType]!(want.message) };
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
 * Opens the buyer's own envelope before an early accept (T-024, D32). The settlement layer cannot check
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
