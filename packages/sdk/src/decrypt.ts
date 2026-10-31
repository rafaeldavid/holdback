// Decrypting a deliverable on the agent's side (ADR-0021). The plaintext hash is always checked on the raw bytes
// the seller committed to. The agent then gets, by default, the normalized view the judges saw (hidden
// characters stripped and counted, NFKC applied), with the screen report, so content that hid from a human
// reviewer does not reach the agent unannounced. The raw bytes are there on request.
import type { Address, MimeType, Sha256 } from '@holdback/core';
import { open, unwrapKeyFor, type EncryptedKey } from '@holdback/core/crypto';
import { normalizeText, screen, UntrustedData, type ScreenResult } from '@holdback/judgment';

export interface DecryptInput {
  /** The ciphertext bytes the delivery's `ciphertext.uri` points at. */
  ciphertext: Uint8Array;
  /** The signed delivery's `plaintextSha256`. */
  plaintextSha256: Sha256;
  /** Envelopes released to this agent (GET /v1/commitments/{id}/key) or the delivery's encryptedKeys. */
  envelopes: readonly EncryptedKey[];
  recipient: Address;
  secretKey: Uint8Array;
  plaintextMime?: MimeType;
}

export interface Removed {
  tagChars: number;
  zeroWidth: number;
  nfkcChanged: number;
  /** Hidden characters that belong to ordinary writing (emoji sequences, joiners in some scripts). */
  explained: number;
}

export interface Decrypted<P> {
  plaintext: P;
  screen: ScreenResult;
  removed: Removed;
}

export function decryptDeliverable(input: DecryptInput, options?: { raw?: false }): Promise<Decrypted<string>>;
export function decryptDeliverable(input: DecryptInput, options: { raw: true }): Promise<Decrypted<Uint8Array>>;
export function decryptDeliverable(input: DecryptInput, options?: { raw?: boolean }): Promise<Decrypted<string | Uint8Array>>;
export async function decryptDeliverable(input: DecryptInput, options: { raw?: boolean } = {}): Promise<Decrypted<string | Uint8Array>> {
  const key = unwrapKeyFor(input.envelopes, input.recipient, input.secretKey);
  // open() throws plaintext_hash_mismatch unless the raw bytes hash to the committed value.
  const raw = await open(input.ciphertext, key, input.plaintextSha256);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw);
  const n = normalizeText(text);
  const removed: Removed = { tagChars: n.tagChars, zeroWidth: n.zeroWidth, nfkcChanged: n.nfkcChanged, explained: n.explained };
  const report = screen({
    data: UntrustedData.wrap(n.text),
    hiddenTagText: UntrustedData.wrap(n.hiddenTagText),
    removed,
    ...(input.plaintextMime ? { mime: input.plaintextMime } : {}),
  });
  return { plaintext: options.raw ? raw : n.text, screen: report, removed };
}
