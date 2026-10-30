# T-014: Envelope encryption and ciphertext store

- **Lane:** core
- **Phase:** 1
- **Depends on:** T-004
- **Paths this task may touch:** `packages/core/src/crypto/`, `packages/core/src/store/`, `packages/core/package.json`
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer subagent, branch `t-014-envelope-store`

## Intent

Restated by the implementer before coding:

The seller must be able to hand over work that nobody can read until the protocol says so. This task builds the three primitives for that, in `@holdback/core`, with no protocol logic on top:

- **Content sealing.** Encrypt a deliverable's bytes with AES-256-GCM (Node Web Crypto) under a fresh 32-byte key, returning the ciphertext, the key and the SHA-256 of both plaintext and ciphertext; decrypt and authenticate it again. Any wrong key or altered byte fails with a typed error.
- **Key envelopes.** Seal that content key to each named recipient's X25519 public key with NaCl box (`tweetnacl`), producing the `{ recipient, scheme, ciphertext }` entries of `delivery.encryptedKeys` for the primary, fallback and appeal adjudicators and, for early acceptance, the buyer. Each recipient opens only its own envelope; anyone else fails loudly.
- **Ciphertext store.** A `put(bytes) -> sha256` / `get(sha256) -> bytes` interface plus a local, file-per-hash implementation that accepts only well-formed ids (so no path traversal) and verifies the hash on every read.

Inputs are untrusted bytes and keys; outputs are bytes, hashes and schema-shaped envelope entries. Randomness is injectable so tests use fixed vectors. Keys never appear in error messages or logs.

Non-goals: building or validating `Delivery` messages, signatures, URIs or the decision's key release (T-006, T-007); mapping addresses to encryption keys (comes from adjudicator and agent records); remote or IPFS stores; confidential-compute judging; any schema change.

Original statement: give the two-sided hold (ADR-0012) its building blocks: encrypt a deliverable under a fresh content key, wrap that key for each recipient, and store ciphertext by hash so any party can fetch and verify it (ADR-0016, ADR-0011).

## Context

- ADR-0012, ADR-0016 section 8, ADR-0011 (Encryption, Ciphertext store); `spec/schemas/delivery.schema.json` (`encryptedKeys`, scheme `x25519-xsalsa20poly1305`); `docs/architecture.md` (Two-sided hold).

## Acceptance criteria

- [x] AES-256-GCM content encryption through Node's Web Crypto: `seal(plaintext) -> { ciphertext, key, plaintextSha256, ciphertextSha256 }` and `open(ciphertext, key)`; round-trip and tamper tests.
- [x] Key envelopes with `tweetnacl` box (`x25519-xsalsa20poly1305`): wrap the content key for the primary, fallback and appeal adjudicators and, for early acceptance, the buyer; unwrap tests with fixed vectors.
- [x] A store interface (`put(bytes) -> sha256`, `get(sha256) -> bytes`) with a local content-addressed implementation; `get` verifies the hash and fails on mismatch.
- [x] Deliverables are treated as untrusted bytes: no parsing in this package beyond hashing.

## Out of scope

- Remote or IPFS stores; confidential-compute judging.

## Evidence

- **`pnpm verify` after the review fixes and the merge of `origin/main` (measured, commit `2345853`):** typecheck pass, lint pass, test pass (22 files, 754 tests), spec pass, snap pass, demo placeholder. Report at `reports/verify-t-014-envelope-store.md` (gitignored). Before the review the run was the same except 14 files, 625 tests and snap placeholder.
- **New tests (measured):** 4 files, 85 tests in `packages/core/src/crypto/` and `packages/core/src/store/` (65 first round, 20 from the review).
- **Tests failed first (measured):** commit `687801f` added the tests before any implementation. Running them gave 3 files failing with `Cannot find module './index.js'` and `untrusted.test.ts` failing `expected 0 to be greater than or equal to 4` (no sources yet).
- **Review round, tests failed first (measured):** commit `5473614` added the review tests before the fixes; 17 of 85 failed. Among them: the second key of a two-key ciphertext was accepted; `open` without a hash was accepted; `seal` took non-`Uint8Array` input and oversize plaintext; envelopes with ephemeral u = 0, 1 and p - 1 opened, and u >= p was not refused as malformed; a planted FIFO hung `get` until the 3 s test timeout; a mode-000 file and a read-only store directory surfaced raw fs errors; `maxBytes` of NaN, -1, 0, 1.5, Infinity and 10485761 were accepted. Fixes in `c2d6fda` (crypto) and `b82b754` (store); all 85 pass.
- **Key commitment (measured):** the test builds a one-block ciphertext with a tag valid under two different keys (GHASH algebra in GF(2^128), SP 800-38D, AES blocks from `node:crypto`). Raw Web Crypto opens it under both keys to different plaintexts, so the attack is real; `open` with the committed hash returns the first plaintext and rejects the second key with `plaintext_hash_mismatch`.
- **Fixed vectors (measured):**
  - AES-256-GCM: McGrew and Viega test cases 13 and 14 (zero key and IV), recalled from the GCM spec and confirmed with `node:crypto` `createCipheriv` before use.
  - X25519: RFC 7748 section 6.1 key pairs and shared secret, reproduced by `tweetnacl`.
  - NaCl box: the 131-byte vector from Bernstein, "Cryptography in NaCl", reproduced byte for byte.
  - Envelope: a pinned base64url envelope computed with `tweetnacl` directly, outside this module, from the RFC 7748 keys and the NaCl nonce. `unwrapKey` opens it to the expected content key.
  - Hashes of the pinned ciphertext and plaintext cross-checked with `shasum -a 256`; store test uses the FIPS 180-2 `sha256("abc")` vector.
- **Mutation testing (measured):** hand-made mutants, each applied alone to the code, run against the 85 crypto and store tests, and reverted.
  - First round, 15 mutants: 13 caught at once; a fixed zero IV survived and is now caught by "prefixes the ciphertext with the injected IV and uses it"; one survives by design (below).
  - Review round, rerun of all 15 plus 15 new ones (30 total): 28 caught, 2 survive.
  - Caught, including the reviewer's survivors: non-atomic put (writes through a planted symlink); no temp cleanup; `console.log(key.exportBytes())`, `console.log(key)` and `console.error(secretKey)` on failure paths; optional plaintext hash; seal without type or size checks; unwrap without the low-order or u >= p check; no `O_NONBLOCK`; raw fs errors rethrown by `get` or `put`; unvalidated `maxBytes`.
  - Survives by design: removing the `dirname` guard in `LocalCiphertextStore`. It is unreachable while the id regex admits only 64 hex digits; kept as defense in depth.
  - Survives, untested: replacing the bounded read with `readFile`. It differs only when a file grows between `fstat` and the read, a race the suite does not stage. The bound is inferred correct from reading the code.
- **Determinism (measured):** tests draw randomness from scripted or counter sources and fast-check with fixed seeds; `untrusted.test.ts` asserts no `Math.random` or `Date.now` in the sources. The two "default source differs" tests use the system CSPRNG only to show two outputs differ.
- **Untrusted bytes (measured, partial):** `untrusted.test.ts` scans the non-test sources for `JSON.parse`, `TextDecoder`, UTF-8 decoding, dynamic code and imports of `parse.js`; invalid UTF-8 and instruction-like JSON round-trip unchanged through both stores. That the modules do nothing else with content is inferred from reading the code.
- **Keys out of errors and logs (measured):** tests render every error path with `String`, `.message`, `util.inspect(showHidden)` and `JSON.stringify` and look for hex, decimal-array and base64 fragments of the keys; `ContentKey` renders as `ContentKey(redacted)`. Spies on every `console` method show seal, open, wrap and unwrap, including their failure paths, write nothing. Store errors carry no path or id. Raw X25519 secret keys are plain `Uint8Array`s, so a caller who logs one directly would leak it (inferred).
- **gitleaks (measured in CI):** not installed locally; the PR's CI `gitleaks` job passes. The test files contain public test-vector keys (RFC 7748, NaCl paper), which it did not flag.

## Decisions

- **Ciphertext layout `iv(12) || ct || tag(16)`.** The delivery schema has no IV field, so the IV travels inside the stored object and is covered by `ciphertext.sha256`.
- **Envelope layout `ephemeralPublicKey(32) || nonce(24) || box(48)`, base64url without padding.** A fresh ephemeral sender key per envelope, so the seller needs no long-lived encryption key; the signed delivery already authenticates the seller.
- **Strict decoding.** Base64url must be canonical; public keys with the X25519 top bit set are refused, because X25519 ignores that bit and a bit-flipped envelope would otherwise still open. Non-reduced keys (u >= p) are refused on both wrap and unwrap. Low-order keys, which give an all-zero shared secret anyone can compute, are refused as recipients on wrap and as ephemeral keys on unwrap (`malformed_envelope`).
- **`ContentKey` class** with the bytes in a private field and redacted `inspect`, `toJSON` and `toString`, so a sealed result can be logged safely. `exportBytes()` returns a copy.
- **Typed errors with fixed messages.** `CryptoError` and `StoreError` take only a code; nothing caller-supplied (keys, ids, paths) reaches a message.
- **Required plaintext hash on open (review finding 1).** `open(ciphertext, key, expectedPlaintextSha256)` takes the hash as a required argument; it fails with `invalid_expected_hash` if the argument is missing or malformed and `plaintext_hash_mismatch` if the result differs. AES-GCM is not key-committing: a ciphertext can authenticate under two keys to different plaintexts, so a seller could hand adjudicators one key and the buyer another. This is sufficient because the delivery the seller signs carries `plaintextSha256`. Whichever key a party receives, it either produces exactly the committed plaintext or is rejected, so a second valid plaintext cannot exist without a SHA-256 collision. A key-committing scheme (for example a key-commitment block) would also work, but it changes the wire format, so the schema would need an ADR.
- **Seal limits.** `seal` refuses anything but a `Uint8Array` (`invalid_plaintext`) and plaintext whose ciphertext would exceed 10,485,760 bytes (`plaintext_too_large`). `MAX_CIPHERTEXT_BYTES` now lives in `crypto/content.ts` and the store re-exports it.
- **No AAD.** The content is not bound to the commitment ID inside GCM. The signed delivery binds both hashes to the commitment; adding AAD would need a schema field. Recorded as a gap below.
- **Store details.** Files are named by the 64-hex digest in one flat directory.
  - `put` writes a temp file and renames it over the object. That is atomic, repairs a corrupted copy, and replaces a planted symlink instead of writing through it. Any failure removes the temp file and throws `io_error`.
  - `get` opens with `O_NOFOLLOW | O_NONBLOCK`, so symlinks and FIFOs are refused as `not_a_file` without blocking. It reads at most `min(size, maxBytes) + 1` bytes, caps size, and verifies the hash. Other fs errors become `io_error`, whose fixed message has no path.
  - `maxBytes` must be a positive safe integer no larger than 10,485,760 (`invalid_option`). Empty objects are refused (schema minimum is 1). A `MemoryCiphertextStore` with the same contract is included for tests and SimChain.
- **Subpath exports** `@holdback/core/crypto` and `@holdback/core/store` in `package.json`, instead of re-exporting from `src/index.ts`, which is outside this task's paths. This also keeps `node:fs` out of the root barrel.
- **Dependency:** `tweetnacl` ^1.0.3 (named in ADR-0016). No other dependency added.

## Handoff

**Done:** all four acceptance criteria, with tests, fixed vectors and mutation evidence above.

**Not done, out of lane or out of scope:**
- `packages/core/src/index.ts` does not re-export crypto or store (outside this task's paths). Consumers import `@holdback/core/crypto` and `@holdback/core/store`. If the core lane wants them in the root barrel, that is a one-line follow-up, though it would pull `node:fs` into it.
- `docs/team.md` Rules and checks: proposed new row, not added (out of lane). Rule "Deliverables are untrusted: crypto and store treat them as opaque bytes"; check `packages/core/src/crypto/untrusted.test.ts` (source scan).

**Contract gaps for the spec owner (no schema change made):**
- `delivery.ciphertext.uri` has no defined scheme for the local store. The store returns `sha256:<hex>` ids; T-006 or T-007 needs to decide how a URI maps to a store and id.
- The envelope byte layout and the AES-GCM ciphertext layout are defined only in code comments here. They are part of the wire format other implementations need, so they belong in `docs/api.md` or a schema description.
- `encryptedKeys[].recipient` is an EVM address, while the envelope is sealed to an X25519 key taken from `encryptionPublicKey` or `buyerEncryptionPublicKey`. Nothing checks that an envelope labeled for an address was sealed to that address's published key, and the settlement layer cannot check it. That is the existing "missing or wrong key" appeal ground (ADR-0012); worth naming explicitly.
- No AAD binds ciphertext to a commitment; replaying an old ciphertext into a new delivery is prevented only by the signed hashes.

**For T-006 and T-009 (review finding 1):** always pass the delivery's signed `plaintextSha256` to `open`. The type system requires it, but code that holds a hash from anywhere other than the signed delivery (for example one recomputed from a decrypted copy) would defeat the check. A buyer or adjudicator whose key yields `plaintext_hash_mismatch` or `decrypt_failed` has the "missing or wrong key" appeal ground.

**Known untested path:** the bounded read in `LocalCiphertextStore.get` (a file growing during the read); see Evidence.

**How to resume:** branch `t-014-envelope-store`; run `pnpm vitest run packages/core/src/crypto packages/core/src/store`. The mutation script used is not committed (it lived in a scratchpad); the mutants are listed in Evidence.
