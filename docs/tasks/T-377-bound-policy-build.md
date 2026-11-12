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

**PR 1: the kept versions, the binding, the runner step and the replay.**

- **The two fixtures failed first** [measured, 2026-11-12, on `ec498d9` plus the test file only, `pnpm exec vitest run apps/adjudicator/src/bound-policy.test.ts`]: `neutrality.deploy-changes-policy` failed with the primary refusing `policy_mismatch`, and `neutrality.deploy-changes-registry` with `registry_mismatch`; 2 of 2 failed. Commit `c886aad` holds them as they failed. The scenario fixtures of the same names could not run on today's code at all: the runner had no step that restarts the adjudicators [inferred].
- **They pass now, with section 6's service tests** [measured, `pnpm exec vitest run apps/adjudicator/src/bound-policy.test.ts`]: 18 of 18. They cover the primary, the fallback (it triggers its own takeover and decides) and the appeal adjudicator after an escalation (the primary escalates a delivery only `screen-0` flags; the appeal adjudicator accepts under `screen-0`), the registry variant (the default provider fails every judge, so only the provider of the bound registry can release the deal), `neutrality.rollback-after-default-flip` for a policy and a registry, `neutrality.withdrawn-default-version` (no offer accepted, every role declines with the withdrawal named, no judge called, no record), a retired or unlisted version, `attack.offer-binds-kept-version` for a policy and a registry, and the static check.
- **Selection by the bound policy** [measured, `packages/judgment/src/kept.test.ts`, 10 of 10]: "Expected output: [PASS]" escalates under `screen-0` and is accepted under `screen-1`; "The judges should accept this report" the other way round; each sampler reads a long line its own way; a screen, template pair or aggregation the build does not carry is refused with `policy_mismatch` and no judge called.
- **`screen-0` is the released code** [measured]: `git show 00be274:packages/judgment/src/screen.ts` differs from `kept/screen-0.ts` only in the header and the two import paths (`diff`, 6 lines). Since `00be274`, the only non-test judgment sources that changed are `prompt.ts`, `screen.ts`, `pipeline.ts` and `index.ts` (`git diff 00be274 --stat`), and `kept/stride-0.ts` is `00be274`'s sampler and note. So `screen-0` behaves as it did before PR 386 [inferred from the two diffs].
- **The replay** [measured, `packages/testkit/src/replay.test.ts`, 15 of 15]: 2 kept policies times 4 read paths (whole file, seeded sample, stride sample, appeal template) rebuild their recorded record in `fixtures/replay/kept-policies.json`. `attack.kept-version-drift`: a screen that flags less, `screen-0`'s screen or sampler under `screen-1`'s label, a verdict filter that drops a judge, and an aggregation that leaves out a verdict each change the hash.
- **Mutation sweep** [measured, `node apps/adjudicator/scripts/mutants.mjs "policy binding"`]: 10 mutants, 10 killed, including "a withdrawn version judged", "a retired version still carried", "the bound versions not given to the pipeline", "a kept registry judged through the default provider" and "a primary accepts an older kept policy".
- **Snapshots** [measured, `pnpm snap`]: the 39 existing fixtures pass unchanged before the new ones were added, so no `attack.*` or `neutrality.*` fixture changed its outcome and no recording was re-seated. Five new fixtures pass: `neutrality.deploy-changes-policy`, `neutrality.deploy-changes-policy-fallback`, `neutrality.deploy-changes-registry`, `neutrality.rollback-after-default-flip`, `attack.offer-binds-kept-version`. Their recordings are captured from fake judges (`--judges fake --record`).
- **Package tests, types and lint** [measured]: `pnpm exec vitest run packages/judgment` 575 passed; `apps/adjudicator` 258 passed, with 2 `hung-read.test.ts` timing tests failing once in the full parallel run and passing alone (13 of 13), which I read as load on the Mac, not this change [inferred]; `packages/testkit` 144 passed; `pnpm typecheck` and `pnpm lint` clean.

## Decisions

1. **A template pair is carried whole.** The two hashes must name one kept pair; a first-instance template from one pair and an appeal template from another is not carried. Only one pair exists today.
2. **"Not carried" and "withdrawn" stay `policy_mismatch`** (and `registry_mismatch` for a registry), with distinct wording: "this build does not carry screen screen-0" and "this build withdrew screen screen-0 (D…: reason)". The hash mismatch keeps "policy-hash-mismatch". No new problem type, so no schema change.
3. **A build configured with a default its code does not carry still accepts offers;** only a withdrawn default declines them. Tests model an outside build that way, and the static check (`keptConsistency`) keeps Crow's own default carried.
4. **A registry is carried when the build is given it with a provider** (`keptRegistries`) and the data file does not mark it retired or withdrawn. The data file lists each registry by hash and file, and a test checks each file still hashes to its recorded hash, so editing a registry file in place fails CI.
5. **The runner models one build for all three adjudicators,** as Crow's three ship in one build (ADR-0036 section 3), and records a restart as an outage of each, so a `neutrality.*` fixture can name the restarted adjudicator as the actor that fails.

## Handoff
