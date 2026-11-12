# T-377: A deal is judged under the policy it bound, across builds and deploys

- **Lane:** judgment (with the test lane's runner step and the demo lane's notice and deploy guard)
- **Phase:** 2
- **Depends on:** T-373 (ADR-0036, D65), T-372 (PR 389), PR 393
- **Paths this task may touch:** `packages/judgment/src/`, `apps/adjudicator/src/`, `apps/adjudicator/scripts/mutants.mjs`, `packages/testkit/src/`, `fixtures/`, `apps/demo-cloud/src/world.ts`, `apps/demo-cloud/scripts/`, `apps/demo-cloud/src/deploy-preflight.test.ts`, `scripts/deploy-lib.mjs`, and the docs ADR-0036 names: `docs/judgment-and-defenses.md` (policy binding), `docs/neutrality.md` (maintainers' row, residuals), `docs/operations.md` (deploy steps), `docs/team.md` (one row in Rules and checks)
- **Human gate:** no for the build; the first deploy that carries `screen-0` and `screen-1` together is Rafa's
- **Status:** done (PR 395, `c842495`; PR 397, `152afcf`)
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

PR 1 merged on 2026-11-12 as PR 395, merge commit `c842495`, after one review (PASS, no blocking findings, 6 Lows) and green CI.

**PR 2: the notice, the world's registries, the deal guard and the docs.**

- **`neutrality.notice-before-delivery`** [measured, `pnpm exec vitest run apps/demo-cloud/src/notice.test.ts`, 8 of 8]: a Held deal, read on both nodes of a world restarted on a build that withdrew `screen-1`, says "The primary adjudicator … cannot judge this deal: this build withdrew screen screen-1 (D-test: …)", that the fallback cannot judge it either, the judgeBy and fallbackBy times, what the default outcome pays on SimChain, and that the parties can settle first. A second restart shows it again. The text tests cover the primary, the fallback, an unknown fallback (another operator's), an escalation, an open appeal, and a closed deal (no notice).
- **The guard** [measured, `pnpm exec vitest run apps/demo-cloud/src/deploy-preflight.test.ts`, 24 of 24]: it passes a clean deploy, refuses one that drops a screen or a registry an open deal binds (naming the deal, its state and next deadline), refuses a new default the live build lacks and passes the second of the two deploys, warns and goes on when the deals cannot be read, honours the override for its named withdrawal only and refuses an override the file does not record, skips a deal the live build cannot judge either, reports an unknown policy, and handles a live build from before `kept-policies.json`. `notice.test.ts` runs `readOpenDeals` against a served world: it lists the Held deal with its policy and registry hashes, and the decision refuses a build that drops its screen.
- **Three existing tests changed, with no change of intent** [measured]: `worker.test.ts` "a stuck case slows down …" and "an overdue alarm …", and `world.test.ts` "a pass that changes nothing …", made a stuck deal by restarting the world with live judges, which changed the registry. With this change the restarted world carries the earlier registry and judges the deal, so the deal was Released. They now accept the deal under the live registry and restart without its keys, which no provider then reaches. "a stuck case" also checks that the notice shows before judgeBy, where it used to check for the fallback's declined turn after it.
- **Suite** [measured]: `pnpm test` 3,404 passed, 184 skipped, 0 failed; `pnpm snap` 44 passed; `pnpm typecheck`, `pnpm lint` and `node site/build.mjs && node site/check.mjs` pass.

**Red team** (one pass on the whole T-377 diff, 2026-11-12, without my conclusions): 1 High, 6 Medium, 7 Low. All High and Medium findings are fixed in this PR:
- **H1, fixed:** a seller's own primary could bind a deal to the placeholder registry, and a live Crow fallback would accept the work with scripted judges and no model run (measured by the red team). The live world now carries no registry but its own (`judges.ts`); `attack.live-world-binds-scripted-registry` checks it.
- **M1, fixed:** the replay's deliveries were ASCII, so a change to shared normalization (the red team widened `EMOJI_TAG_SEQUENCE` to 64 tag characters) left every check green. Two read paths were added: `unicode` (tag-smuggled text, zero-width and bidi marks, fullwidth, variation selectors, confusables, combining marks) and `cells` (CSV formula cells). With the red team's mutation applied, the replay now fails on both screens' `unicode` path [measured: 2 failed; 19 of 19 pass after reverting].
- **M2, fixed:** a Released or Refunded deal still inside its appeal window counted as closed. `rolesAhead` and `readOpenDeals` now count it, and the notice says an appeal would go unheard.
- **M3, fixed:** the guard counted every registry the data file keeps. It now counts only the registries the live adjudicators use, since a deploy keeps the secrets.
- **M4, fixed:** on the first deploy, a failed read refused with a false "new default" reason. It now warns and goes on.
- **M5, fixed:** the notice called an outside primary able to judge. It now says that is unknown.
- **M6, fixed:** a deal accepted under an earlier set of non-version policy fields was "not checked". `kept-policies.json` now lists every released set (`policyParams`), with a static test that the current default's is listed. The guard indexes them and refuses a deal at this operator's primary that it still cannot index.
- **Lows, partly fixed:** the notice now says anyone can apply the default outcome from the deadline, rather than that it "applies" then; `Disputed`, not a core state, left the guard's list. The rest are in the Handoff.
- **One anvil test changed its expected text** (`registration.anvil.test.ts`): the read-time notice replaced the declined-turn notice for an appeal under another registry, and it says the same with the adjudicator's name.
- **Checks after the fixes** [measured]: `pnpm typecheck`, `pnpm lint` and `pnpm snap` (44 passed) pass. In the full `pnpm test`, 7 tests timed out at a load average of about 100 (`uptime`); each of their files passes alone (262 of 262, and `packages/judgment` 576).

## Decisions

1. **A template pair is carried whole.** The two hashes must name one kept pair; a first-instance template from one pair and an appeal template from another is not carried. Only one pair exists today.
2. **"Not carried" and "withdrawn" stay `policy_mismatch`** (and `registry_mismatch` for a registry), with distinct wording: "this build does not carry screen screen-0" and "this build withdrew screen screen-0 (D…: reason)". The hash mismatch keeps "policy-hash-mismatch". No new problem type, so no schema change.
3. **A build configured with a default its code does not carry still accepts offers;** only a withdrawn default declines them. Tests model an outside build that way, and the static check (`keptConsistency`) keeps Crow's own default carried.
4. **A registry is carried when the build is given it with a provider** (`keptRegistries`) and the data file does not mark it retired or withdrawn. The data file lists each registry by hash and file, and a test checks each file still hashes to its recorded hash, so editing a registry file in place fails CI.
5. **The runner models one build for all three adjudicators,** as Crow's three ship in one build (ADR-0036 section 3), and records a restart as an outage of each, so a `neutrality.*` fixture can name the restarted adjudicator as the actor that fails.
6. **The notice comes before the declined-turn and waiting notices** in the state read, since it is computed from the terms and says what follows for every role still ahead.
7. **The world carries only the registry it has real judges for** (red team H1). A live world that carried the placeholder registry with its scripted judges let a seller bind a deal to it through its own primary and have a Crow fallback accept the work with no model run. So adding or removing the live judges' keys still orphans a deal bound to the other registry; the guard assumes a deploy keeps the secrets, and `docs/api.md` says when to change them.
8. **The guard runs after the build,** which compiles core's `policyHash`, and before any upload. It reads the live build's kept file with `git show <commit>:apps/adjudicator/src/kept-policies.json`; for a commit from before the file it takes the live registrations' versions as what that build carries.

## Handoff

**Done.** PR 395 (`c842495`): the kept versions, the "carried" binding, the registry by hash, the runner's restart step, the record replay and five fixtures. The second PR (397): `cannotJudge`, the read-time notice, the deal guard, the docs and the red team's fixes. The world still carries only the registry it has real judges for (red team H1). Nothing is deployed.

**The first deploy that carries `screen-0` and `screen-1` together** is Rafa's gate (a kind 8 change). It changes no default: the new build's default is still `screen-1`, the template pair and `agg-3`, so each demo adjudicator registers the same policy hash as today [inferred from `kept-policies.json` and `defaultPolicy`]. The steps:

1. From the main checkout at the merge commit of the second PR, with a clean tree: `pnpm demo-cloud:deploy`. No `HOLDBACK_DEPLOY_WITHDRAWN`.
2. The guard runs after the build. The live build's commit predates `kept-policies.json`, so the guard reads `git show <commit>:apps/adjudicator/src/kept-policies.json`, finds no file, and takes the live registrations' versions as what the live build carries: `screen-1`, the one template pair, `agg-3` and the live registry. The new default is among them, so the default check passes. Every open deal binds `screen-1` (or, if it was accepted before PR 386's deploy, `screen-0`, which the live build cannot judge and the new build can). So the guard should print one line and go on [inferred from the guard's tests, not run against the live service]:
   `Deal guard: N open deals at the demo adjudicators checked against the new build's kept-policies.json; none would lose its judge.`
   It prints `WARNING: the open deals could not be read (…)` instead if a public read fails, and goes on. It prints `WARNING: deal … binds policy …, which neither build registered; not checked.` for a deal an outside primary accepted. It exits 2 before any upload if anything is orphaned, which would mean a bug: stop and read the listed deals.
3. The script then uploads holdback-op1 and holdback-op2, waits for `/v1/status` and for both nodes' discovery to name the commit (about five minutes on 2026-11-12, T-370), and runs the smoke deal.
4. **What the smoke check should show:** the `examples/try.ts` deal ends Released within 180 s, as on every deploy. Then, by hand: `GET https://api.crow.direct/v1/adjudicators` lists the three demo adjudicators with the same `policyHash` as before the deploy; `GET https://api.crow.direct/v1/commitments/<id>` for an open deal shows no "cannot judge" notice. A deal still open from before PR 386's deploy (bound to `screen-0`) is judged on its next pass, where today it is refused.
5. Paste the record line into `docs/operations.md`. On a failure after the upload the script rolls back as before (no override is set).

**Later default changes** ship in two deploys: first a build that adds the version to the code and to `kept-policies.json`, then one that changes `default`. The guard refuses the second one if the live build does not carry the new default yet.

**Lows, not fixed** (review and red team; for the triage file):
- Red team: the prepare notice for a policy naming a superseded version (ADR-0036 §3) is not built; `cannotJudge` errors show as "can judge"; `cannotJudge` leaves out the consent checks `declines` runs (untrusted appeal adjudicator, windows, fee); the SimChain payout wording uses the current club's rate, not the deal's club; the guard reads only the first node's commit.
1. `packages/testkit/src/render.ts`: the Input row names `config/judges.yaml` for any registry hash, so `neutrality.deploy-changes-registry.expect.md` labels the live registry's hash with that file name (review Low 1).
2. The scenario fixtures deliver a file both screens pass, so their "judged under screen-0" line shows the bound policy, not a screen-0-only result; the service test with a delivery only `screen-0` flags proves it ran (review Low 2).
3. The runner models retired and withdrawn marks only for registries; the service tests cover withdrawn versions (review Low 5).
4. No mutant for the seat check reading the default registry, or for a template-pair match that ignores the appeal hash (review Low 6; unit tests cover the second).
5. ADR-0036's "Not decided here": judging twice after a restart (the judged records are in memory), a public read of a policy by its hash, a fifth policy field.

**Records left as they are:** D65's "Until then" line in `docs/decisions-today.md` and ADR-0036's "Until the build lands" are dated records; the guard replaces the stopgap in `docs/operations.md` and `docs/api.md`. ADR-0036 stays Proposed until Rafa accepts it.

