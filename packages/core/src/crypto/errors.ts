// Typed crypto failures. Messages come from a fixed table and never interpolate inputs, so key
// material, ciphertext and caller-supplied strings cannot reach logs through an error.
export type CryptoErrorCode =
  | 'invalid_key'
  | 'invalid_random'
  | 'malformed_ciphertext'
  | 'decrypt_failed'
  | 'plaintext_hash_mismatch'
  | 'unsupported_scheme'
  | 'malformed_envelope'
  | 'unwrap_failed'
  | 'invalid_public_key'
  | 'invalid_secret_key'
  | 'no_envelope_for_recipient'
  | 'duplicate_recipient';

const MESSAGES: Record<CryptoErrorCode, string> = {
  invalid_key: 'content key must be 32 bytes',
  invalid_random: 'random source returned the wrong number of bytes',
  malformed_ciphertext: 'ciphertext is too short to hold an IV and a tag',
  decrypt_failed: 'ciphertext failed authentication: wrong key or tampered bytes',
  plaintext_hash_mismatch: 'decrypted plaintext does not match the committed plaintext hash',
  unsupported_scheme: 'unsupported key envelope scheme',
  malformed_envelope: 'key envelope is not a well-formed x25519-xsalsa20poly1305 envelope',
  unwrap_failed: 'key envelope failed authentication: wrong recipient key or tampered envelope',
  invalid_public_key: 'recipient public key is not a usable 32-byte X25519 key',
  invalid_secret_key: 'recipient secret key must be 32 bytes',
  no_envelope_for_recipient: 'no key envelope for this recipient',
  duplicate_recipient: 'more than one key envelope for the same recipient',
};

export class CryptoError extends Error {
  override readonly name = 'CryptoError';
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}
