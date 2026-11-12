# T-377: A deal is judged under the policy it bound, across builds and deploys

- **Lane:** judgment (with the test lane's runner step and the demo lane's notice and deploy guard)
- **Phase:** 2
- **Depends on:** T-373 (ADR-0036, D65), T-372 (PR 389), PR 393
- **Paths this task may touch:** `packages/judgment/src/`, `apps/adjudicator/src/`, `apps/adjudicator/scripts/mutants.mjs`, `packages/testkit/src/`, `fixtures/`, `apps/demo-cloud/src/world.ts`, `apps/demo-cloud/scripts/`, `apps/demo-cloud/src/deploy-preflight.test.ts`, `scripts/deploy-lib.mjs`, and the docs ADR-0036 names: `docs/judgment-and-defenses.md` (policy binding), `docs/neutrality.md` (maintainers' row, residuals), `docs/operations.md` (deploy steps), `docs/team.md` (one row in Rules and checks)
- **Human gate:** no for the build; the first deploy that carries `screen-0` and `screen-1` together is Rafa's
- **Status:** in progress
- **Agent/session:** T-377 implementer session, 2026-11-12

## Intent

Today a deploy that changes the screen, the prompt templates, the aggregation or the judge registry leaves every open deal without a judge: the primary, the fallback and the appeal adjudicator each refuse a deal accepted before the deploy, and the deal runs down to its default outcome. ADR-0036 fixes that by making a build keep every version a released build registered.

What this task builds, in my words:

- **A build carries versions, not one version.** The judgment package keeps a table of screen versions (with the sampler each one reads a long delivery with), template pairs and aggregation versions. `screen-0` comes back from commit `00be274` as a frozen file. The pipeline runs the implementations the deal's bound policy names.
- **A kept version cannot drift.** A replay rebuilds a judgment record for each kept policy, one per read path (whole file, seeded sample, stride sample), and compares it with the record kept when the version was new. A change that alters what a kept version flags or decides fails it.
- **The binding asks "carried", not "equal to my default".** The adjudicator reads a kept-policies data file with retired and withdrawn marks, judges under the bound policy and the bound registry (by hash, with the provider that reaches its models), and as primary still accepts only its current default. A withdrawn version is declined at once and in public for every open deal that binds it, and never replaced by another version.
- **The runner can restart the adjudicators on another default,** so scenario fixtures can show a deal accepted on one build and judged on the next.
- **The world says so when it cannot judge,** in the public state read, computed at read time from the terms: which adjudicator, why, what follows and when, for the primary too.
- **The deploy refuses to orphan a deal.** Before any upload, `pnpm demo-cloud:deploy` refuses a deploy after which an open deal the live build can judge could no longer be judged, with one override scoped to a recorded withdrawal, and warns when it cannot read the open deals. A new default ships in two deploys: carried first, default second.

Non-goals: no contract, signed type, schema or API route changes; no deploy; no live model call; no public read of a policy by its hash (ADR-0036, Not decided here); the restart re-judging finding stays in the triage file.

## Context

- ADR-0036 (D65), above all "The build's task" and section 6; ADR-0035 (`screen-1`); ADR-0006 (the policy binding).
- T-373's scratch test (shared notes) and T-367's Handoff (the public reads that list open deals).

## Acceptance criteria

- [ ] The two fixtures that fail today pass: `neutrality.deploy-changes-policy` and `neutrality.deploy-changes-registry`.
- [ ] Section 6's other tests pass: `neutrality.rollback-after-default-flip`, `neutrality.withdrawn-default-version`, `neutrality.notice-before-delivery`, `attack.offer-binds-kept-version`, `attack.kept-version-drift`, the selection test (a delivery `screen-0` flags and `screen-1` passes, and one the other way round, each judged under both), and the guard's tests.
- [ ] A version the build does not carry is still refused before any judge is called; the mutation sweep's policy-binding mutants cover the new check.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm snap` and the site check pass; no existing `attack.*` or `neutrality.*` fixture changes its outcome.
- [ ] The docs ADR-0036 names say what the build now does; the stopgap sentence is replaced by the guard.

## Out of scope

- The first deploy carrying both screens (Rafa's gate), a signed refusal type, a fifth policy field, a policy read by hash.

## Evidence

Labels: measured (run here), inferred (from reading), guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics:

## Decisions

## Handoff
