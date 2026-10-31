// The delivery encryption, stated so any language can build it with standard libraries (docs/api.md,
// "Encrypting a delivery"). It describes @holdback/core/crypto exactly; envelope-spec.test.ts checks the
// published test vectors against core. Not HPKE (RFC 9180): the envelope is a NaCl box from a fresh
// ephemeral key, which libsodium, tweetnacl and PyNaCl all implement.
export const ENVELOPE_SPEC = {
  content: {
    cipher: 'aes-256-gcm',
    key: '32 random bytes, fresh per delivery (the content key)',
    layout: 'iv (12 random bytes) || AES-256-GCM ciphertext || tag (16 bytes); no associated data',
    hashes: 'ciphertext.sha256 and plaintextSha256 are "sha256:" + lowercase hex of SHA-256 over the stored bytes and the plaintext',
  },
  envelope: {
    scheme: 'x25519-xsalsa20poly1305',
    construction: 'NaCl crypto_box (x25519, xsalsa20, poly1305) from a fresh ephemeral key pair to the recipient public key',
    layout: 'ephemeral public key (32) || nonce (24 random bytes) || crypto_box(contentKey, nonce, recipientPublicKey, ephemeralSecretKey) (48)',
    encoding: 'base64url without padding (104 bytes become 139 characters)',
    entry: '{ "recipient": <address>, "scheme": "x25519-xsalsa20poly1305", "ciphertext": <envelope> }, one per recipient, in the order /recipients lists them',
    publicKeys: 'recipient encryption public keys are 32-byte x25519 keys, base64url without padding',
  },
} as const;
