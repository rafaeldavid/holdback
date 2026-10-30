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

- **`pnpm verify` (measured on the branch head; the task-file commit changes no code):** typecheck pass, lint pass, test pass (14 files, 625 tests), spec pass, snap placeholder, demo placeholder. Report at `reports/verify-t-014-envelope-store.md` (gitignored).
- **New tests (measured):** 4 files, 65 tests in `packages/core/src/crypto/` and `packages/core/src/store/`, all passing in about 0.7 s.
- **Tests failed first (measured):** commit `687801f` added the tests before any implementation. Running them gave 3 files failing with `Cannot find module './index.js'` and `untrusted.test.ts` failing `expected 0 to be greater than or equal to 4` (no sources yet).
- **Fixed vectors (measured):**
  - AES-256-GCM: McGrew and Viega test cases 13 and 14 (zero key and IV), recalled from the GCM spec and confirmed with `node:crypto` `createCipheriv` before use.
  - X25519: RFC 7748 section 6.1 key pairs and shared secret, reproduced by `tweetnacl`.
  - NaCl box: the 131-byte vector from Bernstein, "Cryptography in NaCl", reproduced byte for byte.
  - Envelope: a pinned base64url envelope computed with `tweetnacl` directly, outside this module, from the RFC 7748 keys and the NaCl nonce. `unwrapKey` opens it to the expected content key.
  - Hashes of the pinned ciphertext and plaintext cross-checked with `shasum -a 256`; store test uses the FIPS 180-2 `sha256("abc")` vector.
- **Mutation testing (measured):** 15 hand-made mutants, each applied alone and reverted.
  - Caught on the first suite (13): open returning unauthenticated bytes; skipped plaintext-hash check; `toJSON` leaking the key; missing top-bit check on the envelope's ephemeral key; missing low-order recipient check; `unwrapKeyFor` ignoring the recipient address; lenient base64url; unwrap error carrying the secret key; store read skipping hash verification; loose id pattern; following symlinks; no default size cap; wrap ignoring the injected nonce.
  - Survived, then fixed (1): a fixed zero IV. Added the test "prefixes the ciphertext with the injected IV and uses it"; the mutant is now caught.
  - Survives by design (1): removing the `dirname` guard in `LocalCiphertextStore`. It is unreachable while the id regex admits only 64 hex digits; kept as defense in depth.
- **Determinism (measured):** tests draw randomness from scripted or counter sources and fast-check with fixed seeds; `untrusted.test.ts` asserts no `Math.random` or `Date.now` in the sources. The two "default source differs" tests use the system CSPRNG only to show two outputs differ.
- **Untrusted bytes (measured, partial):** `untrusted.test.ts` scans the non-test sources for `JSON.parse`, `TextDecoder`, UTF-8 decoding, dynamic code and imports of `parse.js`; invalid UTF-8 and instruction-like JSON round-trip unchanged through both stores. That the modules do nothing else with content is inferred from reading the code.
- **Keys out of errors (measured):** tests render every error path with `String`, `.message`, `util.inspect(showHidden)` and `JSON.stringify` and look for hex, decimal-array and base64 fragments of the keys; `ContentKey` renders as `ContentKey(redacted)`. Raw X25519 secret keys are plain `Uint8Array`s, so a caller who logs one directly would leak it (inferred).
- **gitleaks (measured in CI):** not installed locally; the PR's CI `gitleaks` job passes. The test files contain public test-vector keys (RFC 7748, NaCl paper), which it did not flag.

## Decisions

- **Ciphertext layout `iv(12) || ct || tag(16)`.** The delivery schema has no IV field, so the IV travels inside the stored object and is covered by `ciphertext.sha256`.
- **Envelope layout `ephemeralPublicKey(32) || nonce(24) || box(48)`, base64url without padding.** A fresh ephemeral sender key per envelope, so the seller needs no long-lived encryption key; the signed delivery already authenticates the seller.
- **Strict decoding.** Base64url must be canonical; public keys with the X25519 top bit set are refused, because X25519 ignores that bit and a bit-flipped envelope would otherwise still open. Recipient keys that give an all-zero shared secret (low order) are refused.
- **`ContentKey` class** with the bytes in a private field and redacted `inspect`, `toJSON` and `toString`, so a sealed result can be logged safely. `exportBytes()` returns a copy.
- **Typed errors with fixed messages.** `CryptoError` and `StoreError` take only a code; nothing caller-supplied (keys, ids, paths) reaches a message.
- **Optional plaintext check on open.** `open(ct, key, { expectPlaintextSha256 })` fails with `plaintext_hash_mismatch`, which is how a buyer detects the "missing or wrong key" appeal ground.
- **No AAD.** The content is not bound to the commitment ID inside GCM. The signed delivery binds both hashes to the commitment; adding AAD would need a schema field. Recorded as a gap below.
- **Store details.** Files are named by the 64-hex digest in one flat directory; `put` writes a temp file and renames it, which also repairs a corrupted copy; `get` opens with `O_NOFOLLOW`, refuses non-files, caps size at 10,485,760 bytes (the schema maximum), and verifies the hash. Empty objects are refused (schema minimum is 1). A `MemoryCiphertextStore` with the same contract is included for tests and SimChain.
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

**How to resume:** branch `t-014-envelope-store`; run `pnpm vitest run packages/core/src/crypto packages/core/src/store`. The mutation script used is not committed (it lived in a scratchpad); the mutants are listed in Evidence.
