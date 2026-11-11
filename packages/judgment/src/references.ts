// Reference files for `reference_row_match_min` (T-327): which bytes an adjudicator may load, and from where.
//
// A reference is untrusted data, like a delivery. It is loaded the way the delivery's ciphertext is: through the
// adjudicator's content store, which keeps bytes under their SHA-256 and reads its own store, never a URL. So a
// hash is looked up only when a check's URI ends in it. The check then hashes the bytes again (checks/index.ts).
//
// A reference the store cannot return, or returns with other bytes, is the store's fault, not a party's: like a
// stored ciphertext that does not match its delivery, it is not judged. `loadReferences` reports it as
// unavailable, and the adjudicator refuses the turn without a record and retries; if it never gets the bytes,
// the fallback takes over and then the default outcome applies (T-327 red team, H1). So no store can decide a
// deal by withholding one read.
//
// Nothing here opens a file or a connection: the caller passes the store's reader.
import type { Sha256 } from '@holdback/core';
import { sha256 as hash, MAX_CIPHERTEXT_BYTES as STORE_MAX_BYTES } from '@holdback/core/crypto';
import type { JudgmentCheck } from './terms.js';

const SHA256 = /^sha256:[0-9a-f]{64}$/;

export interface ReferenceLookup {
  /** The hash the terms commit to: the key the check reads the bytes under. */
  sha256: Sha256;
  /** The URI to ask the content store for; it ends in `sha256`. */
  uri: string;
}

/**
 * The references the checks name that a content store may be asked for, once per committed hash, in declaration
 * order. A hash no check names by a URI ending in it is never looked up, so a check that only names it that way
 * fails closed with "reference not available", the same on every adjudicator.
 */
export function referenceLookups(checks: readonly JudgmentCheck[]): ReferenceLookup[] {
  const out = new Map<string, ReferenceLookup>();
  for (const c of checks) {
    if (c.type !== 'reference_row_match_min') continue;
    const { uri, sha256 } = c.reference ?? {};
    if (typeof uri !== 'string' || typeof sha256 !== 'string' || !SHA256.test(sha256) || !uri.endsWith(sha256)) continue;
    if (!out.has(sha256)) out.set(sha256, { sha256: sha256 as Sha256, uri });
  }
  return [...out.values()];
}

/**
 * The largest reference, in bytes: 10,485,760, the most any content store keeps (core's `MAX_CIPHERTEXT_BYTES`;
 * `POST /v1/ciphertext` refuses more, and a node may publish a lower `limits.maxCiphertextBytes`). So the cap refuses
 * nothing a store would have taken. The check library fails a larger reference closed with the same number
 * (checks/index.ts), so a seller's preflight agrees; an adjudicator counts it unavailable and does not serve the deal.
 */
export const REFERENCE_MAX_BYTES = STORE_MAX_BYTES;

export type UnavailableReason = 'not_returned' | 'hash_mismatch' | 'too_large';

export interface LoadedReferences {
  /** The bytes of every reference the store returned under its committed hash. */
  references: Map<string, Uint8Array>;
  /**
   * The first reference the store did not return, returned with other bytes, or returned larger than any store keeps;
   * empty when every one loaded. Non-empty: the turn is not judged, and the references after it were not read.
   */
  unavailable: Array<ReferenceLookup & { reason: UnavailableReason }>;
}

/**
 * Loads the references the checks name through `read`, the adjudicator's content-store reader (the one it reads
 * the delivery's ciphertext with). It stops at the first one it cannot use, so a retry pass reads and hashes no
 * more than it must (T-327 review, finding 3). A non-empty `unavailable` means the adjudicator must not judge yet.
 */
export async function loadReferences(checks: readonly JudgmentCheck[], read: (uri: string) => Promise<Uint8Array>): Promise<LoadedReferences> {
  const references = new Map<string, Uint8Array>();
  for (const lookup of referenceLookups(checks)) {
    let bytes: Uint8Array;
    try {
      bytes = await read(lookup.uri);
    } catch {
      return { references, unavailable: [{ ...lookup, reason: 'not_returned' }] };
    }
    if (bytes.length > REFERENCE_MAX_BYTES) return { references, unavailable: [{ ...lookup, reason: 'too_large' }] };
    if (hash(bytes) !== lookup.sha256) return { references, unavailable: [{ ...lookup, reason: 'hash_mismatch' }] };
    references.set(lookup.sha256, bytes);
  }
  return { references, unavailable: [] };
}

const REASON: Record<UnavailableReason, string> = {
  not_returned: 'the store did not return it',
  hash_mismatch: 'the store returned other bytes',
  too_large: `the store returned more than ${REFERENCE_MAX_BYTES} bytes`,
};

/** One line for a refusal or a note: which references are unavailable, and why. */
export function describeUnavailable(unavailable: LoadedReferences['unavailable']): string {
  return unavailable.map((u) => `${u.sha256} (${REASON[u.reason]})`).join(', ');
}
