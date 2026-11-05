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
  commitmentId: '0x529405ab41df1b56773108432572110d616c6c7c57af5b3ebd00154eec003627',
  schemaVersionHash: '0x039eb7c1a17686c95dc5e5f7bb8ad8976b26a2ed19913115218a992047cfcee5',
  termsDigest: '0x78f007af036c3eba017d3090790b8c71b02e7b6a09f93edab14f6b72c992e1a9',
  deliveryHash: '0x1d70f2ee1a2f03f0438c730ea47aec3989152b32927a3f6a37fc46f3b3a7772e',
  decisionDigest: '0x77ce852f1204ab202d7ce466066b6aae816c612c1840a69217816c219abb40fd',
  acceptanceDigest: '0x197971ce7307f9f2d8c61bbb914e3eef49e04fe747a90f9191b7d81687b2edb4',
  agreeDigest: '0x75acef94809bbb682cd4059318096010276885586e6d89df16871caafb741b86',
  earlyAcceptDigest: '0x8b3b3acb5f186c9f065ea40a5fc4c314e9e54f01490b932ef18a4654fd89cb88',
  mutualDigest: '0x902fedd1cc7ae1ea7efbe1987a3d6b9277744d414aa4d67523a157c5858a724e',
  appealDigest: '0x52e6969b9d47150bcd17190e43ccc3b93a40feb6208f3aea4d4c89a149ccd235',
  panelSeed: '0x07a9721cfe7c323ec0815715c5a629b8cd46b5a5b0a35feaca57b0f76bd53f3e',
};

describe('cross-language vectors (Vectors.t.sol)', () => {
  it.each(Object.keys(pins))('core computes the pinned %s', (name) => {
    expect(values[name]).toBe(pins[name]);
  });
});
