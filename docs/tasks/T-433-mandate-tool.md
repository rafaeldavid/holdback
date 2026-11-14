# T-433: the mandate tool

- **Lane:** demo (Crow's own agents, roadmap row N131, build row 2)
- **Phase:** 2
- **Depends on:** ADR-0038 and D69 (Rafa's answers of 2026-11-14); the own-agents design in crow-private (`company-ops/own-agents/design.md`, decisions 1 to 6 taken by Rafa on 2026-11-14)
- **Paths this task may touch:** `examples/mandate.ts`, `examples/mandate.test.ts`, one paragraph in `site/ref/limits.txt`, this file
- **Human gate:** no (nothing is deployed by this task; the site deploy after merge follows the wave's "merge and deploy when ready" rule)
- **Status:** review
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

- [x] `mandate`, `delegation` and `revocation` write one typed-data file each, with a fresh random nonce, and print its digest and one sentence of what it grants or ends. No argument takes a private key.
- [x] The files hash, under the pinned domain, to the digest `@holdback/core`'s `messageDigest` gives for the same message (the encoding the operators use).
- [x] `verify` accepts a correctly signed file and prints the signed document in its schema's form (`mandate.schema.json`, or the message schema) with the digest. The test validates that form with Ajv against `spec/schemas/`.
- [x] `verify` refuses, naming the reason: a principal other than the one `--principal` expects; a delegation checked without its mandate; a high-s twin of a signature; a file that names a key twice; a signature by another key; a changed field; another domain (chain or rules contract); an unknown type or an extra field; an expired mandate or delegation; a delegation wider than its mandate (role, cap, club, expiry, principal or agent); a revocation by another principal than the mandate's. Exit status 3 on a refusal.
- [x] Only Ethereum Sepolia (11155111) and a local chain (31337) are pinned; a mainnet chain ID in `HOLDBACK_DEPLOYMENT` is refused.
- [x] One paragraph in `site/ref/limits.txt` says what the tool does and what it does not (it enforces nothing; an operator takes no company mandate today).
- [x] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## The constraints this task touches

| Constraint | Rung | What enforces it | The attack that fails |
| --- | --- | --- | --- |
| The principal's key is on no machine the tools run on | 1, by construction | The tool takes no key: it writes the message and checks a signature | `mandate.test.ts`, "takes no key": every command's arguments are scanned for a 32-byte hex value, and none is read from the environment |
| A mandate counts only with the principal's signature, under the pinned domain | 3, for whoever runs `verify` with `--principal` (the signer of T-434 pins it in its rules; a counterparty that checks) | `verify` recovers the signature over the message it rebuilds and compares the principal with the one expected | `mandate.test.ts`: another signer, a changed field, another chain or rules contract, a self-minted mandate under `--principal` |
| Without `--principal`, `verify` shows only that some key signed | 4, soft | Nothing: the output says `principalChecked: false` and the sentence asks for `--principal` | none: stated |
| A delegation stays inside its mandate | 3, for whoever runs `verify` | `verify --mandate` compares role, cap, club, expiry, principal and agent | `mandate.test.ts`: each field widened in turn |
| A revocation ends only its own principal's mandate | 3, for whoever runs `verify` | `verify --mandate` compares the principal and the agent | `mandate.test.ts`: a revocation signed by a key that names itself as principal |
| Crow's mandate at an operator | 5, written only | Nothing: operators check the faucet's mandate, and `POST /v1/agents` answers 501 | none: stated, not enforced |

## Out of scope

- Posting a mandate or a revocation to an operator; ADR-0038 steps 4 and 5.
- The signed hash of `constraints.md` (a plain `personal_sign` message): the design names it; the signer (T-434) prints the rules file's SHA-256 for it.

## Evidence

All measured on 2026-11-14 in `.worktrees/holdback-own-agents-mandate`, branch `t-433-mandate-tool`, unless labelled.

- `npx vitest run examples/mandate.test.ts`: 22 passed. They include:
  - every kind's digest equals `@holdback/core`'s `messageDigest`, under the Sepolia and the SimChain domains, with and without categories;
  - a mandate the operators' own faucet signs, read from `GET /v1/agents/<address>` on the demo world, verifies;
  - the signed documents pass Ajv strict against `spec/schemas/` (`mandate.schema.json`, `messages.schema.json#/$defs/Delegation` and `AgentRevocation`);
  - each attack in the criteria above is refused with its reason, each beside a control that passes.
- `pnpm typecheck`: 0 errors. `npx eslint examples/mandate.ts examples/mandate.test.ts`: 0 problems.
- `node site/build.mjs && node site/check.mjs`: PASS. `tests/site-guides.test.ts` and `tests/guide-budget.test.ts`: 17 passed.
- The pinned bundle, before (`origin/main` `02506766`) and after this branch: `site/buy.mjs` SHA-256 `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, `site/try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`. Unchanged.

### Reviews (PR 552)

The `reviewer` agent and the `red-teamer` agent read `CLAUDE.md`, ADR-0038, `docs/neutrality.md`, the design and the diff. Neither found a way to make `verify` accept a message the named key did not sign. Verdicts: ISSUES, no Critical or High finding.

| Finding | Severity | What changed |
| --- | --- | --- |
| Red team M-1: `verify` shows that some key signed, not that Crow's principal did; a self-signed delegation passed without its mandate | Medium | `--principal` (and `principal` in the library) pins the principal; a delegation needs `--mandate`; the output says `principalChecked`; a revocation that ends the mandate prints `revokesMandate` |
| Red team M-2: a real revocation with a time past year 9999 threw an error that reads as "not revoked"; offsets and zero fractions were refused | Medium | Such a revocation throws `RevocationUnreadable`, for a caller to treat as a stop (T-434 does); any RFC 3339 time on a whole second verifies and prints in UTC |
| Review 1: no test against the core's digest for every kind | Medium | A test hashes all three kinds against `messageDigest` |
| Review 2: no evidence in this file | Medium | This section |
| Review 3: the digest is not what a hardware wallet shows when it cannot display the fields | Medium | Each command also prints the domain hash and the message hash |
| Review 4: `--mandate` took only the bare document | Medium | It takes what `verify` printed, too, with a command-line test |
| Low: `in` lookup, exit 1 on unreadable times, `0X` key prefix, token case, categories unnamed, the `limits.txt` wording, a self-contradicting message, the `--days` cap, malleable signatures, terminal escapes, duplicate keys, wrong reasons for wrong types, the domain pin only in `pinFor` | Low | Each fixed: `Object.hasOwn`; refusals exit 3; the key guard is case-blind and trims; tokens compare exactly unless both are addresses; the sentence names categories as unchecked; the paragraph is rewritten; `--expires-at` for a mandate; high-s refused and `v` 0 or 1 read as 27 or 28; free text shown printable; duplicate keys and `__proto__` refused; type checks before patterns; `verifyDocument` checks the domain itself |

Not changed: a 43-character base64url `dealEncryptionKey` could be a private key pasted by mistake; it has the shape of a public key, so the tool cannot tell (inferred).

## Decisions

- The tool pins its own copy of `Mandate` and `AgentRevocation`; `verify.ts` pins the shared types. The core's digest is the test (not the build), so the buyer's pinned bundle stays untouched.
- `LAST_TIME` is 9999-12-31T23:59:59Z, the last second a UTC timestamp can show. The core can also express a time up to 23:59 hours later with an offset; a revocation past `LAST_TIME` is unreadable to this tool and so a stop to the signer.

## Handoff

Done: the tool, its tests and the `limits.txt` paragraph. The site needs a deploy for that paragraph (the coordinator's, or this session's under the wave's rule).


**Owed before the proof run:** a review by a model of another family of the unattended payment path, the operator-fee message, the signatures collected before a stop and the delivery signature (design, "The build, in order"). It needs a key of Rafa's, so this session cannot run it.
