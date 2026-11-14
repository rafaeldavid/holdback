# T-433: the mandate tool

- **Lane:** demo (Crow's own agents, roadmap row N131, build row 2)
- **Phase:** 2
- **Depends on:** ADR-0038 and D69 (Rafa's answers of 2026-11-14); the own-agents design in crow-private (`company-ops/own-agents/design.md`, decisions 1 to 6 taken by Rafa on 2026-11-14)
- **Paths this task may touch:** `examples/mandate.ts`, `examples/mandate.test.ts`, one paragraph in `site/ref/limits.txt`, this file
- **Human gate:** no (nothing is deployed by this task; the site deploy after merge follows the wave's "merge and deploy when ready" rule)
- **Status:** in progress
- **Agent/session:** own-agents build session, started by the coordinator on 2026-11-14 ("Yes, start both")

## Intent

Crow's principal key lives on Rafa's hardware wallet, and no tool may hold it. Today no command builds or verifies a mandate offline (design, "What holds today"). This task adds one small command, `examples/mandate.ts`, that:

1. **builds** the three messages a principal or an agent signs, each as a standard `eth_signTypedData_v4` file that any wallet signs: a `Mandate` (principal to agent), a `Delegation` (the agent's standing key to one deal's key) and an `AgentRevocation` (principal ends its agent);
2. **verifies** a signed one: the file is exactly one of the three messages under the pinned domain, the signature recovers to the key that must sign it, and it is in effect at the time asked; for a delegation or a revocation, also that it fits the mandate it hangs from;
3. **prints the hash**: the EIP-712 digest the wallet shows and signs.

The signature is made elsewhere. The tool never takes, reads or makes a private key.

Non-goals: a route that posts a mandate or a revocation to an operator (ADR-0038 steps 4 and 5, not built); any change to the signed types (`spec/schemas/` is untouched); the signer (T-434); the buyer's tools and their pinned bundle.

## Context

- `spec/schemas/mandate.schema.json`, `messages.schema.json` (`Delegation`, `AgentRevocation`), `common.schema.json` (`Scope`).
- `packages/core/src/eip712.ts`: the typed data the operators and the contracts' domain use (domain `Holdback` 0.8).
- ADR-0038 section 4: a revocation counts only against a mandate of its own principal; its `expiresAt` defaults to the last representable time; it voids every mandate that principal gave that agent while unexpired.
- `examples/verify.ts`: `typedDataFile`, `strictTypedDataFile`, `digestOfFile`, the pinned domains.

## Acceptance criteria

- [ ] `mandate`, `delegation` and `revocation` write one typed-data file each, with a fresh random nonce, and print its digest and one sentence of what it grants or ends. No argument takes a private key.
- [ ] The files hash, under the pinned domain, to the digest `@holdback/core`'s `messageDigest` gives for the same message (the encoding the operators use).
- [ ] `verify` accepts a correctly signed file and prints the signed document in its schema's form (`mandate.schema.json`, or the message schema) with the digest. The test validates that form with Ajv against `spec/schemas/`.
- [ ] `verify` refuses, naming the reason: a signature by another key; a changed field; another domain (chain or rules contract); an unknown type or an extra field; an expired mandate or delegation; a delegation wider than its mandate (role, cap, club, expiry, principal or agent); a revocation by another principal than the mandate's. Exit status 3 on a refusal.
- [ ] Only Ethereum Sepolia (11155111) and a local chain (31337) are pinned; a mainnet chain ID in `HOLDBACK_DEPLOYMENT` is refused.
- [ ] One paragraph in `site/ref/limits.txt` says what the tool does and what it does not (it enforces nothing; an operator takes no company mandate today).
- [ ] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## The constraints this task touches

| Constraint | Rung | What enforces it | The attack that fails |
| --- | --- | --- | --- |
| The principal's key is on no machine the tools run on | 1, by construction | The tool takes no key: it writes the message and checks a signature | `mandate.test.ts`, "takes no key": every command's arguments are scanned for a 32-byte hex value, and none is read from the environment |
| A mandate counts only with the principal's signature, under the pinned domain | 3, for whoever runs `verify` (the signer of T-434, a counterparty that checks) | `verify` recovers the signature over the message it rebuilds | `mandate.test.ts`: another signer, a changed field, another chain or rules contract |
| A delegation stays inside its mandate | 3, for whoever runs `verify` | `verify --mandate` compares role, cap, club, expiry, principal and agent | `mandate.test.ts`: each field widened in turn |
| A revocation ends only its own principal's mandate | 3, for whoever runs `verify` | `verify --mandate` compares the principal and the agent | `mandate.test.ts`: a revocation signed by a key that names itself as principal |
| Crow's mandate at an operator | 5, written only | Nothing: operators check the faucet's mandate, and `POST /v1/agents` answers 501 | none: stated, not enforced |

## Out of scope

- Posting a mandate or a revocation to an operator; ADR-0038 steps 4 and 5.
- The signed hash of `constraints.md` (a plain `personal_sign` message): the design names it; the signer (T-434) prints the rules file's SHA-256 for it.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff

**Owed before the proof run:** a review by a model of another family of the unattended payment path, the operator-fee message, the signatures collected before a stop and the delivery signature (design, "The build, in order"). It needs a key of Rafa's, so this session cannot run it.
