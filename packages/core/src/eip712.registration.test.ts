// ADR-0030: an adjudicator's self-signed registration. A reader rebuilds the signed message from the served record
// alone, so the record's own fields, its envelope and the body hash rule are what these tests pin.
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { canonicalKeccak } from './canonical.js';
import { encodePublicKey, generateEncryptionKeyPair } from './crypto/index.js';
import { holdbackDomain, registeredBody, registrationBodyHash, registrationMessageOf, signMessage, verifyMessage, verifyRegistration } from './eip712.js';
import { parseAdjudicator, parseMessage } from './parse.js';
import type { AdjudicatorRegistration, Hex32, RegisteredAdjudicator } from './types.js';

const domain = holdbackDomain(31337);
const KEY = `0x${'44'.repeat(32)}` as const;
const adjudicator = privateKeyToAccount(KEY).address.toLowerCase() as `0x${string}`;
const h = (byte: string): Hex32 => `0x${byte.repeat(32)}`;
const tusd = (amount: string) => ({ token: 'tUSD', amount }) as AdjudicatorRegistration['fee']['min'];
const POOL_TERMS = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10000, noticePeriodSec: 0 };
const POLICY: AdjudicatorRegistration['policy'] = {
  id: 'outside/p1',
  panelSize: 3,
  appealPanelSize: 5,
  minFamilies: 2,
  minFamiliesAppeal: 2,
  minValid: 2,
  minValidAppeal: 3,
  acceptSupermajority: { numerator: 2, denominator: 3 },
  rejectSupermajority: { numerator: 2, denominator: 3 },
  judgeTimeoutSec: 60,
  rationaleMaxChars: 600,
  promptTemplateHash: h('0a'),
  appealPromptTemplateHash: h('0b'),
  aggregationVersion: 'agg-1',
  screenVersion: 'screen-1',
  providerPrivacy: 'zdr',
  disclosureMin: 'public',
};

/** A registered record as an adjudicator posts it, envelope unsigned until signed() below. */
function unsigned(): Omit<RegisteredAdjudicator, 'registration'> {
  return {
    address: adjudicator,
    name: 'Outside adjudicator',
    encryptionPublicKey: encodePublicKey(generateEncryptionKeyPair().publicKey),
    affiliations: [],
    policy: POLICY,
    registry: { hash: h('06'), uri: 'https://outside.example/registry.json' },
    policyHash: canonicalKeccak(POLICY),
    fee: { min: tusd('0') },
    status: 'active',
    pool: { terms: POOL_TERMS },
    poolTermsHash: canonicalKeccak(POOL_TERMS),
  };
}

async function signed(record = unsigned(), issuedAt = '2026-11-04T09:00:00Z'): Promise<RegisteredAdjudicator> {
  const envelope = { keyId: 'outside/k1', bodyHash: registrationBodyHash(record), issuedAt, nonce: h('1f'), expiresAt: '2027-11-04T09:00:00Z' };
  const message = registrationMessageOf({ ...record, registration: { ...envelope, signature: '0x' } });
  const { signature: _unused, ...toSign } = message;
  void _unused;
  return { ...record, registration: { ...envelope, signature: await signMessage(KEY, domain, toSign) } };
}

describe('AdjudicatorRegistration (ADR-0030)', () => {
  it('rebuilds the signed message from the record and its envelope', async () => {
    const r = await signed();
    const m = registrationMessageOf(r);
    expect(m).toEqual({
      type: 'AdjudicatorRegistration',
      adjudicator: r.address,
      encryptionPublicKey: r.encryptionPublicKey,
      keyId: 'outside/k1',
      policyHash: r.policyHash,
      registryHash: r.registry.hash,
      fee: r.fee.min,
      poolTermsHash: r.poolTermsHash,
      bodyHash: r.registration.bodyHash,
      issuedAt: '2026-11-04T09:00:00Z',
      nonce: h('1f'),
      expiresAt: '2027-11-04T09:00:00Z',
      signature: r.registration.signature,
    });
    expect(parseMessage(m).ok).toBe(true);
    expect(await verifyMessage(domain, m, adjudicator)).toBe(true);
  });

  it('verifies a served record too: the pool balances, bond and observed fields are not signed', async () => {
    const r = await signed();
    const served = { ...r, pool: { junior: tusd('5'), senior: tusd('0'), reserved: tusd('1'), terms: POOL_TERMS }, bond: {}, observed: {} };
    expect(registrationBodyHash(served)).toBe(r.registration.bodyHash);
    expect(await verifyMessage(domain, registrationMessageOf(served), adjudicator)).toBe(true);
    // The served form validates as an adjudicator record, with its envelope.
    const { bond: _b, observed: _o, ...record } = served;
    void _b;
    void _o;
    expect(parseAdjudicator(record).ok).toBe(true);
  });

  it('binds every field of the record through bodyHash', async () => {
    const base = unsigned();
    const hash = registrationBodyHash(base);
    for (const change of [{ name: 'Someone else' }, { affiliations: ['m-1'] }, { status: 'suspended' as const }, { registry: { ...base.registry, uri: 'https://other.example/r.json' } }]) {
      expect(registrationBodyHash({ ...base, ...change })).not.toBe(hash);
    }
    expect(registeredBody({ ...base, registration: { keyId: 'k' } } as never)).toEqual(base);
  });

  it('verifyRegistration checks the signature and every hash, so an altered body fails though the signature recovers', async () => {
    const r = await signed();
    expect(await verifyRegistration(domain, r)).toBe(true);
    const served = { ...r, pool: { junior: tusd('5'), senior: tusd('0'), reserved: tusd('0'), terms: POOL_TERMS }, observed: { bond: 'bonded' } };
    expect(await verifyRegistration(domain, served)).toBe(true);
    for (const altered of [{ ...r, name: 'Crow (official)' }, { ...r, policy: { ...r.policy, panelSize: 9 } }, { ...r, pool: { terms: { ...POOL_TERMS, noticePeriodSec: 1 } } }]) {
      expect(await verifyRegistration(domain, altered)).toBe(false);
    }
    expect(await verifyRegistration(domain, unsigned() as never)).toBe(false);
  });

  it('does not verify under another domain or with an altered record', async () => {
    const r = await signed();
    expect(await verifyMessage(holdbackDomain(11155111), registrationMessageOf(r), adjudicator)).toBe(false);
    const altered = { ...r, fee: { min: tusd('1') } };
    expect(await verifyMessage(domain, registrationMessageOf(altered), adjudicator)).toBe(false);
  });
});
