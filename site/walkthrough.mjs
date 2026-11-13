// Runs one checks-only deal by following the HTTP path of the guides literally (site/llms.txt's pins, then
// site/ref/http.txt, signing.txt, http-seller.txt and http-buyer.txt, T-393), with no Holdback code: plain fetch, viem
// and tweetnacl, its own EIP-712 types, domain and deployment (parsed from those files) and its own message builders,
// the ERC-3009 funding and operator fee included. If the docs are wrong about a field, an encoding or a shape, this
// fails where they are wrong.
//
//   OP1=https://… OP2=https://… node site/walkthrough.mjs
//
// The page pins Sepolia (D41), so the operators must settle there: the deployed demo, or a world on a Sepolia fork
// (apps/demo-cloud/src/live-fork.test.ts runs it so). The phase-one contracts: no appeal window, a decision final when it
// settles, two money addresses in the terms, and an operator fee of 0 on Crow's nodes for the first pilots. Fresh keys, funded by POST /v1/faucet. Exits 0 with a one-line
// summary per step, or 1 at the first difference.
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';

const here = (p) => new URL(p, import.meta.url);
const { encodeAbiParameters, hashStruct, hashTypedData, keccak256, parseAbiParameters, toBytes } = await import(here('../examples/node_modules/viem/_esm/index.js'));
const { generatePrivateKey, privateKeyToAccount } = await import(here('../examples/node_modules/viem/_esm/accounts/index.js'));
const nacl = (await import(here('../examples/node_modules/tweetnacl/nacl-fast.js'))).default;

const docs = ['llms.txt', 'ref/http.txt', 'ref/signing.txt', 'ref/http-seller.txt', 'ref/http-buyer.txt'].map((f) => readFileSync(here(f), 'utf8')).join('\n');
const block = (after) => {
  const at = docs.indexOf(after);
  const start = docs.indexOf('```json\n', at) + 8;
  return JSON.parse(docs.slice(start, docs.indexOf('\n```', start)));
};
const TYPES = block('## EIP-712 types');
const DOMAIN = block('Pin this EIP-712 domain');
const DEPLOYMENT = block('Pin this deployment too');
const ERC3009_TYPES = block("USDC's ERC-3009 types");

const log = (s) => console.log(`ok  ${s}`);
const fail = (s) => {
  throw new Error(`docs disagree with the API: ${s}`);
};
const same = (a, b, what) => (jcs(a) === jcs(b) ? true : fail(`${what}: expected ${jcs(b)}, got ${jcs(a)}`));
const jcs = (v) => (typeof v === 'bigint' ? `${v}` : Array.isArray(v) ? `[${v.map(jcs).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}` : JSON.stringify(v));
const jcsHash = (v) => keccak256(toBytes(jcs(v)));
const sha = (b) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const nonce = () => `0x${randomBytes(32).toString('hex')}`;
const b64 = (b) => Buffer.from(b).toString('base64url');
const secs = (iso) => Date.parse(iso) / 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The operators
const { OP1, OP2 } = process.env;
let api = '';
if (!OP1 || !OP2) {
  console.error('walkthrough: set OP1 and OP2 to two operators that settle where llms.txt pins (Sepolia)');
  process.exit(1);
}
const call = async (method, url, body, headers = {}) => {
  const isBytes = body instanceof Uint8Array;
  const res = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': isBytes ? 'application/octet-stream' : 'application/json' }), ...headers },
    body: body === undefined ? undefined : isBytes ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${url} answered ${res.status}: ${text}`);
  return JSON.parse(text);
};
const write = (path, body) => call('POST', `${api}${path}`, body, { 'Idempotency-Key': randomUUID() });
const both = async (path) => {
  const [a, b] = await Promise.all([OP1, OP2].map((op) => call('GET', `${op}${path}`)));
  same(a, b, `the two operators on ${path}`);
  return a;
};

try {
  // 1. Keys
  const party = async (label) => ({ label, account: privateKeyToAccount(generatePrivateKey()), enc: nacl.box.keyPair() });
  const seller = await party('seller'), buyer = await party('buyer');
  for (const p of [seller, buyer]) {
    p.address = p.account.address.toLowerCase();
    p.encPub = b64(p.enc.publicKey);
    if (p.encPub.length !== 43) fail('an encryption public key is 43 base64url characters');
  }
  log('1 keys: a signing key and an encryption key per party');

  // 2. Discovery, faucet, adjudicator
  const wk = await call('GET', `${OP1}/.well-known/holdback.json`);
  for (const k of ['apiBaseUrl', 'domain', 'receiptSigner', 'settlementTime']) if (!(k in wk)) fail(`well-known has no ${k}`);
  same(wk.domain, DOMAIN, 'the pinned domain');
  api = wk.apiBaseUrl.replace(/\/+$/, '');
  // The token is named by its address: discovery's demo.token.id, the token of the pinned deployment.
  const token = wk.demo?.token?.id;
  if (token !== DEPLOYMENT.tokenDomain.verifyingContract || wk.demo.token.decimals !== 6) fail(`demo.token ${JSON.stringify(wk.demo?.token)} is not the pinned token`);
  let clubId;
  for (const p of [seller, buyer]) {
    const f = await write('/v1/faucet', { address: p.address });
    if (!f.clubId || f.granted?.token !== token || !f.balance?.amount) fail(`faucet response ${JSON.stringify(f)} has no clubId, grant or balance`);
    clubId = f.clubId;
  }
  const bal = await call('GET', `${api}/v1/balances/${buyer.address}`);
  if (bal.token !== token || !/^[0-9]+$/.test(bal.amount) || bal.amount === '0') fail(`balance ${JSON.stringify(bal)}`);
  const listed = await call('GET', `${api}/v1/adjudicators`);
  if (!Array.isArray(listed.items) || !listed.items.length) fail('GET /v1/adjudicators lists no items');
  // Discovery's demo object lists them by role.
  const byRole = wk.demo?.adjudicators ?? [];
  const adjAddresses = ['primary', 'fallback', 'appeal'].map((role) => byRole.find((a) => a.role === role)?.address.toLowerCase() ?? fail(`discovery lists no ${role} adjudicator`));
  for (const a of adjAddresses) if (!listed.items.some((x) => x.address.toLowerCase() === a)) fail(`adjudicator ${a} is not in GET /v1/adjudicators`);
  log(`2 discovery: domain and token pinned, club ${clubId}, buyer holds ${bal.amount} base units of ${token}, ${listed.items.length} adjudicator(s) listed`);

  // 3. What we bind to
  const settlementNow = async () => {
    const t = await Promise.all([OP1, OP2].map(async (op) => Date.parse((await call('GET', `${op}/.well-known/holdback.json`)).settlementTime)));
    if (Math.abs(t[0] - t[1]) > 5000) fail('settlement times differ by more than 5 s');
    return Math.max(...t);
  };
  const regs = [];
  for (const a of adjAddresses) {
    const r = await both(`/v1/adjudicators/${a}`);
    if (jcsHash(r.policy) !== r.policyHash) fail('policyHash is not keccak256 of the canonical policy');
    for (const k of ['encryptionPublicKey', 'registry', 'fee']) if (!(k in r)) fail(`registration has no ${k}`);
    regs.push(r);
  }
  const club = await both(`/v1/clubs/${clubId}`);
  if (jcsHash(club.rulebook) !== club.rulebookHash) fail('rulebookHash is not keccak256 of the canonical rulebook');
  log('3 bound: registrations and rulebook agree on both operators and hash as documented');

  // 4. The loop
  // Integers become BigInt; every other value, addresses and hashes included, is compared exactly as served.
  const ints = (type, v, T = TYPES) =>
    type.endsWith('[]') ? v.map((x) => ints(type.slice(0, -2), x, T)) : T[type] ? Object.fromEntries(T[type].map((f) => [f.name, ints(f.type, v[f.name], T)])) : /^u?int\d*$/.test(type) ? BigInt(v) : v;
  const typesFor = (primary) => {
    const out = {}, visit = (t) => {
      const base = t.replace(/\[\]$/, '');
      if (!TYPES[base] || out[base]) return;
      out[base] = TYPES[base];
      TYPES[base].forEach((f) => visit(f.type));
    };
    visit(primary);
    return out;
  };
  /**
   * Verify a prepared answer against our own messages; sign our typed data into the body; submit. A message signed
   * under the token's domain (the ERC-3009 funding and fee) names it in `erc3009`.
   */
  const signAndSubmit = async (prepared, me, mine, now) => {
    if (prepared.sign.length !== mine.length) fail(`expected ${mine.length} slot(s), got ${prepared.sign.length}`);
    const body = structuredClone(prepared.submit.body);
    for (const [i, want] of mine.entries()) {
      const got = prepared.sign[i];
      if (got.slot !== want.slot || got.typedData.primaryType !== want.primaryType || got.signer.toLowerCase() !== me.address) fail(`slot ${i} is ${got.slot}/${got.typedData.primaryType}`);
      const domain = want.erc3009 ? DEPLOYMENT.tokenDomain : DOMAIN;
      const T = want.erc3009 ? { [want.primaryType]: ERC3009_TYPES[want.primaryType] } : TYPES;
      same(got.typedData.domain, domain, `the ${want.primaryType} domain`);
      const theirTypes = { ...got.typedData.types };
      delete theirTypes.EIP712Domain;
      same(theirTypes, want.erc3009 ? T : typesFor(want.primaryType), `the ${want.primaryType} types`);
      const message = ints(want.primaryType, want.message, T);
      same(ints(want.primaryType, got.typedData.message, T), message, `the ${want.primaryType} message`);
      for (const k of want.near ?? []) {
        const d = Number(message[k]) * 1000 - now;
        if (d < -600_000 || d > 60_000) fail(`${k} is not near settlement time`);
      }
      const typed = { domain, types: want.erc3009 ? T : typesFor(want.primaryType), primaryType: want.primaryType, message };
      if (hashTypedData(typed) !== got.digest) fail(`our ${want.primaryType} digest differs from the operator's`);
      const sig = await me.account.signTypedData(typed);
      const keys = want.slot.split('.');
      keys.slice(0, -1).reduce((o, k) => o[k], body)[keys.at(-1)] = sig;
    }
    return write(prepared.submit.path, body);
  };

  // 5. Offer
  const checks = [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  ];
  const deliverable = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
  const price = { token, amount: '25000000' };
  const offerNonce = nonce();
  // The docs' timing: 60-second decision windows, the demo club's minimum, and no appeal window (phase one).
  const w = 60;
  const timing = { judgeWithinSec: w, fallbackWithinSec: w, appealWindowSec: 0, appealDecideSec: w };
  same(JSON.parse(/^ {2}"timing": (\{.*\})$/m.exec(docs)?.[1] ?? 'null'), timing, 'the timing in the offer example');
  const offerReq = {
    nonce: offerNonce, disclosure: 'public', template: 'checks-only', clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encPub },
    adjudicators: { primary: adjAddresses[0], fallback: adjAddresses[1], appeal: adjAddresses[2] }, price, deliverable, checks, timing,
  };
  const offer = await call('POST', `${api}/v1/prepare/offer`, offerReq);
  if (offer.submit.path !== '/v1/commitments' || offer.sign[0]?.slot !== 'signatures.seller') fail('offer slot or path');
  let now = await settlementNow();
  const m = offer.sign[0].typedData.message, createdAt = Number(m.createdAt), reg = regs[0];
  const termsMsg = {
    // schemaVersion "0.8"; each money address left out of the request is that party's signing address (ref/http-seller.txt).
    schemaVersion: '0.8', clubId, rulebookHash: club.rulebookHash, buyer: buyer.address, seller: seller.address, buyerPaymentAddress: buyer.address, sellerPayoutAddress: seller.address,
    deliverableHash: jcsHash(deliverable), acceptanceHash: jcsHash({ deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } }), price,
    adjudication: { adjudicator: adjAddresses[0], fallbackAdjudicator: adjAddresses[1], appealAdjudicator: adjAddresses[2], policyId: reg.policy.id, fee: reg.fee.min, registryHash: reg.registry.hash, policyHash: reg.policyHash },
    timing: { offerExpiresAt: createdAt + 900, fundBy: createdAt + 1800, deliverBy: createdAt + 86400, judgeBy: createdAt + 86400 + w, fallbackBy: createdAt + 86400 + 2 * w, appealWindowSec: 0, appealDecideSec: w, maxSubmissions: 1, disputeBy: 0, disputeJudgeSec: 0, disputeFallbackSec: 0 },
    settlement: { mode: 'guaranteed_on_decision', token }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
    buyerEncryptionPublicKey: buyer.encPub, nonce: offerNonce, createdAt,
  };
  const id = hashStruct({ types: TYPES, primaryType: 'CommitmentTerms', data: ints('CommitmentTerms', termsMsg) });
  if (offer.submit.body.id !== id) fail(`submit.body.id ${offer.submit.body.id} is not the struct hash ${id}`);
  const offered = await signAndSubmit(offer, seller, [{ slot: 'signatures.seller', primaryType: 'CommitmentTerms', message: termsMsg, near: ['createdAt'] }], now);
  if (offered.escrowState !== 'Offered') fail(`offer answered ${offered.escrowState}`);
  let state;
  for (let i = 0; i < 150 && (state = await call('GET', `${api}/v1/commitments/${id}`)).escrowState !== 'AcceptedByAdjudicator'; i++) await wait(200);
  if (state.escrowState !== 'AcceptedByAdjudicator') fail(`never AcceptedByAdjudicator (${state.escrowState})`);
  log(`5 offer: CommitmentTerms rebuilt from intent, id = struct hash ${id.slice(0, 10)}…, Offered then AcceptedByAdjudicator`);

  // 6. Agree and fund
  const signedOffer = await both(`/v1/commitments/${id}/terms`);
  if (signedOffer.id !== id || signedOffer.buyerEncryptionPublicKey !== buyer.encPub || jcs(signedOffer.price) !== jcs(price)) fail('the terms read back differ');
  const t = signedOffer;
  const recomputed = hashStruct({
    types: TYPES, primaryType: 'CommitmentTerms',
    data: ints('CommitmentTerms', { ...t, deliverableHash: jcsHash(t.deliverable), acceptanceHash: jcsHash(t.acceptance), createdAt: secs(t.createdAt), timing: { ...Object.fromEntries(['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy'].map((k) => [k, secs(t.timing[k])])), appealWindowSec: t.timing.appealWindowSec, appealDecideSec: t.timing.appealDecideSec, maxSubmissions: t.timing.maxSubmissions, disputeBy: 0, disputeJudgeSec: 0, disputeFallbackSec: 0 } }),
  });
  if (recomputed !== id) fail('the commitment ID recomputed from /terms differs');
  // The two money addresses: the buyer's payment address is its own, and the payout address is where it agreed to pay.
  if (t.buyerPaymentAddress?.toLowerCase() !== buyer.address || t.sellerPayoutAddress?.toLowerCase() !== seller.address) fail(`the terms' money addresses ${JSON.stringify({ pay: t.buyerPaymentAddress, payout: t.sellerPayoutAddress })} are not the parties' own`);
  // The operator fee, as section 6 computes it, from both operators' discovery.
  const fees = await Promise.all([OP1, OP2].map(async (op) => (await call('GET', `${op}/.well-known/holdback.json`)).fees?.operator));
  same(fees[0], fees[1], 'fees.operator on the two operators');
  const s = fees[0];
  if (!s || s.token !== token || s.appliesAt !== 'agree-and-fund' || s.refundable !== false) fail(`fees.operator ${JSON.stringify(s)}`);
  const byBps = (BigInt(price.amount) * BigInt(s.bps) + 9_999n) / 10_000n;
  let fee = byBps > BigInt(s.min) ? byBps : BigInt(s.min);
  if (s.max !== null && fee > BigInt(s.max)) fee = BigInt(s.max);
  // The two ERC-3009 nonces, as "Encodings" computes them from the terms and the pinned deployment.
  const total = (BigInt(price.amount) + BigInt(t.adjudication.fee.amount)).toString();
  const expiry = secs(t.timing.fallbackBy) + t.timing.appealDecideSec + DEPLOYMENT.expiryMarginSec;
  const ZERO = `0x${'0'.repeat(40)}`;
  const PAYMENT_INFO = keccak256(toBytes('PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)'));
  const inner = keccak256(encodeAbiParameters(parseAbiParameters('bytes32, address, address, address, address, uint120, uint48, uint48, uint48, uint16, uint16, address, uint256'), [PAYMENT_INFO, DEPLOYMENT.rules, ZERO, t.sellerPayoutAddress, token, BigInt(total), secs(t.timing.fundBy), expiry, expiry, 0, 10_000, ZERO, BigInt(id)]));
  const fundingNonce = keccak256(encodeAbiParameters(parseAbiParameters('uint256, address, bytes32'), [BigInt(DEPLOYMENT.tokenDomain.chainId), DEPLOYMENT.escrow, inner]));
  const operatorFeeNonce = keccak256(encodeAbiParameters(parseAbiParameters('bytes32, string'), [id, 'operator_fee']));
  const agreeNonce = nonce();
  // While the fee is 0, prepare uses no operatorFeeNonce and asks for no fee signature (ref/http-buyer.txt).
  const charged = fee > 0n;
  const agree = await call('POST', `${api}/v1/prepare/agree-and-fund`, { commitmentId: id, agreeNonce, fundingNonce, ...(charged ? { operatorFeeNonce } : {}) });
  const fundBy = secs(t.timing.fundBy);
  // submit.body carries the same values, with RFC 3339 times and validAfter the epoch.
  const epoch = '1970-01-01T00:00:00Z';
  same(agree.submit.body.fund, { type: 'FundingAuthorization', scheme: 'erc3009', commitmentId: id, from: buyer.address, value: total, token, validAfter: epoch, validBefore: t.timing.fundBy, nonce: fundingNonce, expiresAt: t.timing.fundBy, signature: null }, 'submit.body.fund');
  if (charged) same(agree.submit.body.operatorFee, { type: 'TransferAuthorization', scheme: 'erc3009', purpose: 'operator_fee', commitmentId: id, from: buyer.address, to: s.to, value: fee.toString(), token, validAfter: epoch, validBefore: t.timing.fundBy, nonce: operatorFeeNonce, expiresAt: t.timing.fundBy, signature: null }, 'submit.body.operatorFee');
  else if ('operatorFee' in agree.submit.body) fail('submit.body carries an operatorFee while fees.operator gives 0');
  now = await settlementNow();
  const held = await signAndSubmit(agree, buyer, [
    { slot: 'signature', primaryType: 'Agree', message: { commitmentId: id, buyer: buyer.address, nonce: agreeNonce, expiresAt: secs(t.timing.offerExpiresAt) } },
    { slot: 'fund.signature', primaryType: 'ReceiveWithAuthorization', erc3009: true, message: { from: buyer.address, to: DEPLOYMENT.collector, value: total, validAfter: 0, validBefore: fundBy, nonce: fundingNonce } },
    ...(charged ? [{ slot: 'operatorFee.signature', primaryType: 'TransferWithAuthorization', erc3009: true, message: { from: buyer.address, to: s.to, value: fee.toString(), validAfter: 0, validBefore: fundBy, nonce: operatorFeeNonce } }] : []),
  ], now);
  if (held.escrowState !== 'Held' || held.hold?.amount?.amount !== total) fail(`agree answered ${JSON.stringify({ s: held.escrowState, h: held.hold })}`);
  log(`6 agree and fund: /terms agree on both operators, ID recomputed, money addresses the parties' own, Agree and ReceiveWithAuthorization${charged ? ' and TransferWithAuthorization' : ''} rebuilt with the nonces from Encodings, operator fee ${fee}, Held ${total}`);

  // 7. Deliver
  const recipients = [...adjAddresses.map((a, i) => ({ address: a, encryptionPublicKey: regs[i].encryptionPublicKey })), { address: buyer.address, encryptionPublicKey: t.buyerEncryptionPublicKey }];
  const served = (await call('GET', `${api}/v1/commitments/${id}/recipients`)).recipients.map((r) => ({ address: r.address.toLowerCase(), encryptionPublicKey: r.encryptionPublicKey }));
  same(served, recipients, 'the /recipients cross-check');
  const plaintext = Buffer.from('customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n');
  const contentKey = randomBytes(32), iv = randomBytes(12);
  const aes = await webcrypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array([...iv, ...new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plaintext))]);
  const stored = await write('/v1/ciphertext', ct);
  if (stored.id !== sha(ct) || stored.bytes !== ct.length || typeof stored.uri !== 'string') fail(`ciphertext answered ${JSON.stringify(stored)}`);
  const encryptedKeys = recipients.map((r) => {
    const eph = nacl.box.keyPair(), n = randomBytes(24);
    const env = b64(new Uint8Array([...eph.publicKey, ...n, ...nacl.box(contentKey, n, Buffer.from(r.encryptionPublicKey, 'base64url'), eph.secretKey)]));
    if (env.length !== 139) fail('an envelope is 139 characters');
    return { recipient: r.address, scheme: 'x25519-xsalsa20poly1305', ciphertext: env };
  });
  const ciphertext = { uri: stored.uri, sha256: stored.id, bytes: stored.bytes };
  const delivery = await call('POST', `${api}/v1/prepare/delivery`, { commitmentId: id, ciphertext, plaintextSha256: sha(plaintext), encryptedKeys });
  const submittedAt = Number(delivery.sign[0].typedData.message.submittedAt);
  now = await settlementNow();
  const delivered = await signAndSubmit(delivery, seller, [{
    slot: 'signature', primaryType: 'Delivery', near: ['submittedAt'],
    message: { commitmentId: id, attempt: 1, ciphertext: { ...ciphertext, cipher: 'aes-256-gcm' }, plaintextSha256: sha(plaintext), plaintextMime: 'text/csv', encryptedKeys: encryptedKeys.map((k) => ({ ...k, unlock: { kind: '', round: 0 } })), submittedAt },
  }], now);
  log(`7 deliver: recipients cross-checked, ciphertext stored, four envelopes, Delivery rebuilt, answered ${delivered.escrowState}`);

  // 8. Result
  for (let i = 0; i < 150 && !['Released', 'Refunded'].includes((state = await call('GET', `${api}/v1/commitments/${id}`)).escrowState); i++) await wait(200);
  if (state.escrowState !== 'Released') fail(`expected Released, got ${state.escrowState}`);
  // Phase one: the decision is final when it settles: finalAt is the decision's time, and appealState reads none.
  if (typeof state.finalAt !== 'string' || state.appealState !== 'none') fail(`finalAt ${state.finalAt}, appealState ${state.appealState}`);
  const judgment = await call('GET', `${api}/v1/commitments/${id}/judgment`);
  if (judgment.aggregate?.decision !== 'accept' || judgment.deterministic?.length !== 2 || judgment.panel?.ran !== false) fail(`judgment ${JSON.stringify({ a: judgment.aggregate, p: judgment.panel?.ran })}`);
  const key = await call('GET', `${api}/v1/commitments/${id}/key?recipient=${buyer.address}`);
  if (key.items?.length !== 1) fail(`key items ${key.items?.length}`);
  const env = Buffer.from(key.items[0].ciphertext, 'base64url');
  const opened = nacl.box.open(env.subarray(56), env.subarray(32, 56), env.subarray(0, 32), buyer.enc.secretKey);
  if (!opened) fail('the buyer envelope does not open');
  const events = (await call('GET', `${api}/v1/commitments/${id}/events?limit=200`)).items;
  const d = events.find((e) => e.type === 'delivery.submitted')?.payload;
  if (!d?.ciphertext?.uri || !d.plaintextSha256 || !d.ciphertext.sha256) fail('delivery.submitted payload lacks ciphertext.uri, ciphertext.sha256 or plaintextSha256');
  const fetched = new Uint8Array(await (await fetch(d.ciphertext.uri)).arrayBuffer());
  if (sha(fetched) !== d.ciphertext.sha256) fail('the fetched ciphertext hash');
  const dec = await webcrypto.subtle.importKey('raw', opened, 'AES-GCM', false, ['decrypt']);
  const plain = Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: fetched.slice(0, 12) }, dec, fetched.slice(12)));
  if (sha(plain) !== d.plaintextSha256 || !plain.equals(plaintext)) fail('the decrypted work');
  // Section 8: the events that came from the chain name their transaction.
  const txs = events.filter((e) => ['hold.funded', 'delivery.submitted', 'settlement.released'].includes(e.type)).map((e) => e.payload?.tx);
  if (txs.length !== 3 || !txs.every((x) => /^0x[0-9a-f]{64}$/.test(x ?? ''))) fail(`the funding, delivery and release events carry no payload.tx: ${JSON.stringify(txs)}`);
  log(`8 result: Released and final at ${state.finalAt} (appealState none), judgment accept with panel.ran false, buyer opened the work, three transactions named`);
  console.log(`walkthrough PASS (${OP1} and ${OP2})`);
} catch (e) {
  console.error(`walkthrough FAIL: ${e.message}`);
  process.exitCode = 1;
}
