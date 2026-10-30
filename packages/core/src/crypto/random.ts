import { webcrypto } from 'node:crypto';
import { CryptoError } from './errors.js';

/** Returns `length` uniformly random bytes. Injected in tests for fixed vectors; defaults to Web Crypto. */
export type RandomSource = (length: number) => Uint8Array;

export const systemRandom: RandomSource = (length) => webcrypto.getRandomValues(new Uint8Array(length));

/** Draws bytes and copies them, so the caller's buffer cannot alias key material. */
export function draw(random: RandomSource, length: number): Uint8Array<ArrayBuffer> {
  const bytes = random(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new CryptoError('invalid_random');
  return Uint8Array.from(bytes);
}
