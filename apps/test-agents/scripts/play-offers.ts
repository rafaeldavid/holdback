// Plays the test seller's named offers as an outside buyer would (T-420): fresh keys, test tUSDC from the faucet, a
// sealed proposal naming the offer, the offer checked on both operators against the card, agree and fund, then the
// end state read from every operator. One JSON line per offer: the commitment ID, the final state and the seconds.
// Test tokens only; it holds no secret and signs only for its own fresh buyer key.
//
//   node apps/test-agents/scripts/play-offers.ts [--offer <id>]... [--seller <intake URL>]
//
// Without --offer it plays all four, one after another, with one buyer: one faucet grant (retried while the faucet
// limits this client) pays for every deal. Each deal uses one of the test seller's requests (3 an hour per IP
// address, so a fourth waits for the hour); the judged offers use one panel each of the demo's daily live judge calls.
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from '../../../examples/agent.ts';
import { commitmentIdOf, jcs, knownPins, operatorFeeOf, sealKeyTo } from '../../../examples/verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const args = process.argv.slice(2);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));
const SELLER = opt('--seller')[0] ?? 'https://crow.direct/agents/test-seller';
const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256hex = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex');
const secs = (a: number, b: number) => Math.round((b - a) / 100) / 10;
const get = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = (await r.json().catch(() => null)) as J;
  if (!r.ok) throw new Error(`${url} answered ${r.status}: ${body?.error ?? ''}`);
  return body;
};

async function until(agent: Agent, id: Hex, states: string[], timeoutMs: number): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(2000)) {
    seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api)));
    if (seen.every((s) => states.includes(s.escrowState))) return seen[0];
  }
  throw new Error(`${id} still ${seen.map((s) => s.escrowState).join(' / ')} after ${timeoutMs / 1000} s, waiting for ${states.join(' or ')}`);
}

/** One fresh buyer for the run, funded once by the faucet; a rate-limited grant is retried every 60 s for 30 minutes. */
async function freshBuyer(): Promise<Agent> {
  const reader = new Agent(OPERATORS, generatePrivateKey(), nacl.randomBytes(32));
  const found = await reader.trusted('/.well-known/holdback.json', (x) => ({ domain: x.domain }));
  const pin = knownPins().find((p) => jcs(p.domain).toLowerCase() === jcs(found.domain).toLowerCase());
  if (!pin) throw new Error(`the operators serve EIP-712 domain ${jcs(found.domain)}, which this script does not pin`);
  const buyer = new Agent(OPERATORS, generatePrivateKey(), nacl.randomBytes(32), pin.domain, pin.chain);
  for (const end = Date.now() + 30 * 60_000; ; await sleep(60_000)) {
    try {
      await buyer.call('POST', '/v1/faucet', { address: buyer.address });
      return buyer;
    } catch (e) {
      if (!/rate_limited/.test((e as Error).message) || Date.now() > end) throw e;
      console.error(`the faucet limits this client; trying again in 60 s`);
    }
  }
}

async function play(buyer: Agent, offerId: string): Promise<J> {
  const t0 = Date.now();
  const card = await get(`${SELLER}/agent.json`);
  const offer = card.offers?.find((o: J) => o.id === offerId);
  if (!offer) throw new Error(`the card lists no offer ${offerId}; it lists ${card.offers?.map((o: J) => o.id).join(', ')}`);

  const proposal = { type: 'crow-proposal', buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, offer: offerId, want: offer.ends, budget: { ...offer.terms.price, covers: 'price' }, terms: offer.terms };
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(proposal))))]);
  const stored = await buyer.call('POST', '/v1/ciphertext', ct);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
  const request = { type: 'crow-request', proposal: { uri: stored.uri, sha256: stored.id }, sealedKey: sealKeyTo(key, 'intake', card.intake.encryptionPublicKey).ciphertext, statusTokenHash: await sha256hex(new TextEncoder().encode(token)), from: 'play-offers.ts' };
  const sent = await fetch(card.intake.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  if (!sent.ok) throw new Error(`the intake answered ${sent.status}: ${await sent.text()}`);
  let s: J;
  for (const end = Date.now() + 180_000; ; await sleep(2000)) {
    s = await get(`${card.intake.status}?token=${token}`);
    if (s.status === 'failed') throw new Error(`the test seller failed the request: ${s.detail}`);
    if (s.status === 'offered' && s.commitmentId) break;
    if (Date.now() > end) throw new Error(`no offer within 180 s: ${JSON.stringify(s)}`);
  }
  const id = s.commitmentId as Hex;
  const tOffered = Date.now();

  // Check the offer as a buyer: the same terms on every operator, the published seller, the card's price and acceptance.
  await until(buyer, id, ['AcceptedByAdjudicator'], 120_000);
  const { id: _id, signatures: _s, ...terms } = await buyer.trusted(`/v1/commitments/${id}/terms`); // eslint-disable-line @typescript-eslint/no-unused-vars
  const rubric = offer.terms.template === 'checks-only' ? { criteria: [], passThreshold: 0 } : offer.terms.rubric;
  const checks: Array<[string, J, J]> = [
    ['id', commitmentIdOf(terms), id], ['seller', String(terms.seller).toLowerCase(), String(card.seller).toLowerCase()], ['price', terms.price, offer.terms.price],
    ['deliverable', { kind: terms.deliverable.kind, description: terms.deliverable.description, format: terms.deliverable.format }, offer.terms.deliverable],
    ['acceptance', terms.acceptance, { deterministicChecks: offer.terms.checks, rubric }],
  ];
  for (const [field, got, want] of checks) if (jcs(got).toLowerCase() !== jcs(want).toLowerCase()) throw new Error(`refusing to fund: ${field} is ${jcs(got)}, not the card's ${jcs(want)}`);
  const schedule = await buyer.operatorFeeSchedule();
  const fee = BigInt(terms.adjudication.fee.amount);
  const held = await buyer.agreeAndFund(terms, BigInt(terms.price.amount) + fee + (schedule ? operatorFeeOf(terms.price, schedule) : 0n));
  if (held.escrowState !== 'Held') throw new Error(`funding left ${held.escrowState}, not Held`);
  const tHeld = Date.now();

  const silent = offerId.endsWith('-silent');
  const final = await until(buyer, id, ['Released', 'Refunded'], silent ? 20 * 60_000 : 15 * 60_000);
  const tEnd = Date.now();
  const judgment = silent ? null : await buyer.call('GET', `/v1/commitments/${id}/judgment`).catch(() => null);
  const members: J[] = judgment?.panel?.members ?? [];
  let status: J = {};
  for (const end = Date.now() + 60_000; Date.now() < end; await sleep(3000)) {
    status = await get(`${card.intake.status}?token=${token}`);
    if (['released', 'refunded', 'failed'].includes(status.deal)) break;
  }
  return {
    offer: offerId, commitmentId: id, finalState: final.escrowState, buyer: buyer.address,
    seconds: { requestToOffer: secs(t0, tOffered), offerToHeld: secs(tOffered, tHeld), heldToFinal: secs(tHeld, tEnd), total: secs(t0, tEnd) },
    deliverBy: terms.timing.deliverBy,
    checks: judgment?.deterministic?.map((c: J) => `${c.checkId}:${c.passed ? 'pass' : 'fail'}`) ?? null,
    decision: judgment?.aggregate?.decision ?? null,
    panel: members.length ? { members: members.length, live: members.every((m) => !/^\[fake judge/.test(String(m.verdict?.rationale ?? ''))), verdicts: members.map((m) => m.verdict?.overall) } : null,
    seller: { deal: status.deal, detail: status.detail ?? null, transactions: status.transactions ?? [] },
  };
}

const wanted = opt('--offer');
const card = await get(`${SELLER}/agent.json`);
const ids: string[] = wanted.length ? wanted : card.offers.map((o: J) => o.id);
const buyer = await freshBuyer();
let failed = 0;
for (const offerId of ids) {
  try {
    console.log(JSON.stringify(await play(buyer, offerId)));
  } catch (e) {
    failed++;
    console.log(JSON.stringify({ offer: offerId, error: (e as Error).message }));
  }
}
process.exit(failed ? 1 : 0);
