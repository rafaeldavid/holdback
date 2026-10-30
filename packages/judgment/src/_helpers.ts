// Test helpers shared by the judgment tests. Deterministic: fixed keys, fixed IVs, fixed nonces.
import { createCipheriv, createHash } from 'node:crypto';
import type { AcceptanceSpec, AdjudicatorPolicy, Criterion, Delivery, Sha256 } from '@holdback/core';

export const ADJUDICATOR = '0x5d10fecab9242e66cb134b77309a3566ed75e3dd' as const;
export const CONTENT_KEY = new Uint8Array(32).map((_, i) => i + 1);
const IV = new Uint8Array(12).map((_, i) => 0xa0 + i);

export const sha256 = (bytes: Uint8Array): Sha256 => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** AES-256-GCM in the provisional layout iv(12) || ciphertext || tag(16). */
export function seal(plaintext: Uint8Array, key: Uint8Array = CONTENT_KEY): Uint8Array {
  const c = createCipheriv('aes-256-gcm', key, IV);
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return new Uint8Array(Buffer.concat([IV, body, c.getAuthTag()]));
}

/** A fake envelope: the "wrapped" key is the key itself in base64url, addressed to the recipient. */
export const fakeEnvelope = (key: Uint8Array = CONTENT_KEY): string => Buffer.from(key).toString('base64url');
export const fakeUnwrap = async (env: { ciphertext: string }): Promise<Uint8Array> => new Uint8Array(Buffer.from(env.ciphertext, 'base64url'));

export function delivery(plaintext: Uint8Array, ciphertext: Uint8Array, over: Partial<Delivery> = {}): Delivery {
  return {
    commitmentId: `0x${'11'.repeat(32)}`,
    attempt: 1,
    ciphertext: { uri: 'file:///store/x', sha256: sha256(ciphertext), bytes: ciphertext.length, cipher: 'aes-256-gcm' },
    plaintextSha256: sha256(plaintext),
    plaintextMime: 'text/csv',
    encryptedKeys: [
      { recipient: ADJUDICATOR, scheme: 'x25519-xsalsa20poly1305', ciphertext: fakeEnvelope() },
      { recipient: '0xf9e6283d068ff7016653ab6d36a7fab0294f4b8a', scheme: 'x25519-xsalsa20poly1305', ciphertext: fakeEnvelope(new Uint8Array(32)) },
      { recipient: '0xc372bd536a0f63fe9fde6bca1db179ce93612520', scheme: 'x25519-xsalsa20poly1305', ciphertext: fakeEnvelope(new Uint8Array(32)) },
    ],
    submittedAt: '2026-10-31T16:20:00Z',
    signature: `0x${'22'.repeat(65)}`,
    ...over,
  };
}

export const criterion = (id: string, weight: number): Criterion => ({
  id,
  description: `Criterion ${id}.`,
  weight,
  anchors: { '0': 'bad', '2': 'partial', '4': 'good' },
});

export const RUBRIC: AcceptanceSpec['rubric'] = {
  criteria: [criterion('dedupe_quality', 0.4), criterion('no_fabrication', 0.4), criterion('notes', 0.2)],
  passThreshold: 3,
};

export const POLICY: AdjudicatorPolicy = {
  id: 'bench-a/p1',
  panelSize: 3,
  appealPanelSize: 5,
  minFamilies: 2,
  minFamiliesAppeal: 3,
  minValid: 2,
  minValidAppeal: 4,
  acceptSupermajority: 0.66,
  rejectSupermajority: 0.66,
  judgeTimeoutSec: 60,
  rationaleMaxChars: 600,
  promptTemplateHash: `0x${'00'.repeat(32)}`,
  appealPromptTemplateHash: `0x${'00'.repeat(32)}`,
  aggregationVersion: 'agg-1',
  screenVersion: 'screen-0',
};

export const GOOD_CSV = [
  'customer_id,name,email,signup_date,email_valid',
  '1,Ada Lovelace,ada@example.com,2024-01-02,true',
  '2,Grace Hopper,grace@example.com,2024-02-03,true',
  '3,Alan Turing,,2024-03-04,false',
].join('\n');

export const NONCES = { boundary: 'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf', canary: 'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf' };
