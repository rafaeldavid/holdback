// The cross-language vectors `contracts/test/unit/Vectors.t.sol` pins, computed here by core from spec/examples with
// every token identifier set to the address 0x…beef (ADR-0025). The contract must rebuild each value from the
// settlement view; this file is the generator, so a change to the signed encoding moves both pins together.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { commitmentId, deliveryHash, holdbackDomain, messageDigest, termsDigest, type UnsignedMessage } from './eip712.js';
import { panelSeed } from './state.js';
import type { Address, CommitmentTerms, Delivery, Hex32 } from './types.js';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, 'spec', 'examples', `${name}.example.json`), 'utf8')) as Record<string, unknown>;

const TOKEN = '0x000000000000000000000000000000000000beef';
/** The vectors' verifying contract; Vectors.t.sol deploys HoldbackRules there. */
const VERIFYING: Address = '0x00000000000000000000000000000000000000a1';
const domain = holdbackDomain(31337, VERIFYING);
const fill = (byte: string): Hex32 => `0x${byte.repeat(32)}`;

/** Every token identifier in a JSON value replaced by the vectors' token address. */
function rebind<T>(v: T): T {
  if (Array.isArray(v)) return v.map(rebind) as T;
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'token' ? TOKEN : rebind(x)])) as T;
  return v;
}

const c = rebind(example('commitment'));
delete c['id'];
delete c['signatures'];
delete c['adjudicatorAcceptance'];
const terms = c as unknown as CommitmentTerms;
const id = commitmentId(terms);
const delivery = { ...(example('delivery') as unknown as Delivery), commitmentId: id };
const dh = deliveryHash(delivery);
const msg = (name: string, over: Record<string, unknown>): UnsignedMessage => {
  const m = rebind(example(name));
  delete m['signature'];
  delete m['buyerSignature'];
  delete m['sellerSignature'];
  return { ...m, ...over } as unknown as UnsignedMessage;
};

const values: Record<string, Hex32> = {
  commitmentId: id,
  schemaVersionHash: keccak256(new TextEncoder().encode(terms.schemaVersion)),
  termsDigest: termsDigest(domain, terms),
  deliveryHash: dh,
  decisionDigest: messageDigest(domain, msg('messages.decision', { commitmentId: id, deliveryHash: dh })),
  acceptanceDigest: messageDigest(domain, msg('messages.acceptance', { commitmentId: id })),
  agreeDigest: messageDigest(domain, { type: 'Agree', commitmentId: id, buyer: terms.buyer, nonce: fill('11'), expiresAt: terms.timing.offerExpiresAt }),
  earlyAcceptDigest: messageDigest(domain, {
    type: 'EarlyAccept',
    commitmentId: id,
    buyer: terms.buyer,
    attempt: 1,
    deliveryHash: dh,
    nonce: fill('22'),
    expiresAt: terms.timing.deliverBy,
  }),
  mutualDigest: messageDigest(domain, msg('messages.mutual-settlement', { commitmentId: id })),
  appealDigest: messageDigest(domain, { ...msg('appeal', { commitmentId: id }), type: 'Appeal' } as UnsignedMessage),
  panelSeed: panelSeed(id, 'fallback', 1, fill('33')),
};

// The same values as Vectors.t.sol. Changing one changes the signed encoding: it needs an ADR (ADR-0029 moved them).
const pins: Record<string, Hex32> = {
  commitmentId: '0xaa5d018d99b55e9a09c1cd916d6e3185e52b9b0286b174c292567c991f8b923f',
  schemaVersionHash: '0x15e7a716d821b9602c70f6d0f574efbb8147fb465215d43354c7b3e69d03ed92',
  termsDigest: '0x2bb88f88c30641ab49ab6823d4cf2e692d1772f9137f681191123f4c19b46724',
  deliveryHash: '0x066268f079f4bb4793fabf3fa8dd9747532bd69048bc3ff099f83b74799f04f8',
  decisionDigest: '0x64343a2c8fff8bf7562a10e502a2fad78cda9674368b1c7cb4a893c8fd5459e1',
  acceptanceDigest: '0x816923467536d8459e2cb690cea9439b7a31fa2cb9dfcd6ca0c62240c4d6e1c0',
  agreeDigest: '0x5970a7aa087444ecfc533eb1c1bbfff3fe736922db3208b37707fb5c402b022b',
  earlyAcceptDigest: '0x797d9eab50f3743a32aa900fb6d1652d486b9a7a117032288d8644ff5965fc58',
  mutualDigest: '0x7a435893e73e059cbc988c3e29754dc13c95c14f9067cdd8bf22df53cea02aa5',
  appealDigest: '0x55838aa7f5437ab2dc68d37668acc76eaa26bedfefa0ffd24fd517c55e7a4744',
  panelSeed: '0x49566397618363247d353cc28e612aaceecc13dbbf17727b21034147547af0ad',
};

describe('cross-language vectors (Vectors.t.sol)', () => {
  it.each(Object.keys(pins))('core computes the pinned %s', (name) => {
    expect(values[name]).toBe(pins[name]);
  });
});
