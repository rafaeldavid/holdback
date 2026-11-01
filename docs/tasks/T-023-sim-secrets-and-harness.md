# T-023: Sim worlds stop publishing secrets; harness fixes from batch 1

- **Lane:** test + api
- **Phase:** 1 (exploration tooling)
- **Depends on:** T-021
- **Paths this task may touch:** `apps/operator/src/sim-world.ts`, `apps/operator/src/sim-world.test.ts`, `apps/operator/src/sim-bin.ts`, `tools/sim/` (all), `docs/quickstart.md` (only the sim-service section), `docs/testing.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer (Opus 5.5), worktree `agent-ac7754cae5ca1e609`

## Intent

Batch 1 (`docs/reviews/2026-11-01-sim-batch-1.md`, F1) found that `GET /` on the sim service returns every account's private signing key and encryption secret key. In a multi-party T-021 world that lets any party sign as its counterparty, which voids adversarial runs. Make the multi-party worlds keep each party's secrets private, and fix the small harness gaps the batch hit.

**Restated (implementer, 2026-11-01).** A simulated run is only a test of the protocol if each party can sign only as itself. Today the sim service hands every account's signing and encryption secret keys to anyone who asks `GET /`, and in any case the keys derive from labels anyone can guess (`sim-run/<run-id>/<party>`). So: give `startSimWorld` a `publishSecrets` option; when it is off, no public sim route (the info document, the clock, controls, errors) carries a secret key, a fresh account from `POST /accounts` carries its keys only in that one response, and keys stop being recomputable from public labels. `tools/sim` worlds turn it off; each party still gets its own keys from its brief. The single-developer `pnpm sim` keeps listing keys, because there every account belongs to the one developer. Alongside: `mail.ts read --out <file>` saves a body byte for byte, and the README and brief say what the sim service now serves and that fake judges never suspect injection and pass any rubric without the fail marker.

Non-goals: access control on `/advance`, `/accounts` or `/adjudicators` (briefs forbid them); hiding `world.json` from subagents (a brief rule, as before); smarter fake judges (F3); anything in `examples/`, `prepare.ts` or `docs/api.md` (T-024, T-025).

## Context

- `docs/reviews/2026-11-01-sim-batch-1.md` (F1, F5 mail item, model notes).
- `apps/operator/src/sim-world.ts` (`accountView`, `SimInfo.accounts`, `POST /accounts`), `tools/sim/world.ts` (how party keys reach `world.json` and briefs).
- The single-developer `pnpm sim` (T-020 quickstart) prints the developer's own test keys; keep that convenient, but decide whether its `GET /` should still list keys for every account. Parametrize, don't hardcode (D31): an option on `startSimWorld`.

## Acceptance criteria

- [x] `startSimWorld` takes an option (for example `publishSecrets`) that controls whether `GET /` and any other public sim route include private or encryption secret keys. `tools/sim` worlds set it off. A test shows a T-021 world's sim service serves no secret key on any route (`/`, `/accounts` reads, `/clock`, errors).
- [x] `POST /accounts` in a T-021 world still hands a fresh account (with its keys) only to the caller who asked; it never lists other accounts' secrets.
- [x] Parties still get their own keys through their brief (unchanged), and `world.test.ts`'s forbidden-strings check also scans every sim-service route's output for other parties' secrets.
- [x] `bin/mail.ts read` can write a message body to a file (`--out <file>` or raw body output), so a party does not transcribe a signed offer by hand.
- [x] The README's "Limits" section and the brief's sim-endpoint description match the new behaviour, and say plainly that fake judges never suspect injection and pass any rubric without the fail marker.
- [x] `pnpm verify` green.

## Out of scope

- Access control on the sim's `/advance` and `/adjudicators` controls (briefs forbid them; noted in the README).
- Making fake judges smarter (F3 needs live judges, not a better stub).

## Evidence

- **Measured.** Test first: before the implementation, the five new tests failed (`vitest run apps/operator/src/sim-world.test.ts tools/sim/world.test.ts`: 5 failed, 20 passed). The failing `GET /` body of a T-021 world showed all four parties' `privateKey` and `encryptionSecretKey`.
- **Measured.** After: the same files plus `examples/` pass, 42 of 42.
- **Measured.** `sim-world.test.ts`, "a sim world that keeps secrets": with `publishSecrets: false`, `GET /`, `GET /clock`, `GET /accounts`, `GET /accounts/0`, `POST /advance` (bad and good), a bad `POST /adjudicators/appeal`, an unknown route and `POST /` contain neither account's signing key (with or without `0x`) nor encryption secret key; `GET /` lists exactly `label, address, balance, encryptionPublicKey` per account and a "not published" note; `testAccount(label)` gives neither a named nor a spare account's address or public key; two `POST /accounts` calls return different accounts, the second response and a later `GET /` contain none of the first's secrets, the handed-out key signs for its address, and the address is funded (10,000 tUSD) per an operator.
- **Measured.** The default world (`pnpm sim`) still serves `buyer-1`'s signing key on `GET /`.
- **Measured.** `world.test.ts`: a T-021 world's sim service returns no party's secret on `GET /`, `/clock`, `/accounts`, `POST /accounts`, bad `/advance` and `/adjudicators/primary`, `/world.json` and `DELETE /`; `GET /` lists every party's address and no `privateKey`. The rendered brief contains "never suspect injection", "serves no secret key" and `--out <file>`, and still none of the other parties' keys, the audit URL or `FAIL-ME`.
- **Measured.** `readMessage(..., { out })` writes the body byte for byte (a multi-line JSON body with quotes) and prints the headers with `bodyFile` and no `body`. By hand, `node tools/sim/bin/mail.ts send` then `read --out <file>`: `cmp` reports the files identical; `read --out` with no file prints usage and exits 2.
- **Measured.** `pnpm verify`: PASS (typecheck, lint, test 2044 of 2044 in 75 files, spec, snap with no snapshot diffs, demo); report `reports/verify-t-023-sim-secrets.md`.
- **Inferred.** Mandates don't leak the salted label: the principal key now derives from the salted label too, and the mandate nonce is a hash. I checked the operator's agent and mandate reads in code; no test covers this.
- **Guessed.** Batch 2 parties will no longer report a key leak; to be confirmed by the batch.

## Decisions

- `publishSecrets` defaults to `true`. `pnpm sim` passes it explicitly, and every account there is the one developer's, so `GET /` keeps listing keys as T-020's quickstart assumes. `tools/sim` worlds pass `false` (D31: an option, not a hardcoded behaviour).
- Without `publishSecrets`, keys derive from the label plus a 32-byte random secret per world that is never served, for named accounts, spares and mandate principals alike. Hiding the keys alone would not help: before, anyone could recompute `testAccount('sim-run/<run-id>/<party>')`. Labels stay in `GET /` because they no longer give a key.
- `SimWorld.info` keeps every key (in-process: the world's starter holds them all, and `tools/sim/world.ts` writes them to `world.json`). The new `SimWorld.published` is exactly what `GET /` serves. `SimInfo`'s type is unchanged, so `examples/` compiles untouched.
- `POST /accounts` still returns the spare's keys, to the caller only. Gating who may call it is access control, which is out of scope.
- `mail.ts read --out <file>` writes the raw body and prints the headers with `bodyFile` in place of `body`. I didn't add a separate raw-output mode, since one way is enough.
- The brief now says fake judges never suspect injection and a panel passes any rubric. It still doesn't name the fail marker: briefs keep sim internals out (`world.test.ts` forbids `FAIL-ME`).
- No ADR: sim tooling only; no schema, contract or defense change.

## Handoff

- Done on branch `t-023-sim-secrets`. Batch 2 (adversarial runs) can start once this merges.
- Still open, recorded in the README Limits: the sim service has no access control on `/advance`, `/accounts` or `/adjudicators`, and `world.json` (every party's keys) is readable by any subagent. Briefs forbid both, and `sim:check` doesn't detect a party that ignores this.
- `docs/quickstart.md`: one sentence in the sim-service paragraph. If T-025 rewrites that paragraph, keep the sentence about `GET /` listing keys only in `pnpm sim`.
