# T-014: Envelope encryption and ciphertext store

- **Lane:** core
- **Phase:** 1
- **Depends on:** T-004
- **Paths this task may touch:** `packages/core/src/crypto/`, `packages/core/src/store/`, `packages/core/package.json`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Restate this in your own words in this section before writing code.

Give the two-sided hold (ADR-0012) its building blocks: encrypt a deliverable under a fresh content key, wrap that key for each recipient, and store ciphertext by hash so any party can fetch and verify it (ADR-0016, ADR-0011).

## Context

- ADR-0012, ADR-0016 section 8, ADR-0011 (Encryption, Ciphertext store); `spec/schemas/delivery.schema.json` (`encryptedKeys`, scheme `x25519-xsalsa20poly1305`); `docs/architecture.md` (Two-sided hold).

## Acceptance criteria

- [ ] AES-256-GCM content encryption through Node's Web Crypto: `seal(plaintext) -> { ciphertext, key, plaintextSha256, ciphertextSha256 }` and `open(ciphertext, key)`; round-trip and tamper tests.
- [ ] Key envelopes with `tweetnacl` box (`x25519-xsalsa20poly1305`): wrap the content key for the primary, fallback and appeal adjudicators and, for early acceptance, the buyer; unwrap tests with fixed vectors.
- [ ] A store interface (`put(bytes) -> sha256`, `get(sha256) -> bytes`) with a local content-addressed implementation; `get` verifies the hash and fails on mismatch.
- [ ] Deliverables are treated as untrusted bytes: no parsing in this package beyond hashing.

## Out of scope

- Remote or IPFS stores; confidential-compute judging.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
