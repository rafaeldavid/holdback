// The round's own adjudicators (T-216, How the round runs; T-221 and ADR-0030): an adjudicator any agent could run,
// registered through the public API, bonded from its own key, and run in the driver's process during a scenario. It
// never judges. It is silent (it accepts the deals that name it primary, then never decides: a real offline
// adjudicator) or scripted (it accepts, then decides the outcome the scenario gives it, a wrong one included, once
// the deal is delivered). Like the rest of the driver it uses only agent.ts and verify.ts, so nothing here is beyond
// an outside agent, and it prints addresses and links, never a key.
//
//   const primary = await RoundAdjudicator.ready(r, 'adjudicator-1', { bond: BigInt(PRICE) });
//   const serving = await primary.serve(r, { decide: 'reject' }); // or 'silent'
//   try {
//     const deal = await openDeal(r, { ...spec, adjudicators: { primary: primary.address, fallback, appeal } }, parties);
//     ...
//   } finally {
//     await serving.stop();
//   }
import { concat, keccak256, recoverTypedDataAddress, stringToHex, type Hex } from 'viem';
import type { Agent } from './agent.ts';
import { reason, retry, short, type Run } from './e2e-run.ts';
import { commitmentIdOf, jcs, jcsHash, openEnvelopeKey, sealKeyTo, TYPES, type Domain } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The round's own adjudicator keys (e2e-keys.ts ROLES): each is topped up with Sepolia ETH from the master. */
export const ADJUDICATORS = ['adjudicator-1', 'adjudicator-2', 'adjudicator-3'] as const;
export type AdjudicatorRole = (typeof ADJUDICATORS)[number];

/**
 * What it does with a deal that names it primary: `silent` accepts and never decides; `{ decide }` accepts, then signs
 * that outcome once the deal is delivered. As fallback or appeal adjudicator it is always silent: those turns need a
 * beacon proof (T-217), which a scripted decision does not make.
 */
export type Script = 'silent' | { decide: 'accept' | 'reject' };

/** A serving adjudicator: what it did, the errors of its passes (each retried on the next pass), and how to stop it. */
export interface Serving {
  readonly acted: Array<{ id: Hex; did: 'accepted' | 'decided'; outcome?: 'accept' | 'reject' }>;
  readonly errors: string[];
  stop(): Promise<void>;
}

/** A registration is signed again once fewer than this many days are left before it expires. */
const RENEW_DAYS = 7;
/** How long a new registration lasts. */
const LIFETIME_DAYS = 30;
/** How often a serving adjudicator reads the deals that name it (milliseconds). */
const PASS_MS = 3000;
/** A deal offered this long before `serve` started is still its own (settlement time on two operators may differ). */
const SINCE_MARGIN_MS = 15_000;

const ZERO32: Hex = `0x${'0'.repeat(64)}`;
const secs = (ts: string) => BigInt(Date.parse(ts) / 1000);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const amt = (a: J) => ({ token: a.token, amount: BigInt(a.amount) });
const lc = (a: string) => a.toLowerCase();
/** A sleep that never holds the process open: a scenario that forgets `stop` still lets the driver exit. */
const nap = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * EIP-712 typed data for the three messages an adjudicator signs itself, encoded as core's typedDataOf does: no
 * prepare call builds them (ADR-0030), and verify.ts carries their types but no encoders.
 */
export function adjudicatorTyped(m: J, domain: Domain): J {
  const exp = { nonce: m.nonce, expiresAt: secs(m.expiresAt) };
  const message = (() => {
    switch (m.type) {
      case 'AdjudicatorAcceptance':
        return { commitmentId: m.commitmentId, adjudicator: m.adjudicator, seedCommitment: m.seedCommitment, policyHash: m.policyHash, registryHash: m.registryHash, fee: amt(m.fee), bondReserved: amt(m.bondReserved), ...exp };
      case 'Decision':
        return {
          commitmentId: m.commitmentId, attempt: m.attempt, deliveryHash: m.deliveryHash, adjudicator: m.adjudicator, role: m.role, outcome: m.outcome, seed: m.seed, policyHash: m.policyHash, registryHash: m.registryHash,
          judgmentRecordHash: m.judgmentRecordHash, keyForBuyer: m.keyForBuyer ?? { scheme: '', ciphertext: '' }, appealGround: m.appealGround ?? '',
          // Absent encodes as an empty source and an empty list, as core does.
          beacon: m.beacon ? { ...m.beacon, round: BigInt(m.beacon.round), signature: m.beacon.signature ?? '0x' } : { source: '', round: 0n, value: ZERO32, signature: '0x' },
          encryptedKeys: (m.encryptedKeys ?? []).map((k: J) => ({ recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext, unlock: k.unlock ? { kind: k.unlock.kind, round: BigInt(k.unlock.round ?? 0) } : { kind: '', round: 0n } })),
          ...exp,
        };
      case 'AdjudicatorRegistration':
        return { adjudicator: m.adjudicator, encryptionPublicKey: m.encryptionPublicKey, keyId: m.keyId, policyHash: m.policyHash, registryHash: m.registryHash, fee: amt(m.fee), poolTermsHash: m.poolTermsHash, bodyHash: m.bodyHash, issuedAt: secs(m.issuedAt), ...exp };
    }
    throw new RangeError(`an adjudicator signs no ${m.type} here`);
  })();
  return { domain, types: TYPES, primaryType: m.type, message };
}

/** The record as `registration.bodyHash` binds it: without the envelope, the node's `bond` and `observed`, and `pool` holding only `terms`. */
export function bodyOf(record: J): J {
  const { registration: _r, bond: _b, observed: _o, ...body } = record; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...body, pool: { terms: record.pool.terms } };
}

/** The AdjudicatorRegistration a record's envelope signs, rebuilt from the record alone (core's registrationMessageOf). */
export function registrationMessageOf(record: J): J {
  const e = record.registration;
  return { type: 'AdjudicatorRegistration', adjudicator: record.address, encryptionPublicKey: record.encryptionPublicKey, keyId: e.keyId, policyHash: record.policyHash, registryHash: record.registry.hash, fee: record.fee.min, poolTermsHash: record.poolTermsHash, bodyHash: e.bodyHash, issuedAt: e.issuedAt, nonce: e.nonce, expiresAt: e.expiresAt };
}

/**
 * The record a round adjudicator registers (T-216 Handoff, T-221's recipe): a demo adjudicator's served record with
 * its own address, encryption key, name and policy id. So it binds the demo's registry hash, a policy with this build's
 * template hashes and at least the demo's fee, and the demo's fallback and appeal adjudicators judge for it.
 */
export function recordFor(demo: J, me: { address: string; encryptionPublicKey: string; role: AdjudicatorRole }): J {
  const policy = { ...demo.policy, id: `t-216/${me.role}` };
  return {
    address: lc(me.address), name: `Round 1 test adjudicator (${me.role})`, encryptionPublicKey: me.encryptionPublicKey, affiliations: [],
    policy, registry: demo.registry, policyHash: jcsHash(policy), fee: demo.fee, status: 'active', pool: { terms: demo.pool.terms }, poolTermsHash: jcsHash(demo.pool.terms),
  };
}

export class RoundAdjudicator {
  readonly role: AdjudicatorRole;
  readonly agent: Agent;

  private constructor(r: Run, role: AdjudicatorRole) {
    this.role = role;
    this.agent = r.round.agent(role);
  }

  get address(): string {
    return this.agent.address;
  }

  /**
   * The round's adjudicator under `role`, registered through the API and, given `bond`, holding at least that much free
   * bond in HoldbackBonds. Both are reused when already in place, so every run after the first sends nothing.
   */
  static async ready(r: Run, role: AdjudicatorRole, o: { bond?: bigint } = {}): Promise<RoundAdjudicator> {
    const a = new RoundAdjudicator(r, role);
    await a.register(r);
    if (o.bond !== undefined) await a.bond(r, o.bond);
    return a;
  }

  /**
   * Its registration as both operators serve it (the signed body and envelope; each node's own `bond` and `observed`
   * may differ, so they are left out), or null when neither serves one.
   */
  async served(): Promise<J | null> {
    try {
      return await retry(() => this.agent.trusted(`/v1/adjudicators/${this.address}`, (x) => ({ ...bodyOf(x), registration: x.registration })));
    } catch (e) {
      if (/not_found/.test(String((e as Error).message))) return null;
      throw e;
    }
  }

  /**
   * Registers through `POST /v1/adjudicators` (ADR-0030), unless both operators already serve a registration with the
   * same body, signed by this key, with more than a week left: that one is reused and nothing is posted.
   */
  async register(r: Run): Promise<'registered' | 'reused'> {
    const demo = await retry(() => this.agent.trusted(`/v1/adjudicators/${r.round.demo.adjudicators.primary}`, (x) => ({ policy: x.policy, registry: x.registry, fee: x.fee, pool: { terms: x.pool.terms } })));
    const body = recordFor(demo, { address: this.address, encryptionPublicKey: this.agent.encryptionPublicKey, role: this.role });
    const [served, now] = await Promise.all([this.served(), retry(() => this.agent.settlementNow())]);
    if (served && (await this.reusable(served, body, now))) {
      r.say(`${this.role} ${short(this.address)}: its registration is in place (policy ${body.policy.id}, issued ${served.registration.issuedAt}); reused`);
      return 'reused';
    }
    // A replacement needs a later issuedAt than the one served (409 otherwise).
    const issuedMs = Math.max(Math.floor(now / 1000) * 1000, served ? Date.parse(served.registration.issuedAt) + 1000 : 0);
    const issuedAt = iso(issuedMs);
    const envelope = { keyId: `t-216/${this.role}/${issuedAt}`, bodyHash: jcsHash(body), issuedAt, nonce: keccak256(concat([this.address as Hex, stringToHex(`holdback/e2e/registration/${issuedAt}`)])), expiresAt: iso(issuedMs + LIFETIME_DAYS * 86_400_000) };
    const message = registrationMessageOf({ ...body, registration: envelope });
    const record = { ...body, registration: { ...envelope, signature: await this.agent.account.signTypedData(adjudicatorTyped(message, this.agent.domain)) } };
    await this.agent.call('POST', '/v1/adjudicators', record);
    // Both operators serve it before any offer names it.
    for (let tries = 0; ; tries++) {
      const now2 = await this.served().catch(() => null);
      if (lc(now2?.registration?.signature ?? '') === lc(record.registration.signature)) break;
      if (tries === 30) throw new Error(`${this.role} ${this.address}: the operators do not both serve the registration it posted`);
      await nap(1000);
    }
    r.say(`${this.role} ${short(this.address)}: registered through the API, policy ${body.policy.id} with the demo's registry ${short(body.registry.hash)} and fee ${r.round.amount(body.fee.min.amount)}, until ${envelope.expiresAt}`);
    return 'registered';
  }

  /** The served registration has this body, recomputes, is signed by this key, and has more than RENEW_DAYS left. */
  private async reusable(served: J, body: J, nowMs: number): Promise<boolean> {
    const e = served.registration;
    if (!e?.signature || jcs(bodyOf(served)) !== jcs(body) || e.bodyHash !== jcsHash(body)) return false;
    if (Date.parse(e.expiresAt) - nowMs < RENEW_DAYS * 86_400_000) return false;
    const signer = await recoverTypedDataAddress({ ...adjudicatorTyped(registrationMessageOf(served), this.agent.domain), signature: e.signature }).catch(() => null);
    return lc(signer ?? '') === this.address;
  }

  /**
   * At least `amount` of free bond in HoldbackBonds, deposited from this key (HoldbackBonds bonds the sender): the
   * shortfall alone, minted first when the key holds too few test tokens (tUSDC is open-mint), paid from its own
   * Sepolia ETH. Reused when the free bond already covers it. Waits until both operators serve the bond, since a relay
   * refuses terms whose fallback shows less free bond than the price (T-221).
   */
  async bond(r: Run, amount: bigint): Promise<'deposited' | 'reused'> {
    const { round } = r;
    const chain = round.chain;
    if (!chain) throw new Error(`SimChain: the round's ${this.role} cannot bond at run time (T-221 left a run-time deposit out), so it can be an appeal adjudicator here but not a bonded primary or fallback; run this on anvil or Sepolia`);
    // Never before the round's own last transaction: a node behind it would show the bond from before an earlier deposit.
    const held = (await chain.holdings([this.address], await chain.fresh()))[this.address]!;
    if (BigInt(held.free) >= amount) {
      r.say(`${this.role} ${short(this.address)}: free bond ${round.amount(held.free)} covers ${round.amount(amount)}; reused`);
      return 'reused';
    }
    const need = amount - BigInt(held.free);
    const key = round.key(this.role);
    if (BigInt(held.token) < need) {
      const minted = await chain.mint(key, this.address, need - BigInt(held.token));
      r.note(`${this.role} ${short(this.address)} minted ${round.amount(need - BigInt(held.token))} for its bond: ${chain.link(minted.tx)} (${minted.gasUsed} gas)`);
    }
    const [approved, deposited] = await chain.depositBond(key, need);
    r.note(`${this.role} ${short(this.address)} bonded ${round.amount(need)} in HoldbackBonds from its own key: approve ${chain.link(approved!.tx)} (${approved!.gasUsed} gas), deposit ${chain.link(deposited!.tx)} (${deposited!.gasUsed} gas)`);
    // Each node reads the bond through its own cache (about 12 s), so each must show it.
    const free = (x: J) => (x?.pool?.junior ? BigInt(x.pool.junior.amount) + BigInt(x.pool.senior?.amount ?? '0') - BigInt(x.pool.reserved?.amount ?? '0') : -1n);
    for (let tries = 0; ; tries++) {
      const views = await Promise.all(this.agent.sources().map((api) => this.agent.call('GET', `/v1/adjudicators/${this.address}`, undefined, api).catch(() => null)));
      if (views.every((v) => free(v) >= amount)) break;
      if (tries === 60) throw new Error(`${this.role} ${this.address}: the operators do not serve its ${round.amount(amount)} bond 60 s after the deposit`);
      await nap(1000);
    }
    return 'deposited';
  }

  /** The seed it commits to at acceptance and reveals in its decision: from its own key and the commitment ID. */
  private seedOf(r: Run, id: Hex): Hex {
    return keccak256(concat([r.round.key(this.role), id, stringToHex('holdback/e2e/seed')]));
  }

  /** The terms as both operators serve them, checked to hash to `id`. */
  async terms(id: Hex): Promise<J> {
    const { id: _id, signatures: _s, adjudicatorAcceptance: _a, ...terms } = await retry(() => this.agent.trusted(`/v1/commitments/${id}/terms`)); // eslint-disable-line @typescript-eslint/no-unused-vars
    if (commitmentIdOf(terms) !== id) throw new Error(`the terms the operators serve for ${short(id)} do not hash to it`);
    return terms;
  }

  /** Accepts a deal as its primary: an AdjudicatorAcceptance it builds and signs itself, reserving the price from its bond. */
  async accept(r: Run, id: Hex, terms: J): Promise<void> {
    const a = terms.adjudication;
    const m = {
      type: 'AdjudicatorAcceptance', commitmentId: id, adjudicator: this.address, seedCommitment: keccak256(this.seedOf(r, id)), policyHash: a.policyHash, registryHash: a.registryHash,
      fee: a.fee, bondReserved: terms.price, nonce: keccak256(concat([id, stringToHex('holdback/e2e/acceptance')])), expiresAt: terms.timing.offerExpiresAt,
    };
    const signature = await this.agent.account.signTypedData(adjudicatorTyped(m, this.agent.domain));
    await this.agent.call('POST', `/v1/commitments/${id}/acceptance`, { ...m, signature });
    r.say(`${this.role} ${short(this.address)} accepted ${short(id)} as primary`);
  }

  /**
   * Decides a delivered deal as its primary, by script: `outcome` whatever the work. An accept seals the content key
   * from its own envelope to the buyer, as settlement requires; a reject carries none. The decision names the delivery
   * both operators serve, and a hash of what it decided by, since no record is published.
   */
  async decide(r: Run, id: Hex, terms: J, outcome: 'accept' | 'reject'): Promise<void> {
    const posted = await retry(() => this.agent.trusted(`/v1/commitments/${id}`, (x) => ({ attempt: x.attempt, deliveryHash: x.deliveryHash ?? null })));
    if (!posted.deliveryHash) throw new Error(`${short(id)} has no posted delivery on both operators yet`);
    let keyForBuyer: J;
    if (outcome === 'accept') {
      const { items } = await retry(() => this.agent.call('GET', `/v1/commitments/${id}/key?recipient=${this.address}`));
      const sealed = sealKeyTo(openEnvelopeKey(items, this.address, this.agent.encryptionSecretKey), terms.buyer, terms.buyerEncryptionPublicKey);
      keyForBuyer = { scheme: sealed.scheme, ciphertext: sealed.ciphertext };
    }
    const a = terms.adjudication;
    const m = {
      type: 'Decision', commitmentId: id, attempt: posted.attempt, deliveryHash: posted.deliveryHash, adjudicator: this.address, role: 'primary', outcome, seed: this.seedOf(r, id),
      policyHash: a.policyHash, registryHash: a.registryHash, judgmentRecordHash: jcsHash({ commitmentId: id, adjudicator: this.address, outcome, by: 'script (T-216 round 1): no judge ran' }),
      ...(keyForBuyer ? { keyForBuyer } : {}), nonce: keccak256(concat([id, stringToHex('holdback/e2e/decision')])), expiresAt: terms.timing.judgeBy,
    };
    const signature = await this.agent.account.signTypedData(adjudicatorTyped(m, this.agent.domain));
    await this.agent.call('POST', `/v1/commitments/${id}/decisions`, { ...m, signature });
    r.say(`${this.role} ${short(this.address)} decided ${short(id)} by script: ${outcome}`);
  }

  /**
   * Serves in the driver's process until `stop`: every few seconds it reads the deals that name it, and for each one
   * between the round's buyer and seller, offered since `serve` started, that names it primary, it accepts while the
   * offer is open, then follows `script` once the deal is delivered (a function picks a script per deal). Deals from
   * earlier runs and anyone else's deals are left alone. Stop it in a `finally`, so a stopped scenario leaves nothing
   * deciding.
   */
  async serve(r: Run, script: Script | ((deal: { id: Hex; terms: J }) => Script)): Promise<Serving> {
    const since = (await retry(() => this.agent.settlementNow())) - SINCE_MARGIN_MS;
    const acted: Serving['acted'] = [];
    const errors: string[] = [];
    const terms = new Map<Hex, J | null>();
    const done = new Set<string>();
    const lastError = new Map<Hex, string>();
    let stopped = false;
    const pass = async () => {
      const views: J[] = [];
      let cursor: string | null = null;
      do {
        const page: J = await retry(() => this.agent.call('GET', `/v1/commitments?party=${this.address}&role=adjudicator&escrowState=Offered&escrowState=Delivered&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
        views.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      for (const v of views) {
        if (stopped) return;
        const id = v.commitmentId as Hex;
        try {
          if (!terms.has(id)) {
            const t = await this.terms(id);
            // Only its own deals of this scenario: primary here, between the round's buyer and seller, offered since serve
            // started. Its address is public through its registration, so a stranger's deal may name it too.
            const ours = lc(t.buyer) === lc(r.round.address('buyer')) && lc(t.seller) === lc(r.round.address('seller'));
            terms.set(id, lc(t.adjudication.adjudicator) === this.address && ours && Date.parse(t.createdAt) >= since ? t : null);
          }
          const t = terms.get(id);
          if (!t) continue;
          const s = typeof script === 'function' ? script({ id, terms: t }) : script;
          const now = Date.now();
          if (v.escrowState === 'Offered' && !done.has(`${id}/accepted`) && now < Date.parse(t.timing.offerExpiresAt)) {
            await this.accept(r, id, t);
            done.add(`${id}/accepted`);
            acted.push({ id, did: 'accepted' });
          } else if (v.escrowState === 'Delivered' && s !== 'silent' && !done.has(`${id}/decided`) && now < Date.parse(t.timing.judgeBy)) {
            await this.decide(r, id, t, s.decide);
            done.add(`${id}/decided`);
            acted.push({ id, did: 'decided', outcome: s.decide });
          }
        } catch (e) {
          const why = reason(e);
          if (lastError.get(id) !== why) {
            lastError.set(id, why);
            errors.push(`${short(id)}: ${why}`);
            r.say(`${this.role} ${short(this.address)} on ${short(id)}: ${why}; trying again on its next pass`);
          }
        }
      }
    };
    const loop = (async () => {
      while (!stopped) {
        await pass().catch((e) => {
          errors.push(reason(e));
          r.say(`${this.role} ${short(this.address)}: ${reason(e)}; trying again on its next pass`);
        });
        for (let waited = 0; waited < PASS_MS && !stopped; waited += 250) await nap(250);
      }
    })();
    r.say(`${this.role} ${short(this.address)} serves as ${typeof script === 'function' ? 'scripted per deal' : script === 'silent' ? 'silent: it accepts and never decides' : `scripted: it accepts, then decides ${script.decide}`}`);
    return {
      acted,
      errors,
      // The loop's naps never hold the process open, so when `stop` is the driver's last pending work, Node would exit
      // with the stop unsettled and the scenario's record unwritten. A timer of its own holds the process until the
      // loop has ended (measured by three scenario groups, 2026-11-05).
      stop: async () => {
        stopped = true;
        const hold = setInterval(() => undefined, 1000);
        try {
          await loop;
        } finally {
          clearInterval(hold);
        }
      },
    };
  }
}
