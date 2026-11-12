# ADR-0036: A deal is judged under the policy it bound, on every later build

- **Status:** Proposed, 2026-11-12 (D65). Rafa may overrule any line. Nothing here is built.
- **Raised by:** T-373, from the finding in T-367's Handoff (PR 386). Research: this note, one scratch test that was run and not committed, and one red-team pass (last section).
- **Builds on:** ADR-0001, ADR-0006 (the policy and registry bindings), ADR-0030 section 6 (the bound policy is read by its hash), ADR-0031 (phase one: the first decision is final), ADR-0035 (the screen's second version; PR 386, open when this was written); D26, D28, D29, D31, D32.
- **Amends:** ADR-0006's policy binding. A build honours every version it keeps, where today it honours only its own.
- **Changes when built:** `packages/judgment`, `apps/adjudicator`, `packages/testkit`, `apps/demo-cloud`, `scripts/deploy-lib.mjs`, `fixtures/`. No contract, signed type, schema or API route. This record changes no code.

Labels: **measured** (read at the cited line, or run, at commit `e1e8df2`, `origin/main` on 2026-11-12), **documented**, **inferred** (from reading, not from a run), **guessed**.

## Summary

**Today an operator deploy can leave an open deal without a judge.** A deal's signed terms pin its judgment policy and its judge registry by hash. A build of the adjudicator runs one screen version, one pair of prompt templates and one aggregation version, and holds one registry. After a deploy that changes any of them, the primary, the fallback and the appeal adjudicator each refuse a deal accepted before it. No judge is called. The deal runs down to its default outcome: the buyer is refunded and a seller who delivered is not paid [measured].

**How to read this in ten minutes:** this summary, the table under "The finding", and the bold recommendation in each of the seven sections. The bullets under each are detail for the build.

**The decision, one line per question:**

1. **What a build keeps.** Every screen version, template pair, aggregation version and registry a released build ever registered, selected by the deal's bound policy.
2. **A version with a known weakness.** The adjudicator still judges an open deal under its bound policy. It withdraws a version only when running it would break a hard rule, and then it declines in public at once.
3. **Who carries which version.** The primary carries every policy it signed an acceptance for. A fallback or appeal adjudicator carries what it said it would take. Crow's three ship in one build.
4. **The deploy guard.** The deploy script refuses a deploy after which the adjudicators could no longer judge an open deal they can judge today.
5. **A deal the build cannot judge.** The public state read says which adjudicator, why, what follows and when, as soon as the terms show it.
6. **The proof.** The fixture `neutrality.deploy-changes-policy`: a deal accepted under one policy, a deploy, the deal judged under its bound policy and settled.
7. **The cost.** One frozen file of a few hundred lines per version, and one extra deploy per version change. No contract or schema changes.

## The finding

**The finding holds** [measured]. A deal accepted under an earlier policy, once the adjudicators run a build whose versions differ:

| Adjudicator | What it does today | Evidence |
| --- | --- | --- |
| Primary | Refuses every pass with `policy_mismatch` ("screen screen-prev is not screen-0"). The deal stays Delivered | Scratch test. `apps/adjudicator/src/service.ts:499-500` reads the bound policy (`:381-391`) and `apps/adjudicator/src/policy.ts:43-46` refuses it |
| Fallback | Triggers no takeover. After anyone triggers it, refuses every pass | Scratch test. `service.ts:211-218`, `:420-424`; the test at `service.test.ts:1492` |
| Appeal adjudicator, after an escalation | Refuses every pass | Scratch test. `service.ts:499`; the test at `service.test.ts:894` |
| The deal | Ends Refunded through the default outcome. No judge called, no record, no decision | Scratch test |

- **The scratch test** models the earlier build as a policy whose `screenVersion` is `screen-prev`. An adjudicator configured with it accepts the offer, since acceptance compares hashes only (`service.ts:285`). Three adjudicators on the build's default then replace it. Two tests, both pass [measured, `pnpm exec vitest run`, 2026-11-12]. The file is in the sessions' shared notes as `t-373-scratch-test.ts.txt`.
- **The store is not at fault.** It serves the earlier policy by its hash (ADR-0030 section 6). The adjudicator reads it and refuses it, because `checkPolicyBinding` compares each of four fields with the build's one constant.
- **Any of the four fields does it,** and so does the registry: an adjudicator holds one and refuses a deal bound to another (`service.ts:393-396`; tests at `service.test.ts:421`, `:1491`) [measured]. The live world's registry changes with the registry file, and when live judges are switched on or off (`apps/demo-cloud/src/world.ts:646`) [inferred].
- **The primary's refusal is silent.** The state read explains a declined turn only for the fallback and the appeal adjudicator (`world.ts:453-463`, `:1102-1106`) [inferred].
- **A rollback is the same deploy in reverse** (`apps/demo-cloud/scripts/deploy.mjs:68-77`) [inferred].
- **Code outside the four fields changes what a judge reads.** PR 386 changes how a long delivery is sampled. No template hash moves; the change travels under `screen-1` [measured, the PR's diff].

**What it breaks.** The deal still ends in an outcome its terms name. Two promises fail. `docs/neutrality.md:33` says of the maintainers: "Existing commitments run on the code and registry they were signed under" [documented]. And litmus test 3 is skipped for that deal. Crow's three default adjudicators run one build, so one deploy removes all three. In phase one nothing later corrects it.

## Decision

### 1. What a build keeps

| Option | Cost | Verdict |
| --- | --- | --- |
| Only the newest version; deploy only when no deal is open | A pilot deal open for days blocks every deploy. D31 lets a deal stay open for years, so a stranger's deal could freeze Crow's deploys | Rejected |
| A window of recent versions | A deal that outlives the window loses its judge: a cap on a deal's length that no terms state (D31) | Rejected |
| Old builds kept running, one per policy | Each keeps its old settlement and relay bugs, and needs its own keys, storage and routing | Rejected |
| **Every version a released build registered, selected by the bound policy** | One frozen file per version. Anyone can pin a version for years with one far-dated deal; the cost is those lines | **Chosen** |

**Recommendation: a build keeps every screen version, template pair, aggregation version and registry that a released build ever registered, selects them by the deal's bound policy, and retires one only by a reviewed change that shows no open deal binds it.**

- **Selection.** `checkPolicyBinding` asks whether the build carries each of the bound policy's four values, no longer whether they equal its default. The pipeline runs the implementations those values name. The registry is looked up by `registryHash`, with the provider settings that reach its models.
- **As primary, a build accepts only its current default.** That is today's rule (`service.ts:285`) and it stays. No new deal at a Crow primary binds an old version.
- **Open** means from the primary's signed acceptance until no adjudicator can decide the deal again. The build writes that as one function; the guard and the retirement rule use it.
- **Each field covers the code behind its stage:**

  | Field | The code it covers |
  | --- | --- |
  | `screenVersion` | Everything between the delivered bytes and the prompt: normalization (as `spec/schemas/adjudicator.schema.json:123-126` says), the screen, the read limit, the sampling, the rendering of the data section |
  | The two template hashes | The template text |
  | `aggregationVersion` | The verdict filter, the aggregation rule and `signedOutcome` |

  Deterministic checks belong to the terms' schema version, and panel seating to the protocol (`PANEL_VERSION`, ADR-0018). They are outside the policy and outside this record's promise, except through the replay below.
- **A kept version is frozen in behaviour.** A fix that changes what it flags or decides is a new version. A fix that only bounds its running time may land in place.
- **A replay holds it there.** Today's digests pin less than the table covers: 20 screened strings and the aggregation table (`screen.test.ts:86-122`, `aggregate.test.ts:176-191`). So each kept policy keeps recorded scenarios whose judgment record, rebuilt from the recorded verdicts, must hash the same. One scenario per read path: a whole file, a seeded sample, a stride sample. A change in any stage that alters a kept policy's result fails it.
- **Retirement is a decision, never a schedule.** A version can go when no live registration names it and no open deal binds it. Nothing needs retiring before mainnet.
- **The first kept set:** `screen-0` restored from the commit before PR 386 merges, with its sampler; `screen-1`; `agg-3`; the two templates; the scripted and the live registry.

### 2. A version withdrawn for a security reason

An earlier screen has a known bypass, and a deal bound to it is still open.

| Option | Cost | Verdict |
| --- | --- | --- |
| **Judge under the bound policy anyway** | Until the deal ends, a seller who reads the public fix can aim at the gap. One layer is weaker; the others stand | **Chosen** |
| The adjudicator declines; the fallback takes over | The fallback binds the same policy. On one build all three decline and the deal refunds: today's failure, by choice | Only for the exception below |
| The stricter of the two screens applies | A rule nobody signed. The record would name the bound policy while another screen ran: the policy swap `policyHash` exists to stop (threat T20). The seller carries both screens' false flags | Rejected |
| The deal escalates | An escalation the bound rule does not call for, to an adjudicator bound to the same policy | Rejected |
| The parties move the deal | A mutual settlement and a new offer under the new policy (ADR-0019). Both must agree. Nothing to build | Theirs to use |

**Recommendation: the adjudicator judges an open deal under its bound policy even when a later version fixes a weakness; it withdraws a version only when running it would break a hard rule or endanger the adjudicator itself, and then it declines every open deal bound to it, at once and in public, and never substitutes another version.**

- **Why the terms hold.** The parties agreed to that policy and the primary signed an acceptance that names it (D28). The buyer could write its own protection into the checks (D32). Spotlighting, judges with no tools, the verdict schema, the judges' own injection rule and the two-family accept still stand.
- **The price.** The buyer's loss on the hold is bounded by the price and the fee. A hidden payload the old screen misses can still reach the buyer's agent in released work (threat T22); a buyer screens released work with the newest screen (D32).
- **A weakness is not a withdrawal.** A missed attack phrase is a weakness. A withdrawal needs a version that would break a hard rule in `CLAUDE.md` (deliverable content in an instruction position, a judge with a tool or a secret, code run from a deliverable, an unpinned model), or that would endanger the adjudicator's keys, other deals' data or its ability to run.
- **A withdrawal is recorded** in `docs/decisions-today.md`: the version, the reason, the date, the open deals it leaves unjudged and, where bonds exist, what it costs them.
- **What it does.** The adjudicator declines each open deal bound to the version, and the state read says so (section 5). As primary it declines any offer that names it. A turn whose panel has already returned completes: the adjudicator signs the record it has. Withdrawing the current default makes another version the default in the same deploy.
- **What a default pays.** On the phase-one contract the buyer gets the price and the fee back and no key, so the seller keeps its work. On SimChain the adjudicators' bonds also compensate the seller (`packages/settlement/sim/simchain.ts:975-990`), so a withdrawal there costs the adjudicator.
- **The residual.** Three adjudicators on one build are one point of failure for judgment. Parties who want independence name a fallback and an appeal adjudicator run by another operator (property 1).

### 3. Who carries which version

**What the hashes promise.** `policyHash` and `registryHash` fix which rules and which models judge. Core and the contract enforce one thing: each acceptance and decision names the same two hashes as the terms (`packages/core/src/state.ts:220`, `:369`; `contracts/src/HoldbackTypes.sol:296-311`, `:361-384`) [measured]. Nothing promises that an adjudicator can still run them, and only the primary signs anything before funding.

| Option | Cost | Verdict |
| --- | --- | --- |
| Every named adjudicator must carry the bound versions | Nothing enforces it: a fallback or appeal adjudicator signs nothing at agreement | Rejected as a protocol rule |
| **The duty follows what each adjudicator signed or said** | None beyond section 1 | **Chosen** |
| A registration lists the policies its adjudicator can judge | A schema change | Later, if an outside adjudicator asks |

**Recommendation: the primary must judge every policy it signed an acceptance for; a fallback or appeal adjudicator must judge what it answered it would take; and Crow's three reference adjudicators ship in one build with one kept set.**

- **The answer is `declines`** (`service.ts:295-299`), which an operator asks before it fills in a default. A build never drops a version it answered yes for while a deal that binds it is open.
- **An outside primary's policy** may name versions Crow never had. Crow's fallback declines it ahead of time and at its turn, as today (D29).
- **A party may bind an older kept version** through an outside primary with Crow as fallback. That is the parties' choice (D32). The operator's prepare notice says when a policy names a version Crow has superseded. A withdrawn version is declined.
- **Where adjudicators deploy apart,** the fallback and the appeal adjudicator upgrade first and the primary last.

### 4. The deploy guard

| Option | Cost | Verdict |
| --- | --- | --- |
| No guard, or a warning | A version dropped by mistake orphans deals; a warning scrolls past on a script that deploys for real | Rejected |
| **Refuse, with one scoped override** | A deploy stops until the build carries the version, or the withdrawal is recorded | **Chosen** |
| Refuse any deploy while any deal is open | Section 1's first option | Rejected |

**Recommendation: `pnpm demo-cloud:deploy` refuses, before any upload, a deploy after which an open deal that the live build can judge could not be judged; it warns and goes on only when it cannot read the open deals.**

- **It restricts only the operator.** D31 limits what the protocol and the API refuse from the parties. The guard refuses nothing a party sends, and no party can block a deploy through it: it refuses only what the new build dropped.
- **A static check runs in CI first.** The kept policies and registries are one data file. A test fails when a build drops an entry without a retired or withdrawn mark and its decision reference.
- **The live check asks the new build, not a table.** For each open deal that names this operator's adjudicators, it asks the question `declines` answers: policy, registry, seats. It reads the deals from the public reads T-367's Handoff lists. It prints each deal it would orphan, with its state and next deadline, and exits with code 2.
- **The override names one version and its decision.** The guard still refuses every other orphan. The orphaned deals go into the deploy's record line. A deploy under the override never rolls back on its own to a build that judges under the withdrawn version.
- **A new default ships in two deploys.** The first carries the new version or registry. A later one makes it the default. The guard refuses a default the live build does not carry, so an automatic rollback always lands on a build that can judge every open deal. The build task sources the live build's kept file; the status document names no commit today.
- **A failed read warns.** The deploy may be the fix for the outage that broke the read, and the static check has passed.

### 5. A deal the build still cannot judge

Three cases remain: a withdrawn version, an outside primary's policy, and a mistake that passed the guard.

| Option | Cost | Verdict |
| --- | --- | --- |
| As today | The parties learn at `judgeBy` at the earliest, and never what follows | Rejected |
| **A notice in the public state read** | A few lines in the world; `notices` exists | **Chosen** |
| A signed refusal from the adjudicator | A new signed type and a schema version | Later, if the record needs it as evidence |
| Hand the deal to the fallback early | A change to settlement and to agreed deadlines | Rejected |

**Recommendation: as soon as the terms show that an adjudicator cannot judge an open deal, the public state read names the adjudicator, the reason, what follows and when; the fallback and the default outcome then run exactly as the terms say.**

- **Computed at read time, from the terms,** with the same answer as `declines`. Today's notices come from an adjudicator's pass and live in memory (`world.ts:704-705`); a Held deal gets no pass (`service.ts:201-230`) and a restart forgets them. So the notice shows before the seller delivers, and a seller that reads it can keep its work.
- **It says:** which adjudicator and role; the field and value the build does not carry, with the withdrawal's reference; whether the next adjudicator can judge, or "unknown" for one this operator does not run; the deadline at which the default outcome applies and what it pays on this settlement layer; and that the parties can settle before then.
- **The primary gets a notice too.**
- **The wording is exact.** `policy_mismatch` stays for a hash that does not match. A policy that matches reads "this build does not carry screen-0".

### 6. The fixture and the tests

**Recommendation: the build adds the scenario fixtures and named tests below; the first is the neutrality fixture for this actor.**

- **`neutrality.deploy-changes-policy`** (SimChain and the local chain): a deal accepted under one policy; the adjudicators restart on a build whose default differs; the primary judges under the bound policy; the record names the bound `policyHash` and template hash; the deal ends Released. Variants: the fallback decides; the appeal adjudicator decides after an escalation.
- **`neutrality.deploy-changes-registry`:** the same for an earlier registry. It closes the planned `neutrality.maintainers-change-registry`.
- **`neutrality.rollback-after-default-flip`:** a deal accepted under the new default is still judged after a rollback, for a policy and for a registry.
- **`neutrality.withdrawn-default-version`:** no new deal is accepted under it; open deals are declined with a notice.
- **`neutrality.notice-before-delivery`:** a Held deal shows the notice, also after a restart.
- **`attack.offer-binds-kept-version`:** a Crow primary declines an offer that binds an older kept policy; it is never funded.
- **`attack.kept-version-drift`:** the replay fails on a changed filter, sampler or screen under an unchanged label.
- **Selection by the bound policy:** one delivery `screen-0` flags and `screen-1` passes, and one the other way round, each judged under both.
- **The guard:** it refuses an orphaning deploy, passes a clean one, warns on a failed read, refuses a default the live build lacks, and honours the override for its named version only.
- **Kept as they are:** a version the build does not carry is refused before any judge is called; the mutation sweep's policy-binding mutants (`apps/adjudicator/scripts/mutants.mjs:40-43`) cover the new check.

### 7. What it costs

**Recommendation: accept the cost; it is small and the contracts are not touched.**

- **Code kept:** one file per screen version (`screen.ts` is 354 lines at `screen-0`, 456 at `screen-1`), one per aggregation version (202 lines), a few dozen lines per template pair, and the earlier sampler [measured, `wc -l`]. PR 386 is the screen's first version change since 2026-10-30 [measured, `git log -S`].
- **Review:** a version is reviewed once, when it is new. Freezing it is a copy that a reviewer checks as a move with an unchanged replay.
- **Start-up:** two screens double the patterns a Worker loads. The build measures it with the existing start-up test [guessed to be small].
- **Deploys:** one more deploy each time a default changes.
- **The phase-one contracts are not touched.** The contract rebuilds each acceptance's and decision's signed digest from the terms' own two hashes and never sees a policy's body (`HoldbackTypes.sol:296-311`, `:361-384` on `main`; the same functions at `:282` and `:347` on `contracts-audit-ready` at `6230b46`) [measured].

## Litmus tests

1. **Neutrality.** It closes a gap: a release or a deploy no longer removes the judges of an open deal, and the maintainers' row gains a fixture. A withdrawal remains an adjudicator's refusal, which the fallback and the default outcome cover. The one-build residual is stated.
2. **The hold.** Unchanged. No rule moves funds or changes a deadline.
3. **Defended judgment.** It passes for the four fields and the registry: models stay pinned by the bound registry, and a decision's `policyHash` is the policy that ran. Two exceptions are stated: a version with a known weakness still judges its open deals, and this record adds no re-roll but leaves the restart finding below open.

## Until the build lands

A deploy that changes a version or a registry goes out only when no open deal binds the outgoing policy. T-367's Handoff gives the reads. This is section 1's rejected option, so it is a stopgap: any open deal blocks the deploy, a stranger's unfunded test deal included, and Rafa decides whether such a deal counts. PR 386's deploy is the first. The build should land before the pilot's deal opens.

## The build's task

One task, change kind 5, in the judgment lane after T-372 merges, with the notice and the deploy guard as its last commits. In `packages/judgment/src/`: a kept table of screen versions, template pairs and aggregation versions, `screen-0` and its sampler restored from the commit before PR 386, and `runPipeline` selecting by the four values it is given. In `apps/adjudicator/src/`: `policy.ts` (`checkPolicyBinding` checks "carried"; a kept-policies data file with retired and withdrawn marks), `service.ts` (`#boundPolicy`, the registry by hash with its provider, `declines`, the decline of an offer that names a withdrawn version) and `scripts/mutants.mjs`. In `packages/testkit/src/`: a scenario step that restarts the adjudicators on another default, the record replay, and recordings that tell the role from any kept template hash. In `apps/demo-cloud/`: the notice computed at read time in `src/world.ts`, and the guard in `scripts/deploy.mjs` with its pre-flight in `scripts/deploy-lib.mjs` and tests in `src/deploy-preflight.test.ts`. Fixtures and tests: section 6. Docs it updates: the policy-binding paragraph of `docs/judgment-and-defenses.md`, the maintainers' row and the residuals of `docs/neutrality.md`, the deploy steps of `docs/operations.md`, and a row in `docs/team.md`'s Rules and checks. Review: one red-team pass, blocking findings only, aimed at a kept version that drifts under its label, a party steering a deal onto a weaker kept version, a deploy or rollback the guard lets through, and a notice that misstates what follows. The first deploy that carries `screen-0` and `screen-1` together is Rafa's gate.

## Not decided here

- **A fifth policy field** for code that fits no label, in place of this record's reading of `screenVersion`. A schema change. Trigger: the first change that fits none of the four.
- **A public read of a policy by its hash.** A party cannot read the policy its open deal binds once the primary has registered another [inferred: `docs/api.md` names no such route].
- **Judging twice after a restart.** The adjudicator keeps its judged records in memory (`service.ts:153`). A restart between a panel's return and the decision's submission would call the judges again for the same attempt [inferred, not run]. A separate finding, for the triage file.

## Red team

One `red-teamer` pass on the first draft (2026-11-12): no Critical, 2 High, 6 Medium, 6 Low. It confirmed every cited line it opened. Four attacks failed: a downgrade at a Crow primary, an outsider freezing deploys through the guard, a rollback after a policy flip losing the newer policy from the store, and each reason for section 2's rejected options. What changed:

- **High, fixed:** withdrawing the current default collided with the two-deploy rule and the rollback (section 2: the default moves in the same deploy and the primary declines offers that name the version; section 4: no automatic rollback under the override).
- **High, fixed:** a kept version could drift with every listed test green, since the digests pin less than the fields cover (section 1: the replay rebuilds the whole record, one scenario per read path; checks and seating are named as outside the promise).
- **Medium, fixed:** what a default pays differs on SimChain, and a judged turn's fate was unstated (section 2); "carried" is not "runnable", and a registry needs its provider (sections 1 and 4); the notice was late, lost at restart and sure of what it could not know (section 5); the interim rule is the rejected option (stated); the loss bound missed threat T22 (section 2); the override was not scoped (section 4).
- **Low, fixed or stated:** one definition of open; the cost of a pinned version; the source of the live build's kept file; the wording of litmus test 3; the contract lane's line numbers; a prepare notice for a superseded version.
