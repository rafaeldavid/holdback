// Reference files for `reference_row_match_min` (T-327): which bytes an adjudicator may load, and from where.
//
// A reference is untrusted data, like a delivery. It is loaded the way the delivery's ciphertext is: through the
// adjudicator's content store, which keeps bytes under their SHA-256 and reads its own store, never a URL. So a
// reference is looked up only when its URI ends in the hash the agreed terms commit to; any other URI is not
// asked for at all. The check then hashes the bytes again (checks/index.ts), so a store that hands back other
// bytes fails the check. A reference that cannot be loaded is left out, and the check fails closed with
// "reference not available".
//
// Nothing here opens a file or a connection: the caller passes the store's reader.
import type { Sha256 } from '@holdback/core';
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
 * order. A reference whose URI does not end in its committed hash is left out, so its check fails closed.
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
 * Loads every reference the checks name through `read`, the adjudicator's content-store reader (the one it reads
 * the delivery's ciphertext with). A reference `read` cannot return is left out: its check fails closed.
 */
export async function loadReferences(checks: readonly JudgmentCheck[], read: (uri: string) => Promise<Uint8Array>): Promise<Map<string, Uint8Array>> {
  const refs = new Map<string, Uint8Array>();
  for (const { sha256, uri } of referenceLookups(checks)) {
    try {
      refs.set(sha256, await read(uri));
    } catch {
      // Not in the store, or the store did not answer: the check says "reference not available".
    }
  }
  return refs;
}
