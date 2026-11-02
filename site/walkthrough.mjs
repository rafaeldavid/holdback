// Runs one checks-only deal by following site/llms.txt literally, with no Holdback code: plain fetch, viem and
// tweetnacl, its own EIP-712 types (parsed from llms.txt itself) and its own message builders. If the docs are
// wrong about a field, an encoding or a shape, this fails where they are wrong.
//
//   node site/walkthrough.mjs                    in-process sim (apps/operator, built); POST <sim>/accounts stands
//                                                in for the faucet, since a local sim has none
//   OP1=https://… OP2=https://… node site/walkthrough.mjs
//                                                the deployed demo: fresh keys, funded by POST /v1/faucet
//
// Exits 0 with a one-line summary per step, or 1 at the first difference.
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';

const here = (p) => new URL(p, import.meta.url);
const { hashStruct, hashTypedData, keccak256, toBytes } = await import(here('../examples/node_modules/viem/_esm/index.js'));
const { generatePrivateKey, privateKeyToAccount } = await import(here('../examples/node_modules/viem/_esm/accounts/index.js'));
const nacl = (await import(here('../examples/node_modules/tweetnacl/nacl-fast.js'))).default;

const docs = readFileSync(here('llms.txt'), 'utf8');
const block = (after) => {
  const at = docs.indexOf(after);
  const start = docs.indexOf('```json\n', at) + 8;
  return JSON.parse(docs.slice(start, docs.indexOf('\n```', start)));
};
const TYPES = block('## EIP-712 types');
const DOMAIN = block('Pin this EIP-712 domain');

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

// ---- the operators ----------------------------------------------------------------------------------------
let OP1 = process.env.OP1, OP2 = process.env.OP2, world = null, simUrl = null, api = '';
if (!OP1 || !OP2) {
  const { startSimWorld } = await import(here('../apps/operator/dist/sim-world.js'));
  world = await startSimWorld({ port: 0, operatorPorts: [0, 0], publishSecrets: false, onError: () => {} });
  [OP1, OP2] = world.operators.map((o) => o.url);
  simUrl = world.url;
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
  // ---- 1. keys ------------------------------------------------------------------------------------------
  const party = async (label) => {
    if (simUrl) {
      const a = await call('POST', `${simUrl}/accounts`);
      return { label, account: privateKeyToAccount(a.privateKey), enc: nacl.box.keyPair.fromSecretKey(Buffer.from(a.encryptionSecretKey, 'base64url')) };
    }
    return { label, account: privateKeyToAccount(generatePrivateKey()), enc: nacl.box.keyPair() };
  };
  const seller = await party('seller'), buyer = await party('buyer');
  for (const p of [seller, buyer]) {
    p.address = p.account.address.toLowerCase();
    p.encPub = b64(p.enc.publicKey);
    if (p.encPub.length !== 43) fail('an encryption public key is 43 base64url characters');
  }
  log('1 keys: a signing key and an encryption key per party');

  // ---- 2. discovery, faucet, adjudicator ----------------------------------------------------------------
  const wk = await call('GET', `${OP1}/.well-known/holdback.json`);
  for (const k of ['apiBaseUrl', 'domain', 'receiptSigner', 'settlementTime']) if (!(k in wk)) fail(`well-known has no ${k}`);
  same(wk.domain, DOMAIN, 'the pinned domain');
  api = wk.apiBaseUrl.replace(/\/+$/, '');
  let clubId;
  if (simUrl) {
    clubId = (await call('GET', `${simUrl}/`)).clubId;
  } else {
    for (const p of [seller, buyer]) {
      const f = await write('/v1/faucet', { address: p.address });
      if (!f.clubId || !f.balance?.amount) fail(`faucet response ${JSON.stringify(f)} has no clubId or balance`);
      clubId = f.clubId;
    }
  }
  const bal = await call('GET', `${api}/v1/balances/${buyer.address}`);
  if (bal.token !== 'tUSD' || !/^[0-9]+$/.test(bal.amount) || bal.amount === '0') fail(`balance ${JSON.stringify(bal)}`);
  const listed = await call('GET', `${api}/v1/adjudicators`);
  if (!Array.isArray(listed.items) || !listed.items.length) fail('GET /v1/adjudicators lists no items');
  // The deployed demo lists them by role in discovery's demo object (T-030); a local sim in its own GET /.
  const byRole = simUrl ? (await call('GET', `${simUrl}/`)).adjudicators : (await call('GET', `${OP1}/.well-known/holdback.json`)).demo?.adjudicators ?? [];
  const adjAddresses = ['primary', 'fallback', 'appeal'].map((role) => byRole.find((a) => a.role === role)?.address.toLowerCase() ?? fail(`discovery lists no ${role} adjudicator`));
  for (const a of adjAddresses) if (!listed.items.some((x) => x.address.toLowerCase() === a)) fail(`adjudicator ${a} is not in GET /v1/adjudicators`);
  log(`2 discovery: domain pinned, club ${clubId}, buyer holds ${bal.amount} tUSD base units, ${listed.items.length} adjudicator(s) listed`);

  // ---- 3. what we bind to -------------------------------------------------------------------------------
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

  // ---- 4. the loop --------------------------------------------------------------------------------------
  const ints = (type, v) =>
    type.endsWith('[]') ? v.map((x) => ints(type.slice(0, -2), x)) : TYPES[type] ? Object.fromEntries(TYPES[type].map((f) => [f.name, ints(f.type, v[f.name])])) : /^u?int\d*$/.test(type) ? BigInt(v) : typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v) ? v.toLowerCase() : v;
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
  /** Verify a prepared answer against our own messages; sign our typed data into the body; submit. */
  const signAndSubmit = async (prepared, me, mine, now) => {
    if (prepared.sign.length !== mine.length) fail(`expected ${mine.length} slot(s), got ${prepared.sign.length}`);
    const body = structuredClone(prepared.submit.body);
    for (const [i, want] of mine.entries()) {
      const got = prepared.sign[i];
      if (got.slot !== want.slot || got.typedData.primaryType !== want.primaryType || got.signer.toLowerCase() !== me.address) fail(`slot ${i} is ${got.slot}/${got.typedData.primaryType}`);
      same(got.typedData.domain, DOMAIN, 'the typed-data domain');
      const theirTypes = { ...got.typedData.types };
      delete theirTypes.EIP712Domain;
      same(theirTypes, typesFor(want.primaryType), `the ${want.primaryType} types`);
      const message = ints(want.primaryType, want.message);
      same(ints(want.primaryType, got.typedData.message), message, `the ${want.primaryType} message`);
      for (const k of want.near ?? []) {
        const d = Number(message[k]) * 1000 - now;
        if (d < -600_000 || d > 60_000) fail(`${k} is not near settlement time`);
      }
      const typed = { domain: DOMAIN, types: typesFor(want.primaryType), primaryType: want.primaryType, message };
      if (hashTypedData(typed) !== got.digest) fail(`our ${want.primaryType} digest differs from the operator's`);
      const sig = await me.account.signTypedData(typed);
      const keys = want.slot.split('.');
      keys.slice(0, -1).reduce((o, k) => o[k], body)[keys.at(-1)] = sig;
    }
    return write(prepared.submit.path, body);
  };

  // ---- 5. offer -----------------------------------------------------------------------------------------
  const checks = [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  ];
  const deliverable = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
  const price = { token: 'tUSD', amount: '25000000' };
  const offerNonce = nonce();
  // The docs' timing (60-second windows, the demo club's minimum); the local sim's club requires 300.
  const w = simUrl ? 300 : 60;
  const timing = { judgeWithinSec: w, fallbackWithinSec: w, appealWindowSec: w, appealDecideSec: w };
  if (!simUrl) same(JSON.parse(/^ {2}"timing": (\{.*\})$/m.exec(docs)?.[1] ?? 'null'), timing, 'the timing in the offer example');
  const offerReq = {
    nonce: offerNonce, disclosure: 'public', template: 'checks-only', clubId, seller: seller.address, buyer: { address: buyer.address, encryptionPublicKey: buyer.encPub },
    adjudicators: { primary: adjAddresses[0], fallback: adjAddresses[1], appeal: adjAddresses[2] }, price, deliverable, checks, timing,
  };
  const offer = await call('POST', `${api}/v1/prepare/offer`, offerReq);
  if (offer.submit.path !== '/v1/commitments' || offer.sign[0]?.slot !== 'signatures.seller') fail('offer slot or path');
  let now = await settlementNow();
  const m = offer.sign[0].typedData.message, createdAt = Number(m.createdAt), reg = regs[0];
  const termsMsg = {
    schemaVersion: '0.6', clubId, rulebookHash: club.rulebookHash, buyer: buyer.address, seller: seller.address,
    deliverableHash: jcsHash(deliverable), acceptanceHash: jcsHash({ deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } }), price,
    adjudication: { adjudicator: adjAddresses[0], fallbackAdjudicator: adjAddresses[1], appealAdjudicator: adjAddresses[2], policyId: reg.policy.id, fee: reg.fee.min, registryHash: reg.registry.hash, policyHash: reg.policyHash },
    timing: { offerExpiresAt: createdAt + 900, fundBy: createdAt + 1800, deliverBy: createdAt + 86400, judgeBy: createdAt + 86400 + w, fallbackBy: createdAt + 86400 + 2 * w, appealWindowSec: w, appealDecideSec: w, maxSubmissions: 1, disputeBy: 0, disputeJudgeSec: 0, disputeFallbackSec: 0 },
    settlement: { mode: 'guaranteed_on_decision', token: 'tUSD' }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
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

  // ---- 6. agree and fund --------------------------------------------------------------------------------
  const signedOffer = await both(`/v1/commitments/${id}/terms`);
  if (signedOffer.id !== id || signedOffer.buyerEncryptionPublicKey !== buyer.encPub || jcs(signedOffer.price) !== jcs(price)) fail('the terms read back differ');
  const t = signedOffer;
  const recomputed = hashStruct({
    types: TYPES, primaryType: 'CommitmentTerms',
    data: ints('CommitmentTerms', { ...t, deliverableHash: jcsHash(t.deliverable), acceptanceHash: jcsHash(t.acceptance), createdAt: secs(t.createdAt), timing: { ...Object.fromEntries(['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy'].map((k) => [k, secs(t.timing[k])])), appealWindowSec: t.timing.appealWindowSec, appealDecideSec: t.timing.appealDecideSec, maxSubmissions: t.timing.maxSubmissions, disputeBy: 0, disputeJudgeSec: 0, disputeFallbackSec: 0 } }),
  });
  if (recomputed !== id) fail('the commitment ID recomputed from /terms differs');
  const agreeNonce = nonce(), fundingNonce = nonce();
  const agree = await call('POST', `${api}/v1/prepare/agree-and-fund`, { commitmentId: id, agreeNonce, fundingNonce });
  const total = (BigInt(price.amount) + BigInt(t.adjudication.fee.amount)).toString();
  now = await settlementNow();
  const held = await signAndSubmit(agree, buyer, [
    { slot: 'signature', primaryType: 'Agree', message: { commitmentId: id, buyer: buyer.address, nonce: agreeNonce, expiresAt: secs(t.timing.offerExpiresAt) } },
    { slot: 'fund.signature', primaryType: 'FundingAuthorization', message: { scheme: 'erc3009', commitmentId: id, from: buyer.address, value: total, token: 'tUSD', validAfter: secs(t.createdAt), validBefore: secs(t.timing.fundBy), nonce: fundingNonce, expiresAt: secs(t.timing.fundBy) } },
  ], now);
  if (held.escrowState !== 'Held' || held.hold?.amount?.amount !== total) fail(`agree answered ${JSON.stringify({ s: held.escrowState, h: held.hold })}`);
  log(`6 agree and fund: /terms agree on both operators, ID recomputed, Agree and FundingAuthorization rebuilt, Held ${total}`);

  // ---- 7. deliver ---------------------------------------------------------------------------------------
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

  // ---- 8. result ----------------------------------------------------------------------------------------
  for (let i = 0; i < 150 && !['Released', 'Refunded'].includes((state = await call('GET', `${api}/v1/commitments/${id}`)).escrowState); i++) await wait(200);
  if (state.escrowState !== 'Released') fail(`expected Released, got ${state.escrowState}`);
  if (state.finalAt !== null || typeof state.deadlines?.appealBy !== 'string') fail(`finalAt ${state.finalAt}, appealBy ${state.deadlines?.appealBy}`);
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
  log(`8 result: Released, finalAt null until ${state.deadlines.appealBy}, judgment accept with panel.ran false, buyer opened the work`);
  if (!simUrl) {
    // Live: the commitment turns final on its own once the appeal window closes.
    const until = Date.parse(state.deadlines.appealBy) + 60_000;
    while ((state = await call('GET', `${api}/v1/commitments/${id}`)).finalAt === null && Date.now() < until) await wait(5000);
    if (state.finalAt === null) fail(`not final a minute after appealBy ${state.deadlines.appealBy}`);
    log(`8 final: finalAt ${state.finalAt}, escrowState ${state.escrowState}`);
  }
  console.log(`walkthrough PASS (${simUrl ? 'in-process sim; /accounts stood in for the faucet' : `live ${OP1} and ${OP2}`})`);
} catch (e) {
  console.error(`walkthrough FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  await world?.close();
}
