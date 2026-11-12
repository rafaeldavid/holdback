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
  commitmentId: '0x6bdb0a2fe90f698ca6e4786c36d35b5147ef9abb0771057aa4c1a3911569b248',
  schemaVersionHash: '0x15e7a716d821b9602c70f6d0f574efbb8147fb465215d43354c7b3e69d03ed92',
  termsDigest: '0xce857ec719814ca437a36c4d8c05df882d685c72172a0333adfe30f3a8187e61',
  deliveryHash: '0x93ab77cc02ea63b2c518c651abd645ebb44e3735f5efcbdc7221bde8c42d10d8',
  decisionDigest: '0xcf2fff4c045473283a1414ae5c36847f25989f4aec9869c018805fd3b9e21f94',
  acceptanceDigest: '0x67022aceda5ba70cb31d1ea142866b79e0de661257385e4ef36b767b5e448004',
  agreeDigest: '0x06aaeb1dcb956056d5ccf829563bb722b8684fb293e79e65a475d94eb4b9a5f9',
  earlyAcceptDigest: '0x0af6c0c7c9e76a8bab144abf72e1eb8ab3388cf1bba5c138bb1a487514474117',
  mutualDigest: '0x32adb8a961ee550fd52e4fd24c8d92debbdb15104bb497bfd44236a4667a61d9',
  appealDigest: '0xa1222f359777b62c6ec7b694b710d7b3c86b9914cb89e05e8d4b4f423aac3b52',
  panelSeed: '0x11d7d7df48d0f1abe95c4cf05415151fe4007df150f1072d1e5730d2fd7d1121',
};

describe('cross-language vectors (Vectors.t.sol)', () => {
  it.each(Object.keys(pins))('core computes the pinned %s', (name) => {
    expect(values[name]).toBe(pins[name]);
  });
});
