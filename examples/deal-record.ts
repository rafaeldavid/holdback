// The deal record (T-333): one file that shows what was agreed, what was delivered, how it was decided and how it
// settled, for a buyer or a seller to keep as evidence (D26). It runs on the party's own machine, reads the deal from
// every configured operator, and discloses nothing: it sends GET requests only, only to those operators, and adds no
// route or storage anywhere (D35).
//
// It writes only what it checked, and says how. Each check is ok true, false, or null with the reason it could not
// run. It builds one view of the deal per operator, from that operator's answers alone, and compares the views
// section by section: a section where operators differ is kept per operator and named in `disagreements`, never merged.
//
//   node examples/deal-record.ts <commitmentId> --as buyer|seller [--delivery <file>] [--settlement <file>] [--out <file>]
//
// Env: HOLDBACK_OPERATORS (comma-separated; default the public test service's two nodes). For the buyer,
// HOLDBACK_ENCRYPTION_KEY (its x25519 secret key, base64url) opens its own released envelope to check the work's
// hash; the key and the work never reach the record. --delivery is the signed delivery body the seller submitted:
// with it the record recomputes the delivery hash and recovers the seller's delivery signature. --settlement is your
// own copy of the signed MutualSettlement: for late work accepted by settlement it is the only source of the delivery
// hash, which the record prints and checks against --delivery.
//
// Public deals only: a private or judgment-level deal's terms need a ReadToken, and the record marks them unreadable.
// Transactions and balances are what the operators report; read the chain itself to check them.
import { readFileSync, writeFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { recoverMessageAddress, recoverTypedDataAddress, type Hex } from 'viem';
import { command, isMain } from './entry.ts';
import { commitmentIdOf, deliveryHashOf, jcs, jcsHash, knownPins, operatorFeeOf, typedOf, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Money = { token: string; amount: string };
/** One check: ok true or false with how it was checked, or null with why it could not run. */
export type Check = { check: string; ok: boolean | null; how?: string; why?: string; operator?: string };
/** A section of the record, or each operator's version of it when they differ. */
export type Section<T> = T | { byOperator: Record<string, T> };
export type Row = {
  commitmentId: Hex; buyer: string | null; seller: string | null;
  /** The money addresses the terms name (ADR-0033), and which of them received money out of escrow: paidTo the price or the seller's share, refundedTo the rest. */
  buyerPaymentAddress: string | null; sellerPayoutAddress: string | null; paidTo: string | null; refundedTo: string | null;
  price: Money | null; adjudicationFee: Money | null; operatorFee: Money | null;
  outcome: string | null; reclaimed: boolean | null;
  /** Late work accepted by a mutual settlement that carried it (lateWorkOf). */
  lateWork: boolean | null;
  offeredAt: string | null; agreedAt: string | null; fundedAt: string | null; deliveredAt: string | null;
  decidedAt: string | null; settledAt: string | null; panelDecision: string | null; transactions: string[] | null;
};
export type DealRecord = {
  record: 'holdback-deal-record/1';
  commitmentId: Hex;
  party: 'buyer' | 'seller';
  writtenAt: string;
  operators: Array<{ api: string; answered: boolean; operatorId: string | null; receiptSigner: string | null; domain: J }>;
  terms: J;
  outcome: J;
  steps: J[];
  delivery: J;
  judgment: J;
  settlement: J;
  /** The balances now, as the operators report them: their report, not checked here. */
  balances: J;
  checks: Check[];
  disagreements: Array<{ section: string; operators: string[] }>;
  row: Row;
};
export type Options = {
  /** The operators to read, two or more at distinct origins for a record worth keeping. */
  operators: string[];
  party: 'buyer' | 'seller';
  /** The buyer's x25519 secret key, base64url: opens its own released envelope. Never written to the record. */
  encryptionSecretKey?: string;
  /** The signed delivery body the seller submitted (Agent.deliverAndShare's `delivery`). */
  delivery?: J | null;
  /**
   * The party's own copy of the signed MutualSettlement, when the deal settled by agreement. No public read carries a
   * settlement's deliveryHash, so for late work this copy is the source: the record prints its deliveryHash and checks
   * it against the delivery above, when given.
   */
  settlement?: J | null;
};

const ID = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CIPHERTEXT_ID = /^sha256:[0-9a-f]{64}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const SECTIONS = ['terms', 'outcome', 'steps', 'delivery', 'judgment', 'settlement', 'balances'] as const;
const SETTLED = ['settlement.released', 'settlement.refunded', 'settlement.reclaimed', 'commitment.settled'];
const RECEIPT_TYPES = { Receipt: ['operator:address', 'eventSeq:uint64', 'eventHash:bytes32', 'hasCommitment:bool', 'commitmentId:bytes32'].map((s) => ({ name: s.split(':')[0]!, type: s.split(':')[1]! })) };
const lc = (s: unknown) => String(s).toLowerCase();
/** A JSON value with every 0x-hex string lowercased, so addresses compare ignoring case. */
const lowerAll = (v: J): J => JSON.parse(JSON.stringify(v ?? null), (_k, x) => (typeof x === 'string' && /^0x[0-9a-fA-F]+$/.test(x) ? x.toLowerCase() : x));
const sha256 = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex')}`;
const sum = (xs: Money[]) => xs.reduce((a, x) => a + BigInt(x.amount), 0n);
const isMoney = (m: J): m is Money => typeof m?.token === 'string' && typeof m?.amount === 'string' && /^(0|[1-9][0-9]*)$/.test(m.amount);

/**
 * Late work accepted by settlement (SC-5b, T-378's route): the work was never posted as a delivery, and the parties'
 * mutual settlement carried it and released its key. No event marks it; the record derives it from the log:
 * `commitment.settled` with `keyReleased: true`, a `key.released` with path "mutual settlement" after it, and no
 * `delivery.submitted` at all. No public read carries the settlement's deliveryHash (T-378, measured), so
 * `deliveryHash` comes from the party's own signed MutualSettlement (`settlement`), and is null without it.
 */
export function lateWorkOf(events: J[], settlement?: J | null): { deliveryHash: string | null; keyReleasedTo: string | null } | null {
  if (events.some((e) => e.type === 'delivery.submitted')) return null;
  const settled = events.filter((e) => e.type === 'commitment.settled' && e.payload?.keyReleased === true).at(-1);
  if (!settled) return null;
  const key = events.find((e) => e.type === 'key.released' && e.payload?.path === 'mutual settlement' && Number(e.seq) > Number(settled.seq));
  if (!key) return null;
  const hash = String(settlement?.deliveryHash ?? '');
  return { deliveryHash: ID.test(lc(hash)) ? lc(hash) : null, keyReleasedTo: ADDRESS.test(String(key.payload?.recipient)) ? lc(key.payload.recipient) : null };
}
/** The one line the record prints for late work accepted by settlement. */
export const lateWorkLine = (w: NonNullable<ReturnType<typeof lateWorkOf>>): string =>
  `The work was delivered late and accepted by a mutual settlement, which released its key${w.keyReleasedTo ? ` to ${w.keyReleasedTo}` : ''}; delivery hash ${w.deliveryHash ?? 'not confirmed (pass your signed settlement and the delivery: --settlement <file> --delivery <file>)'}.`;

/** GET from one operator: the parsed body on 2xx, the status otherwise, null when it does not answer in 15 s. */
async function get(api: string, path: string): Promise<{ status: number; body: J } | null> {
  try {
    const res = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(15_000) });
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    return null;
  }
}
async function bytesFrom(api: string, path: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** What one operator serves for the deal. */
type Answers = { api: string; discovery: J; state: J; terms: { status: number; body: J } | null; events: J[]; receipts: J[]; judgment: J | null; balances: Record<string, J>; key: J[] | null };

async function read(api: string, id: Hex, party: 'buyer' | 'seller', wantKey: boolean): Promise<Answers | null> {
  const discovery = await get(api, '/.well-known/holdback.json');
  const state = await get(api, `/v1/commitments/${id}`);
  if (!discovery?.body || !state?.body) return null;
  const terms = await get(api, `/v1/commitments/${id}/terms`);
  const page = async (path: string) => {
    const items: J[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const r = await get(api, `${path}?limit=200${cursor ? `&cursor=${cursor}` : ''}`);
      if (!r?.body || !Array.isArray(r.body.items)) break;
      items.push(...r.body.items);
      cursor = typeof r.body.nextCursor === 'string' && CURSOR.test(r.body.nextCursor) ? r.body.nextCursor : null;
      if (!cursor) break;
    }
    return items;
  };
  const events = (await page(`/v1/commitments/${id}/events`)).sort((a, b) => a.seq - b.seq);
  const receipts = await page(`/v1/commitments/${id}/receipts`);
  const judgment = (await get(api, `/v1/commitments/${id}/judgment`))?.body ?? null;
  const t = terms?.body ?? {};
  const balances: Record<string, J> = {};
  // The parties' signing addresses and, when they differ, the two money addresses (ADR-0033), which hold the deal's money.
  for (const role of ['buyer', 'seller', 'buyerPaymentAddress', 'sellerPayoutAddress']) {
    const at = lc(t[role]);
    const signer = role === 'buyerPaymentAddress' ? lc(t.buyer) : role === 'sellerPayoutAddress' ? lc(t.seller) : null;
    if (ADDRESS.test(String(t[role])) && at !== signer) balances[role] = (await get(api, `/v1/balances/${at}`))?.body ?? null;
  }
  const key = wantKey && party === 'buyer' && ADDRESS.test(String(t.buyer)) ? ((await get(api, `/v1/commitments/${id}/key?recipient=${lc(t.buyer)}`))?.body?.items ?? null) : null;
  return { api, discovery: discovery.body, state: state.body, terms, events, receipts, judgment, balances, key };
}

/** The ciphertext with this ID from the configured operators, `first` first, checked against the ID. */
async function ciphertextOf(sha: string, first: string, operators: string[], cache: Map<string, Uint8Array | null>): Promise<Uint8Array | null> {
  if (cache.has(sha)) return cache.get(sha)!;
  let found: Uint8Array | null = null;
  for (const api of [first, ...operators.filter((o) => o !== first)]) {
    const b = await bytesFrom(api, `/v1/ciphertext/${sha}`);
    if (b && (await sha256(b)) === sha) {
      found = b;
      break;
    }
  }
  cache.set(sha, found);
  return found;
}

type View = { sections: Record<(typeof SECTIONS)[number], J>; checks: Check[]; pin: Pin | undefined };

/** The deal as one operator serves it, with every check that operator's answers allow. */
async function view(a: Answers, id: Hex, o: Options, cache: Map<string, Uint8Array | null>): Promise<View> {
  const checks: Check[] = [];
  const add = (check: string, ok: boolean | null, note: string) => checks.push({ check, ok, ...(ok === null ? { why: note } : { how: note }) });
  const domain = a.discovery.domain;
  const pin = knownPins().find((p) => jcs({ ...p.domain, verifyingContract: lc(p.domain.verifyingContract) }) === jcs({ ...domain, verifyingContract: lc(domain?.verifyingContract) }));
  add('domain is pinned', pin !== undefined, pin ? `the operator serves EIP-712 domain ${jcs(domain)}, one pinned in verify.ts` : `the operator serves EIP-712 domain ${jcs(domain)}, which verify.ts does not pin`);
  const events = a.events;
  const of = (type: string) => events.filter((e) => e.type === type);
  const first = (type: string) => of(type)[0] ?? null;

  // Terms: the commitment ID recomputed, the seller's signature recovered.
  let t: J = null;
  let terms: J = null;
  if (!a.terms?.body) {
    add('commitment ID', null, a.terms?.status === 401 || a.terms?.status === 403 ? 'the terms need a ReadToken (a private or judgment-level deal), which this program does not send' : `the operator did not serve the terms (HTTP ${a.terms?.status ?? 'no answer'})`);
  } else {
    const { id: servedId, signatures, ...rest } = a.terms.body;
    t = rest;
    let recomputed: string | null = null;
    try {
      recomputed = commitmentIdOf(t);
    } catch {
      recomputed = null;
    }
    add('commitment ID', recomputed === id && lc(servedId) === id, recomputed === id ? 'the EIP-712 struct hash of the served terms is the commitment ID' : `the served terms hash to ${recomputed ?? 'nothing (malformed)'}, not ${id}`);
    let signer: string | null = null;
    if (pin && recomputed) signer = lc(await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', t, pin.domain), signature: signatures?.seller }).catch(() => ''));
    if (!pin) add("seller's terms signature", null, 'no pinned domain to recover it under');
    else add("seller's terms signature", signer === lc(t.seller), signer === lc(t.seller) ? 'recovered to the seller the terms name' : `recovered to ${signer || 'nothing'}, not the seller ${lc(t.seller)}`);
    terms = { commitmentId: recomputed, signed: t, signatures: { seller: { signature: signatures?.seller ?? null, signer } } };
    const hashes = [...of('commitment.offered'), ...of('commitment.agreed')].map((e) => lc(e.payload?.termsHash));
    add('termsHash in events', hashes.length > 0 && hashes.every((h) => h === id), `the offered and agreed events (${hashes.length}) carry the commitment ID as termsHash`);
  }

  // The events: each hash recomputed, each receipt recovered to the operator's receipt signer.
  const badHash = events.filter((e) => {
    const { hash, ...body } = e;
    return jcsHash(body) !== lc(hash);
  });
  add('event hashes', events.length > 0 && badHash.length === 0, badHash.length ? `events ${badHash.map((e) => e.seq).join(', ')} do not hash to the hash they carry` : `all ${events.length} events hash to the hash they carry (keccak256 of RFC 8785 JSON)`);
  const signerOf = lc(a.discovery.receiptSigner);
  if (!pin) add('operator receipts', null, 'no pinned domain to recover them under');
  else {
    let good = 0;
    for (const e of events) {
      const r = a.receipts.find((x) => x.eventSeq === e.seq && lc(x.eventHash) === lc(e.hash) && lc(x.operator) === signerOf);
      if (!r) continue;
      const message = { operator: r.operator, eventSeq: BigInt(r.eventSeq), eventHash: r.eventHash, hasCommitment: r.commitmentId !== undefined, commitmentId: r.commitmentId ?? `0x${'0'.repeat(64)}` };
      const got = await recoverTypedDataAddress({ domain: pin.domain, types: RECEIPT_TYPES, primaryType: 'Receipt', message, signature: r.signature }).catch(() => '');
      if (lc(got) === signerOf) good++;
    }
    add('operator receipts', events.length > 0 && good === events.length, `${good} of ${events.length} events carry a receipt that recovers to the operator's receipt signer ${signerOf}`);
  }

  // Outcome and steps.
  const s = a.state;
  // Late work: the party's own signed MutualSettlement is the only source of the accepted delivery's hash (no public
  // read carries it). The record uses it only once it is bound to what happened on the deal: signed by both parties
  // the terms name, under the pinned domain, with the payouts and the key release the settled event records; and,
  // with the signed delivery, the released envelope is the delivery's own (PR 3 review, finding 2).
  const late = lateWorkOf(events, null);
  let candidate: J | null = null;
  let bound: J | null = null;
  if (late) {
    const m = o.settlement;
    const name = 'late work: the settlement is the one that settled';
    const settled = of('commitment.settled').filter((e) => e.payload?.keyReleased === true).at(-1);
    if (!m) add(name, null, 'pass your signed MutualSettlement (--settlement <file>): no public read carries its deliveryHash');
    else if (!pin || !t) add(name, null, !pin ? 'no pinned domain to recover its signatures under' : 'the terms were not read');
    else {
      const typed = (() => {
        try {
          return typedOf('MutualSettlement', { ...m, type: 'MutualSettlement' }, pin.domain);
        } catch {
          return null;
        }
      })();
      const by = async (sig: J) => (typed ? lc(await recoverTypedDataAddress({ ...typed, signature: sig }).catch(() => '')) : '');
      const why =
        lc(m.commitmentId) !== id ? `it is for ${lc(m.commitmentId)}, not ${id}`
        : m.releaseKey !== true ? 'it does not release the key'
        : !typed ? 'it is not a MutualSettlement'
        : (await by(m.buyerSignature)) !== lc(t.buyer) ? "its buyerSignature does not recover to the buyer the terms name"
        : (await by(m.sellerSignature)) !== lc(t.seller) ? "its sellerSignature does not recover to the seller the terms name"
        : jcs(lowerAll(m.payouts ?? null)) !== jcs(lowerAll(settled?.payload?.payouts ?? null)) ? 'its payouts are not the ones the settled event records'
        : null;
      add(name, why === null, why ?? 'signed by the buyer and the seller the terms name, releasing the key, with the payouts the settled event records');
      if (why === null) candidate = m;
    }
    // No public event carries the settlement's nonce or deliveryHash, so a signed draft that was never submitted would
    // pass the check above. The released envelope decides: it is sealed afresh for each delivery, so only the delivery
    // that settled holds it. The record names a delivery hash only once that holds too.
    if (candidate && o.delivery) {
      let rebuilt = '';
      try {
        rebuilt = lc(deliveryHashOf(o.delivery));
      } catch {
        rebuilt = '';
      }
      const released = of('key.released').find((e) => e.payload?.path === 'mutual settlement')?.payload?.envelope;
      const inDelivery = Array.isArray(o.delivery.encryptedKeys) && o.delivery.encryptedKeys.some((k: J) => k?.ciphertext !== undefined && k.ciphertext === released?.ciphertext);
      const why = !rebuilt ? 'the delivery you passed is not a delivery body' : rebuilt !== lc(candidate.deliveryHash) ? `the delivery you passed hashes to ${rebuilt}; the settlement names ${lc(candidate.deliveryHash)}` : !inDelivery ? 'the envelope the settlement released is not among the delivery\'s envelopes' : null;
      add('late work: settlement names the delivery', why === null, why ?? `the delivery hashes to the settlement's ${rebuilt}, and the released envelope is one of its own`);
      if (why === null) bound = candidate;
    } else if (candidate) add('late work: settlement names the delivery', null, 'pass the signed delivery (--delivery <file>): the record names a delivery hash only once the released envelope is found in it');
  }
  const outcome = { escrowState: s.escrowState, appealState: s.appealState, reclaimed: of('settlement.reclaimed').length > 0, settledAt: s.settledAt ?? null, finalAt: s.finalAt ?? null, lateWork: late ? lateWorkOf(events, bound) : null };
  const steps = events.map((e) => ({ step: e.type, at: e.at, actor: e.actor ?? null }));

  // Delivery: the ciphertext's hash from the bytes, the plaintext's for the buyer, the delivery hash from the body.
  const d = of('delivery.submitted').at(-1) ?? null;
  let delivery: J = null;
  if (d) {
    const p = d.payload ?? {};
    delivery = { attempt: p.attempt, deliveryHash: lc(p.deliveryHash), plaintextSha256: p.plaintextSha256, ciphertext: { uri: p.ciphertext?.uri, sha256: p.ciphertext?.sha256, bytes: p.ciphertext?.bytes }, submittedAt: d.at };
    const sha = String(p.ciphertext?.sha256);
    // The bytes come from a configured operator's store at /v1/ciphertext/<sha256>, never from the recorded URI.
    const ct = CIPHERTEXT_ID.test(sha) ? await ciphertextOf(sha, a.api, o.operators, cache) : null;
    if (ct) add('ciphertext sha256', ct.length === Number(p.ciphertext?.bytes), `the ${ct.length} bytes a configured operator stores hash to the recorded ciphertext.sha256`);
    else add('ciphertext sha256', null, CIPHERTEXT_ID.test(sha) ? 'no configured operator serves bytes that hash to the recorded ciphertext.sha256' : 'the recorded ciphertext.sha256 is malformed');
    const released = (a.key ?? []).find((k: J) => lc(k.recipient) === lc(t?.buyer));
    if (o.party !== 'buyer') add('plaintext sha256', null, 'the envelopes are sealed to the buyer and the adjudicators; the buyer can check this with its own key');
    else if (!o.encryptionSecretKey) add('plaintext sha256', null, 'set HOLDBACK_ENCRYPTION_KEY to your encryption secret key to open your own envelope');
    else if (!released) add('plaintext sha256', null, 'the work was not released to you, so there is no envelope to open');
    else if (!ct) add('plaintext sha256', null, 'no ciphertext to decrypt');
    else {
      const secret = new Uint8Array(Buffer.from(o.encryptionSecretKey, 'base64url'));
      const mine = secret.length === 32 && Buffer.from(nacl.box.keyPair.fromSecretKey(secret).publicKey).toString('base64url') === t?.buyerEncryptionPublicKey;
      const env = Buffer.from(String(released.ciphertext), 'base64url');
      const key = mine && env.length === 104 ? nacl.box.open(env.subarray(56), env.subarray(32, 56), env.subarray(0, 32), secret) : null;
      let got: string | null = null;
      if (key?.length === 32) {
        try {
          const aes = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['decrypt']);
          got = await sha256(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.slice(0, 12) }, aes, ct.slice(12))));
        } catch {
          got = null;
        }
      }
      if (!mine) add('plaintext sha256', null, "HOLDBACK_ENCRYPTION_KEY is not the key whose public half the terms name as buyerEncryptionPublicKey");
      else add('plaintext sha256', got === p.plaintextSha256, got === p.plaintextSha256 ? 'your released envelope opens, the ciphertext decrypts, and the work hashes to the recorded plaintextSha256' : 'your envelope or the ciphertext does not open to work with the recorded plaintextSha256');
    }
    const body = o.delivery;
    if (!body) {
      add('delivery hash', null, 'pass the signed delivery body (--delivery <file>) to recompute it');
      add("seller's delivery signature", null, 'pass the signed delivery body (--delivery <file>) to recover it');
    } else {
      let hash = '';
      try {
        hash = deliveryHashOf(body);
      } catch {
        hash = '';
      }
      add('delivery hash', lc(body.commitmentId) === id && hash === lc(p.deliveryHash), hash === lc(p.deliveryHash) ? 'the EIP-712 struct hash of your delivery body is the recorded deliveryHash' : `your delivery body hashes to ${hash || 'nothing (malformed)'}, not the recorded ${lc(p.deliveryHash)}`);
      const { signature, ...m } = body;
      const signer = pin ? lc(await recoverTypedDataAddress({ ...typedOf('Delivery', m, pin.domain), signature }).catch(() => '')) : '';
      if (!pin) add("seller's delivery signature", null, 'no pinned domain to recover it under');
      else add("seller's delivery signature", signer === lc(t?.seller), signer === lc(t?.seller) ? 'recovered to the seller the terms name' : `recovered to ${signer || 'nothing'}, not the seller`);
      if (signer) delivery.signer = signer;
    }
  }

  // Judgment: the record hash recomputed, the adjudicator's signature recovered, tied to the event and the delivery.
  let judgment: J = null;
  const j = a.judgment;
  if (j && typeof j === 'object' && j.commitmentId) {
    const { recordHash, signature, recordUri: _u, ...body } = j; // eslint-disable-line @typescript-eslint/no-unused-vars
    const recomputed = jcsHash(body);
    add('judgment recordHash', recomputed === lc(recordHash), recomputed === lc(recordHash) ? 'keccak256 of the RFC 8785 JSON of the record is its recordHash' : `the record hashes to ${recomputed}, not ${lc(recordHash)}`);
    const signer = lc(await recoverMessageAddress({ message: { raw: recordHash }, signature }).catch(() => ''));
    const named = t ? [t.adjudication?.adjudicator, t.adjudication?.fallbackAdjudicator, t.adjudication?.appealAdjudicator].map(lc) : [];
    add("adjudicator's record signature", signer === lc(j.adjudicator) && named.includes(signer), `recovered to ${signer || 'nothing'}; the record names ${lc(j.adjudicator)}; the terms name ${named.join(', ') || 'no adjudicators (terms unread)'}`);
    // `appeal.decided`: SimChain only, where the full protocol's party appeal is decided (ADR-0031 §8); no phase-one chain emits it.
    const decided = [...of('judgment.decided'), ...of('appeal.decided')].map((e) => lc(e.payload?.recordHash));
    add('judgment names the delivery', decided.includes(lc(recordHash)) && lc(j.deliveryHash) === lc(d?.payload?.deliveryHash), 'a decided event carries this recordHash, and the record names the recorded deliveryHash');
    // SimChain only: as above.
    const ev = [...of('judgment.decided'), ...of('appeal.decided')].find((e) => lc(e.payload?.recordHash) === lc(recordHash));
    judgment = {
      adjudicator: lc(j.adjudicator), role: j.role, attempt: j.attempt, deliveryHash: lc(j.deliveryHash), outcome: ev?.payload?.outcome ?? null, decision: j.aggregate?.decision ?? null,
      reasons: j.aggregate?.reasons ?? [], weightedScore: j.aggregate?.weightedScore ?? null, intake: j.intake ?? null, deterministic: j.deterministic ?? [], screen: j.screen ?? null,
      panel: { ran: j.panel?.ran ?? false, policyId: j.panel?.policyId ?? null, policyHash: j.panel?.policyHash ?? null, seedSource: j.panel?.seedSource ?? null, members: j.panel?.members ?? [] },
      decidedAt: j.decidedAt ?? null, recordHash: lc(recordHash), signer,
    };
  }

  // Settlement: the hold, the operator fee, the postings out of escrow, the transactions.
  const price: Money | null = isMoney(t?.price) ? t.price : null;
  const fee: Money | null = isMoney(t?.adjudication?.fee) ? t.adjudication.fee : null;
  const funded = first('hold.funded');
  const hold: Money | null = isMoney(funded?.payload?.amount) ? funded.payload.amount : null;
  if (price && fee && hold) add('hold is price plus fee', hold.token === price.token && BigInt(hold.amount) === BigInt(price.amount) + BigInt(fee.amount), `the funded hold ${hold.amount} ${hold.token} against price ${price.amount} plus adjudication fee ${fee.amount}`);
  else add('hold is price plus fee', null, hold ? 'the terms were not read' : 'no hold was funded');
  const paid = of('fee.operator').map((e) => e.payload?.amount).filter(isMoney);
  const operatorFee: Money | null = price ? { token: price.token, amount: sum(paid).toString() } : null;
  if (price && operatorFee) {
    let due = 0n;
    let schedule = 'no fee schedule';
    try {
      const sch = a.discovery.fees?.operator;
      if (sch) {
        due = operatorFeeOf(price, sch);
        schedule = 'the fee schedule the operator publishes now';
      }
    } catch {
      due = -1n;
    }
    add('operator fee', BigInt(operatorFee.amount) === due, `${operatorFee.amount} base units paid; ${due < 0n ? 'the published schedule is malformed' : `${due} due under ${schedule}`}`);
  }
  const out = events.filter((e) => SETTLED.includes(e.type));
  let postings = out.flatMap((e) => (Array.isArray(e.payload?.postings) ? e.payload.postings : [])).filter((x: J) => lc(x.from) === `escrow:${id}`).map((x: J) => ({ to: lc(x.to), amount: x.amount, why: x.why ?? null }));
  // T-390: a mutual settlement's event carries its payouts and no postings, on SimChain and on a chain alike
  // (packages/settlement/sim/simchain.ts:967, evm-settlement.ts:1553). The payouts sum to the price; the adjudication
  // fee goes back to the buyer's payment address, less the sitting adjudicator's rulebook share (0 bps in phase one).
  const settledEv = out.at(-1)?.type === 'commitment.settled' ? out.at(-1) : null;
  const fromPayouts = postings.length === 0 && settledEv !== null && Array.isArray(settledEv.payload?.payouts);
  if (fromPayouts) postings = settledEv!.payload.payouts.map((p: J) => ({ to: lc(p.to), amount: p.amount, why: 'agreed payout (from the settled event)' }));
  // A chain's events carry no postings at all: the release's or refund's transfers are in the token's logs (Handoff).
  // Only on a chain: SimChain writes postings for every outcome but a settlement, so a SimChain event without them fails (PR 440 review, Low 3).
  const noPostings = postings.length === 0 && pin?.chain !== undefined;
  if (hold && out.length && noPostings) {
    for (const name of ['postings conserve the hold', 'postings follow the outcome']) add(name, null, "the operators' events carry no postings for this outcome; read the token's Transfer logs of the transactions below to check it");
  } else if (hold && out.length && fromPayouts) {
    const ok = postings.every((x: J) => isMoney(x.amount) && x.amount.token === hold.token && BigInt(x.amount.amount) > 0n) && price !== null && fee !== null && sum(postings.map((x: J) => x.amount)) === BigInt(price.amount) && BigInt(price.amount) + BigInt(fee.amount) === BigInt(hold.amount);
    add('postings conserve the hold', ok, `the settlement's payouts sum to the price, ${price?.amount} ${hold.token}, and the adjudication fee, ${fee?.amount}, returns to the buyer's payment address less the sitting adjudicator's rulebook share, which the event does not carry: the hold, ${hold.amount} ${hold.token}`);
    const allowed = t ? [t.sellerPayoutAddress ?? t.seller, t.buyerPaymentAddress ?? t.buyer].map(lc) : [];
    add('postings follow the outcome', t ? postings.every((x: J) => allowed.includes(x.to)) : null, t ? "settled: every payout goes to the seller's payout address or the buyer's payment address (ADR-0033)" : 'the terms were not read');
    const apart = t ? [[t.buyer, t.buyerPaymentAddress ?? t.buyer], [t.seller, t.sellerPayoutAddress ?? t.seller]].filter(([s, m]) => lc(s) !== lc(m)).map(([s]) => lc(s)) : [];
    if (apart.length) add('signing addresses receive nothing', postings.every((x: J) => !apart.includes(x.to)), `no payout goes to ${apart.join(' or ')}, which sign and differ from their money address`);
  } else if (hold && out.length) {
    const ok = postings.every((x: J) => isMoney(x.amount) && x.amount.token === hold.token) && sum(postings.map((x: J) => x.amount)) === BigInt(hold.amount);
    add('postings conserve the hold', ok, `the postings out of escrow sum to the hold, ${hold.amount} ${hold.token}`);
    const to = (who: string, amount: bigint) => postings.some((x: J) => x.to === lc(who) && BigInt(x.amount.amount) === amount);
    const adjudicators = t ? [t.adjudication.adjudicator, t.adjudication.fallbackAdjudicator, t.adjudication.appealAdjudicator].map(lc) : [];
    const rest = (who: string) => postings.filter((x: J) => x.to !== lc(who)).every((x: J) => adjudicators.includes(x.to));
    const type = out.at(-1).type;
    // ADR-0033: money goes to the seller's payout address and back to the buyer's payment address, never to a signing address that differs.
    const payout = t?.sellerPayoutAddress ?? t?.seller, payment = t?.buyerPaymentAddress ?? t?.buyer;
    if (!t || !price) add('postings follow the outcome', null, 'the terms were not read');
    else if (type === 'settlement.released') add('postings follow the outcome', to(payout, BigInt(price.amount)) && rest(payout), "released: the price to the seller's payout address, the rest to adjudicators the terms name");
    else if (type === 'settlement.refunded') add('postings follow the outcome', to(payment, BigInt(price.amount)) && rest(payment), "refunded: the price to the buyer's payment address, the rest to adjudicators the terms name");
    else if (type === 'settlement.reclaimed') add('postings follow the outcome', to(payment, BigInt(hold.amount)) && postings.length === 1, "reclaimed: the whole hold back to the buyer's payment address");
    else add('postings follow the outcome', null, `${type}: the parties' own split; compare it with the settlement they signed`);
    const apart = t ? [[t.buyer, payment], [t.seller, payout]].filter(([s, m]) => lc(s) !== lc(m)).map(([s]) => lc(s)) : [];
    if (apart.length) add('signing addresses receive nothing', postings.every((x: J) => !apart.includes(x.to)), `no posting out of escrow goes to ${apart.join(' or ')}, which sign and differ from their money address`);
  }
  const transactions = events.filter((e) => typeof e.payload?.tx === 'string' && ID.test(e.payload.tx)).map((e) => ({ step: e.type, tx: e.payload.tx, url: pin?.chain?.explorer ? `${pin.chain.explorer}/tx/${e.payload.tx}` : null }));
  const settlement = { hold, operatorFee, postings, transactions };
  const balances = { note: 'as the operators report them when the record was written; read the token contract to check', ...a.balances };
  return { sections: { terms, outcome, steps, delivery, judgment, settlement, balances }, checks, pin };
}

/** Reads `id` from every operator in `o.operators` and builds the record. Sends GET requests only. */
export async function dealRecord(id: Hex, o: Options): Promise<DealRecord> {
  const cid = lc(id) as Hex;
  if (!ID.test(cid)) throw new Error('a commitment ID is 0x and 64 hex digits');
  if (o.party !== 'buyer' && o.party !== 'seller') throw new Error('party is buyer or seller');
  const operators = [...new Set(o.operators.map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean))];
  if (operators.length === 0) throw new Error('configure at least one operator (HOLDBACK_OPERATORS)');
  const opts = { ...o, operators };
  const answers = await Promise.all(operators.map((api) => read(api, cid, o.party, Boolean(o.encryptionSecretKey))));
  const answered = answers.filter((a): a is Answers => a !== null);
  if (answered.length === 0) throw new Error(`no operator answered for ${cid} (${operators.join(', ')})`);
  const cache = new Map<string, Uint8Array | null>();
  const views = new Map<string, View>();
  for (const a of answered) views.set(a.api, await view(a, cid, opts, cache));

  const missing = operators.filter((api) => !views.has(api));
  const checks: Check[] = [{ check: 'all operators answered', ok: missing.length === 0, ...(missing.length ? { why: `no answer from ${missing.join(', ')}` } : { how: `${operators.length} of ${operators.length} configured operators answered` }) }];
  // A check every answering operator's view gives the same result is written once; otherwise once per operator.
  const names = [...new Set([...views.values()].flatMap((v) => v.checks.map((c) => c.check)))];
  for (const name of names) {
    const per = [...views.entries()].map(([api, v]) => ({ api, c: v.checks.find((c) => c.check === name) }));
    if (per.every((p) => p.c) && new Set(per.map((p) => jcs(p.c))).size === 1) checks.push(per[0]!.c!);
    else for (const p of per) if (p.c) checks.push({ ...p.c, operator: p.api });
  }
  const disagreements: DealRecord['disagreements'] = [];
  const merged = {} as Record<(typeof SECTIONS)[number], J>;
  const agreed = {} as Record<(typeof SECTIONS)[number], boolean>;
  for (const s of SECTIONS) {
    const values = [...views.entries()].map(([api, v]) => [api, v.sections[s]] as const);
    agreed[s] = new Set(values.map(([, x]) => jcs(x ?? null))).size === 1;
    merged[s] = agreed[s] ? values[0]![1] : { byOperator: Object.fromEntries(values) };
    if (!agreed[s]) disagreements.push({ section: s, operators: values.map(([api]) => api) });
  }

  const at = (step: string) => (agreed.steps ? ((merged.steps as J[]).find((x) => x.step === step)?.at ?? null) : null);
  const t = agreed.terms ? merged.terms?.signed : null;
  const st = agreed.settlement ? merged.settlement : null;
  const settledAt = agreed.steps ? ((merged.steps as J[]).find((x) => SETTLED.includes(x.step))?.at ?? null) : null;
  // Who received money out of escrow, by the money addresses the terms name (ADR-0033): the seller's payout address was
  // paid, the buyer's payment address refunded. Adjudicators' fees are left out.
  const received = (who: string | undefined) => (st && who ? st.postings.some((x: J) => x.to === lc(who) && BigInt(x.amount?.amount ?? 0) > 0n) : false);
  const row: Row = {
    commitmentId: cid, buyer: t ? lc(t.buyer) : null, seller: t ? lc(t.seller) : null,
    buyerPaymentAddress: t ? lc(t.buyerPaymentAddress) : null, sellerPayoutAddress: t ? lc(t.sellerPayoutAddress) : null,
    paidTo: t && received(t.sellerPayoutAddress) ? lc(t.sellerPayoutAddress) : null, refundedTo: t && received(t.buyerPaymentAddress) ? lc(t.buyerPaymentAddress) : null,
    price: t?.price ?? null, adjudicationFee: t?.adjudication?.fee ?? null, operatorFee: st?.operatorFee ?? null,
    outcome: agreed.outcome ? merged.outcome.escrowState : null, reclaimed: agreed.outcome ? merged.outcome.reclaimed : null, lateWork: agreed.outcome ? merged.outcome.lateWork !== null : null,
    offeredAt: at('commitment.offered'), agreedAt: at('commitment.agreed'), fundedAt: at('hold.funded'), deliveredAt: at('delivery.submitted'), decidedAt: at('judgment.decided'), settledAt,
    panelDecision: agreed.judgment ? (merged.judgment?.decision ?? null) : null, transactions: st ? st.transactions.map((x: J) => x.url ?? x.tx) : null,
  };
  return {
    record: 'holdback-deal-record/1', commitmentId: cid, party: o.party, writtenAt: new Date().toISOString(),
    operators: operators.map((api) => {
      const a = answered.find((x) => x.api === api);
      return { api, answered: Boolean(a), operatorId: a?.discovery.operatorId ?? null, receiptSigner: a ? lc(a.discovery.receiptSigner) : null, domain: a?.discovery.domain ?? null };
    }),
    ...merged, checks, disagreements, row,
  } as DealRecord;
}

/** The command: parses the arguments, reads the key from the environment, writes the record. */
async function main(argv: string[]): Promise<number> {
  const [id, ...rest] = argv;
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const party = flag('--as');
  if (!id || (party !== 'buyer' && party !== 'seller')) {
    process.stderr.write(`usage: ${command('deal-record', import.meta.url)} <commitmentId> --as buyer|seller [--delivery <file>] [--settlement <file>] [--out <file>]\n`);
    return 2;
  }
  const operators = (process.env['HOLDBACK_OPERATORS'] || 'https://api.crow.direct,https://api2.crow.direct').split(',');
  const deliveryFile = flag('--delivery');
  const delivery = deliveryFile ? JSON.parse(readFileSync(deliveryFile, 'utf8')) : null;
  const key = process.env['HOLDBACK_ENCRYPTION_KEY'] || undefined;
  const settlementFile = flag('--settlement');
  const settlement = settlementFile ? JSON.parse(readFileSync(settlementFile, 'utf8')) : null;
  const r = await dealRecord(id as Hex, { operators, party, delivery, settlement, ...(key ? { encryptionSecretKey: key } : {}) });
  const text = `${JSON.stringify(r, null, 2)}\n`;
  const out = flag('--out');
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
  const count = (ok: boolean | null) => r.checks.filter((c) => c.ok === ok).length;
  const late = (r.outcome as J)?.lateWork;
  if (late) process.stderr.write(`${lateWorkLine(late)}\n`);
  process.stderr.write(
    `Record of ${r.commitmentId} written${out ? ` to ${out}` : ''}: ${count(true)} checks passed, ${count(null)} not run, ${count(false)} failed. ` +
      `${r.disagreements.length ? `Operators differ on ${r.disagreements.map((d) => d.section).join(', ')}.` : `The ${r.operators.filter((x) => x.answered).length} answering operators agree.`}\n`,
  );
  return count(false) || r.disagreements.length ? 1 : 0;
}

// The program only when it is the one being run: not when buyer-signer.ts imports it, bundled or not (entry.ts).
if (isMain(import.meta.url, 'deal-record')) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`deal-record: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    },
  );
}
