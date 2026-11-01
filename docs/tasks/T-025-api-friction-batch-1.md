# T-025: API and docs friction from sim batch 1

- **Lane:** api
- **Phase:** 1
- **Depends on:** T-015, T-020
- **Paths this task may touch:** `apps/operator/src/server.ts`, `apps/operator/src/prepare.ts` (except the agree-and-fund and early-accept check text, which T-024 owns), `apps/operator/src/*.test.ts`, `spec/openapi/paths.json` and the generated `spec/openapi.json`, `examples/sign.ts`, `examples/verify.ts` (agree-and-fund intent only; T-024 owns early-accept), `examples/*.test.ts`, `examples/package.json`, `docs/api.md`, `docs/quickstart.md`, `docs/backlog.md` (rows)
- **Human gate:** no
- **Status:** todo
- **Agent/session:** —

## Intent

Batch 1's eight agents (`docs/reviews/2026-11-01-sim-batch-1.md`, F3 to F5) settled every deal, but each lost time or money to the same rough edges. Remove the ones that are API behaviour, and write down the ones that are knowledge an outsider cannot guess. Coordinate with T-024, which runs in parallel and owns the early-accept and agree-and-fund check text in `prepare.ts` and the early-accept intent in `verify.ts`.

Restate this in your own words in this section before writing code.

## Acceptance criteria

API behaviour:
- [ ] `?validateOnly=true` accepts the exact body prepare returned, including `"signature": null` (or prepare omits the field); the dry run documents which one. Contract test covers it.
- [ ] Prepare for early-accept, appeal and settlement refuses (or warns in `check`) when the commitment's current state cannot take that submit, as agree-and-fund already does.
- [ ] The commitment read (`GET /v1/commitments/{id}`) exposes the signed terms (or a documented link to them), so a buyer compares against the operator's copy, not only the mailed body. If that is a schema change, follow the contract rule (ADR plus version bump) or record why not in Decisions.
- [ ] The agree-and-fund intent in `verify.ts`/`sign.ts` can carry the expected price (and optionally the full expected terms hash); a price raised within `maxTotal` is refused when given.
- [ ] Missing `id` on `POST /v1/commitments` returns a problem detail that says how to compute it.

Docs (`docs/api.md`, `docs/quickstart.md`):
- [ ] Escalation: what triggers it, that the appeal adjudicator's decision is final at once with no appeal window, and how D27a decides a flagged deal.
- [ ] What a screen flag does on a checks-only deal (nothing changes the outcome unless the terms say so; dispute clauses come later, D29).
- [ ] Writing checks that resist a seller doing the minimum: email pattern with a dot in the domain, distinct values, value ranges, per-column regex on the key column; with a worked example.
- [ ] Appeals: when one can succeed (D28: show the work fails the terms), what it costs relative to the price, and that a checks-only appeal re-runs the same checks.
- [ ] `Released` is not final until the appeal window passes; `Delivered` may never be visible to a poller; the commitment `id` and how to compute it; the `appellant` prepare input; what `commitment.agreed` contains and which signatures are public; the judgment record's shape (link the schema); who should call `expire-offer` and why it matters (reserved bond).
- [ ] Running the examples from another directory (dependency resolution), or a one-line way to import them.
- [ ] `pnpm verify` green; `pnpm openapi` regenerated if paths changed.

## Out of scope

- Negotiable dispute clauses (D29, after the demo); advisory sanity warnings (backlog).
- Anything T-024 owns.

## Evidence

## Decisions

## Handoff
