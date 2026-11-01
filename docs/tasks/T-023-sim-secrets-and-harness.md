# T-023: Sim worlds stop publishing secrets; harness fixes from batch 1

- **Lane:** test + api
- **Phase:** 1 (exploration tooling)
- **Depends on:** T-021
- **Paths this task may touch:** `apps/operator/src/sim-world.ts`, `apps/operator/src/sim-world.test.ts`, `apps/operator/src/sim-bin.ts`, `tools/sim/` (all), `docs/quickstart.md` (only the sim-service section), `docs/testing.md`
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Batch 1 (`docs/reviews/2026-11-01-sim-batch-1.md`, F1) found that `GET /` on the sim service returns every account's private signing key and encryption secret key. In a multi-party T-021 world that lets any party sign as its counterparty, which voids adversarial runs. Make the multi-party worlds keep each party's secrets private, and fix the small harness gaps the batch hit.

Restate this in your own words in this section before writing code.

## Context

- `docs/reviews/2026-11-01-sim-batch-1.md` (F1, F5 mail item, model notes).
- `apps/operator/src/sim-world.ts` (`accountView`, `SimInfo.accounts`, `POST /accounts`), `tools/sim/world.ts` (how party keys reach `world.json` and briefs).
- The single-developer `pnpm sim` (T-020 quickstart) prints the developer's own test keys; keep that convenient, but decide whether its `GET /` should still list keys for every account. Parametrize, don't hardcode (D31): an option on `startSimWorld`.

## Acceptance criteria

- [ ] `startSimWorld` takes an option (for example `publishSecrets`) that controls whether `GET /` and any other public sim route include private or encryption secret keys. `tools/sim` worlds set it off. A test shows a T-021 world's sim service serves no secret key on any route (`/`, `/accounts` reads, `/clock`, errors).
- [ ] `POST /accounts` in a T-021 world still hands a fresh account (with its keys) only to the caller who asked; it never lists other accounts' secrets.
- [ ] Parties still get their own keys through their brief (unchanged), and `world.test.ts`'s forbidden-strings check also scans every sim-service route's output for other parties' secrets.
- [ ] `bin/mail.ts read` can write a message body to a file (`--out <file>` or raw body output), so a party does not transcribe a signed offer by hand.
- [ ] The README's "Limits" section and the brief's sim-endpoint description match the new behaviour, and say plainly that fake judges never suspect injection and pass any rubric without the fail marker.
- [ ] `pnpm verify` green.

## Out of scope

- Access control on the sim's `/advance` and `/adjudicators` controls (briefs forbid them; noted in the README).
- Making fake judges smarter (F3 needs live judges, not a better stub).

## Evidence

## Decisions

## Handoff
