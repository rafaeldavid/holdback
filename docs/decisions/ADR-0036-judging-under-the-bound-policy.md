# ADR-0036: A deal is judged under the policy it bound, on every later build

- **Status:** Proposed, 2026-11-12 (D65). Rafa may overrule any line. Nothing here is built.
- **Date:** 2026-11-12
- **Raised by:** T-373, from the finding in T-367's Handoff (PR 386): an operator deploy that changes the screen leaves a deal accepted before it without a judge. Research: this note, one scratch test that was run and not committed, and one red-team pass (section "Red team").
- **Builds on:** ADR-0001 (neutrality), ADR-0006 (the policy and registry bindings), ADR-0021 (the screen), ADR-0030 section 6 (the bound policy is read by its hash), ADR-0031 (phase one: the first decision is final), ADR-0035 (the screen's second version; PR 386, open when this was written); D26, D28, D29, D31, D32.
- **Changes (when built, by one later task):** `packages/judgment`, `apps/adjudicator`, `packages/testkit`, `apps/demo-cloud` (the state read's notices and the deploy script), `scripts/deploy-lib.mjs` and `fixtures/`. No file in `spec/`, no signed type and no contract changes. This ADR itself changes no code.
- **Amends:** ADR-0006's policy binding: a build honours every version it keeps, where today it honours only its own.

Labels: **measured** (read at the cited line, or run, by this task at commit `e1e8df2`, `origin/main` on 2026-11-12), **documented** (stated in the cited doc), **inferred** (from reading, not from a run), **guessed**.

## Summary

**Today an operator deploy can leave an open deal without a judge.** A deal's signed terms pin its judgment policy and its judge registry by hash. A build of the adjudicator runs one screen version, one pair of prompt templates and one aggregation version, and holds one registry. After a deploy that changes any of them, the primary, the fallback and the appeal adjudicator each refuse a deal accepted before it. No judge is called. The deal runs down to its default outcome: the buyer is refunded and a seller who delivered is not paid [measured, section "The finding"].

**The decision, one line per question:**

1. **What a build keeps.** A build keeps every screen version, template pair, aggregation version and registry that a released build ever registered, and selects them by the deal's bound policy.
2. **A version with a known weakness.** The adjudicator still judges an open deal under its bound policy. It withdraws a version only when running it would break a hard rule, and then it declines in public at once.
3. **Who carries which version.** The primary carries every policy it signed an acceptance for. A fallback or appeal adjudicator carries what it said it would take. Crow's three ship in one build.
4. **The deploy guard.** The deploy script refuses a deploy after which the adjudicators could no longer judge an open deal they can judge today.
5. **A deal the build cannot judge.** The public state read says so from the first pass: which adjudicator, why, what follows and when.
6. **The proof.** A fixture, `neutrality.deploy-changes-policy`: a deal accepted under one policy, a deploy, the deal judged under its bound policy and settled.
7. **The cost.** One frozen file of a few hundred lines per version. No contract, schema or signed type changes.

## The finding

**The finding holds** [measured]. What happens today to a deal accepted under an earlier policy, once the adjudicators run a build whose versions differ:

| Adjudicator | What it does | Evidence |
| --- | --- | --- |
| Primary | Refuses every pass with `policy_mismatch` ("screen screen-prev is not screen-0"). It calls no judge. The deal stays Delivered | Scratch test [measured]. `apps/adjudicator/src/service.ts:499-500` calls `#boundPolicy` (`:381-391`), which calls `checkPolicyBinding` (`apps/adjudicator/src/policy.ts:39-48`) |
| Fallback | Does not trigger the takeover. After anyone triggers it, refuses every pass with `policy_mismatch` | Scratch test [measured]. `service.ts:211-218` and `:420-424`; the existing test at `service.test.ts:1492` |
| Appeal adjudicator, after an escalation | Refuses every pass with `policy_mismatch` | Scratch test [measured]. The same line, `service.ts:499`; the existing test at `service.test.ts:894-905` for the appeal template |
| The deal | Ends Refunded through the default outcome at `fallbackBy`, or at the escalation's deadline. No judge was called, no record published, no decision signed | Scratch test [measured] |

**How the scratch test models a deploy.** An adjudicator configured with a policy whose `screenVersion` is `screen-prev` accepts the offer, as an earlier build would: acceptance compares hashes only (`service.ts:285`). Then three adjudicators on this build's default policy replace it and register again. The store still serves the earlier policy by its hash. Two tests, both pass [measured: `pnpm exec vitest run` on the scratch file, 2026-11-12]. The file is in the sessions' shared notes folder as `t-373-scratch-test.ts.txt`, not in the repository.

**The store is not the fault.** It keeps every policy a registration carried, by hash (ADR-0030 section 6; `apps/demo-cloud/src/world.ts:295-354`). The adjudicator reads the bound policy and then refuses it, because `checkPolicyBinding` compares each of its four version fields with the build's one constant (`policy.ts:43-46`).

**Five facts widen it:**

- **Any of the four fields does it:** the first-instance template, the appeal template, the aggregation version, the screen version (`policy.ts:43-46`) [measured by reading; tests at `service.test.ts:435` and `:894`].
- **The registry does it too.** An adjudicator holds one registry and refuses a deal bound to another with `registry_mismatch` (`service.ts:393-396`; tests at `service.test.ts:421` and `:1491`) [measured]. The live world's registry changes when the live registry file changes or live judges are switched on or off (`world.ts:646`) [inferred].
- **The primary's refusal is silent.** The state read explains a declined turn only for the fallback and the appeal adjudicator (`world.ts:453-458`, `:1102-1106`). Before `judgeBy` it says nothing; after it, the fallback's notice gives the reason and not what follows (`world.ts:461-463`) [inferred].
- **A rollback is the same deploy in reverse.** `apps/demo-cloud/scripts/deploy.mjs:68-77` rolls back when the smoke deal fails. A deal accepted under the new policy before the rollback is then on a build that lacks its version [inferred].
- **Code outside the four fields changes what a judge reads.** PR 386 changes how a long delivery is sampled, in `prompt.ts`. No template hash moves, and the change travels under `screen-1` [measured, from the PR's diff].

**What it breaks.** The deal still ends in an outcome its terms name, the default refund. Two promises fail. `docs/neutrality.md:33` says of Holdback's maintainers: "Existing commitments run on the code and registry they were signed under" [documented]. And litmus test 3 is skipped for that deal: no check runs and no panel sits. With Crow's three default adjudicators on one build, one deploy removes all three at once. In phase one nothing later corrects it (ADR-0031).

## Decision

### 1. What a build keeps

| Option | Cost | Verdict |
| --- | --- | --- |
| Only the newest version, and deploy only when no deal is open | No code kept. A pilot deal open for days blocks every deploy, a security fix included. D31 lets a deal stay open for years, so a stranger's deal could freeze Crow's deploys | Rejected |
| A window: the last few versions, or those younger than some age | Little code kept. A deal that outlives the window loses its judge, so the window is a cap on a deal's length that the terms never stated (D31) | Rejected |
| Old builds kept running beside the new one, one per policy | No judging code changes. Every old build keeps its old settlement and relay bugs, and each needs its own keys, storage and routing | Rejected |
| **Every version a released build ever registered, selected by the bound policy** | One frozen file per version (section 7). The set grows only when a version changes | **Chosen** |

**Recommendation: a build keeps every screen version, template pair, aggregation version and registry that a released build ever registered, selects them by the deal's bound policy, and retires one only by a reviewed change that shows no open deal binds it.**

- **Selection.** `checkPolicyBinding` asks whether the build carries each of the bound policy's four values. It no longer asks whether they equal the build's default. The pipeline takes the four values from the bound policy and runs those implementations. The registry is looked up by `registryHash` the same way.
- **A build accepts only its current default as primary.** That is today's rule (`service.ts:285`) and it stays. An offer that binds an earlier policy is declined before acceptance, with a notice, and the seller offers again. So no new deal at a Crow primary binds an old version.
- **Open** means from the primary's signed acceptance until no adjudicator can decide the deal again. The world already computes this: `workAt` returns null (`world.ts:477`). In phase one that is Released, Refunded, Settled or Expired.
- **Each field covers the code behind its stage.** A change to that code that changes a kept version's result is a new version:

  | Field | The code it covers |
  | --- | --- |
  | `screenVersion` | Everything between the delivered bytes and the prompt: normalization (the schema says so, `spec/schemas/adjudicator.schema.json:123-126`), the screen, the read limit, the sampling and the rendering of the data section |
  | `promptTemplateHash`, `appealPromptTemplateHash` | The template text |
  | `aggregationVersion` | The verdict filter, the aggregation rule and `signedOutcome` |
  | `registryHash` | The registry document. It is data, kept by hash |

  Deterministic checks belong to the terms' schema version and check type, and panel seating to the protocol (ADR-0016, ADR-0018). Neither is the policy's.
- **A kept version is frozen in behaviour.** Its pinned digest stays in the tests (`screen.test.ts:86-122` and `aggregate.test.ts:176-191` already pin one digest per version). A fix that changes what it flags or decides is a new version. A fix that only bounds its running time may land in place, when the digests and the replay below hold.
- **A replay pins the rest.** Each kept policy keeps one recorded scenario whose judge inputs must still hash to the recorded `inputHash`. A change anywhere that alters what a kept policy's judges read fails that test.
- **Retirement is a decision, never a schedule.** A version can go when no registration on a live world names it and no open deal binds a policy that names it. The removing change shows the guard's read (section 4) with zero deals. Nothing needs retiring before mainnet.
- **The first kept set:** `screen-0` restored from the commit before PR 386 merges, with its sampler; `screen-1`; `agg-3`; the two templates; and the registries of `config/judges.yaml` and `config/judges-live.yaml`.

### 2. A version withdrawn for a security reason

An earlier screen has a known bypass, and a deal bound to it is still open.

| Option | Cost | Verdict |
| --- | --- | --- |
| **Judge under the bound policy anyway** | Until the deal ends, a seller who reads the public fix can aim at the gap. One layer is weaker; the others stand. The buyer's loss is bounded by that deal's price and fee | **Chosen** |
| The adjudicator declines and the fallback takes over | The fallback binds the same policy. With three adjudicators on one build all three decline, and the deal refunds: today's failure, by choice. Any maintainer could then stop deals by calling a version weak | Only for the exception below |
| The stricter of the two screens applies | A rule nobody signed. The signed record would name the bound policy while another screen ran, which is the policy swap after agreement that `policyHash` exists to stop (threat T20). The seller carries both screens' false flags: `screen-0` flagged nine honest audit lines [measured, T-361] | Rejected |
| The deal escalates | An escalation the bound aggregation rule does not call for. The appeal adjudicator binds the same policy, and in phase one its decision is final | Rejected |
| The parties move the deal | A mutual settlement and a new offer under the new policy, with messages that exist (ADR-0019). Both must agree | Offered in the notice |

**Recommendation: the adjudicator judges an open deal under its bound policy even when a later version fixes a weakness; it withdraws a version only when running it would break a hard rule or endanger the adjudicator itself, and then it declines every open deal bound to it, at once and in public, and never substitutes another version.**

- **Why the terms hold.** The parties agreed to that policy, and the adjudicator signed an acceptance that names it. Agreed terms bind whether or not they turn out favourable (D28). The buyer chose the adjudicator and could write its own protection into the checks (D32). The screen is one layer: spotlighting, judges with no tools, the verdict schema, the judges' own injection rule and the two-family accept still stand.
- **A weakness is not a withdrawal.** A missed attack phrase is a weakness. A withdrawal needs one of two things. The version would break a hard rule in `CLAUDE.md`: deliverable content in an instruction position, a judge with a tool or a secret, code run from a deliverable, an unpinned model. Or it would endanger the adjudicator's keys, other deals' data, or its ability to run at all.
- **A withdrawal is recorded.** It is an entry in `docs/decisions-today.md` that names the version, the reason and the date. The build marks the version withdrawn with that reference.
- **What a withdrawal does to open deals.** The adjudicator declines each one at its next pass, and the state read says so (section 5). The fallback and the default outcome follow as the terms say. On a default the buyer gets the price and the fee back and never gets the key, so the seller keeps its work.
- **What stays true for new deals.** The adjudicator stops accepting the earlier policy the moment it registers the new one (`service.ts:285`).
- **The residual, stated plainly.** Three adjudicators on one build are one point of failure for judgment. Parties who want independence name a fallback and an appeal adjudicator run by another operator (property 1).

### 3. Who carries which version

**What the hashes already promise.** `policyHash` and `registryHash` fix which rules and which models judge. Core and the contract enforce one thing: each acceptance and each decision names the same two hashes as the terms (`packages/core/src/state.ts:220` and `:369`; `contracts/src/HoldbackTypes.sol:296-311` and `:361-384`) [measured]. Nothing promises that an adjudicator can still run them. Only the primary signs anything that names the policy before the deal is funded.

| Option | Cost | Verdict |
| --- | --- | --- |
| Every adjudicator named in a deal must carry the bound versions | Nothing enforces it: a fallback or appeal adjudicator signs nothing at agreement (T-211) | Rejected as a protocol rule |
| **The duty follows what each adjudicator signed or said** | None beyond section 1 | **Chosen** |
| A registration lists every policy its adjudicator can judge, so parties check before they sign | A schema change (kind 6) | Later, if an outside adjudicator asks for it |

**Recommendation: the primary must judge every policy it signed an acceptance for; a fallback or appeal adjudicator must judge what it answered it would take; and Crow's three reference adjudicators ship in one build with one kept set.**

- **The reference adjudicator's answer** is `declines` (`service.ts:295-299`), which an operator asks before it fills in a default (ADR-0030 section 6). It answers yes only for versions its build carries, and a build never drops a version it answered yes for while a deal that binds it is open.
- **An outside primary's policy** may name versions Crow never had. Crow's fallback declines such a deal ahead of time and at its turn, as today (D29).
- **Where adjudicators deploy apart,** the fallback and the appeal adjudicator upgrade first and the primary last. The carriers then hold a version before any deal binds it.
- **A party may bind any kept version** through an outside primary and name Crow's fallback. That is the parties' choice (D32). A withdrawn version is declined.

### 4. The deploy guard

| Option | Cost | Verdict |
| --- | --- | --- |
| No guard; trust the kept set | A version dropped by mistake orphans deals with no warning | Rejected |
| Warn and go on | A warning scrolls past on a script that deploys for real | Rejected |
| **Refuse, with one named override** | A deploy stops until the build carries the version, or the withdrawal is recorded | **Chosen** |
| Refuse any deploy while any deal is open | Section 1's first option | Rejected |

**Recommendation: `pnpm demo-cloud:deploy` refuses, before any upload, a deploy after which an open deal that the live build can judge could not be judged; it warns and goes on only when it cannot read the open deals.**

- **It restricts only the operator.** D31 limits what the protocol and the API refuse from the parties. The guard refuses nothing a party sends. It stops Crow's own deploy from breaking the neutrality test.
- **A static check runs in CI first.** The kept policies and registries are one data file. A test fails when a build drops an entry without marking it retired or withdrawn, each with its decision reference.
- **The live check.** The script lists the open deals that name this operator's adjudicators, with each one's `policyHash` and `registryHash`, from the public reads T-367's Handoff lists. It asks the new build's kept table about each. It prints every deal it would orphan, with its state and next deadline, and exits with code 2.
- **The override** is one flag for a recorded withdrawal (section 2). The script prints the deals it leaves unjudged into the deploy's record line. The deploy itself is Rafa's gate, as every deploy is.
- **A failed read warns.** The deploy may be the fix for the outage that made the read fail, and CI's static check has already passed.
- **A new version ships in two deploys.** The first carries it. A later one makes it the default. The guard refuses a build whose default policy names a version the live build does not carry, read from the kept table at the live commit. An automatic rollback then always lands on a build that can judge every open deal.

### 5. A deal the build still cannot judge

Three cases remain: a withdrawn version, an outside primary's policy that names versions this build never had, and a mistake that passed the guard.

| Option | Cost | Verdict |
| --- | --- | --- |
| As today: silent until the fallback's turn | The parties learn at `judgeBy` at the earliest, and never what follows | Rejected |
| **A notice in the public state read from the first pass** | A few lines in the world; no schema change (`notices` exists) | **Chosen** |
| A signed refusal message from the adjudicator | A new signed type and a schema version | Later, if a court ever needs more than the operator's read |
| Hand the deal to the fallback before `judgeBy` | A change to settlement and to the terms' deadlines | Rejected |

**Recommendation: from the first pass at which an adjudicator knows it cannot judge an open deal, the public state read names the adjudicator, the reason, what follows and when; the fallback and the default outcome then run exactly as the terms say.**

- **It is known from the terms alone,** so the notice appears in every open state, before the seller delivers. A seller that reads it can keep its work.
- **The notice says:** which adjudicator cannot judge and in which role; the field and value it does not carry, and the withdrawal's reference when there is one; whether the next adjudicator can judge; the deadline at which the default outcome applies and what it pays; and that the parties can settle by mutual agreement before then.
- **The primary gets a notice too.** Today only the fallback's and the appeal adjudicator's turns do.
- **The problem type stays `policy_mismatch`** for a hash that does not match. A policy that matches and names a version the build does not carry reads "this build does not carry screen-0", not "the policy does not match".
- **No new settlement step.** The operators send the due timeouts as they do today [documented, `docs/neutrality.md`, the operator row].

### 6. The fixture and the tests

**Recommendation: the build adds the scenario fixture `neutrality.deploy-changes-policy` and the tests below.**

- **`neutrality.deploy-changes-policy`** (`fixtures/scenarios/`, on SimChain and on the local chain): a deal is accepted under one policy; the adjudicators restart on a build whose default policy differs; the primary judges under the bound policy; the record names the bound `policyHash` and the bound template hash; the deal ends Released with the expected balances. Two variants: the fallback decides, and the appeal adjudicator decides after an escalation.
- **`neutrality.deploy-changes-registry`:** the same for a deal bound to an earlier registry. It closes the planned `neutrality.maintainers-change-registry` in `docs/neutrality.md`.
- **Selection by the bound policy, never the default:** one delivery that `screen-0` flags and `screen-1` passes, and one the other way round, each judged under both policies with the bound screen's result.
- **Every kept version keeps its pinned digest,** and every kept policy its replay.
- **A version the build does not carry is still refused** before any judge is called, and `error.policy-hash-mismatch` keeps its meaning.
- **The notice,** for each role and each open state.
- **The guard:** it refuses an orphaning deploy, passes a clean one, warns on a failed read, refuses a default the live build lacks, and honours the override only with a recorded withdrawal.
- **The mutation sweep's policy-binding mutants** (`apps/adjudicator/scripts/mutants.mjs:40-43`) cover the new check.

### 7. What it costs

**Recommendation: accept the cost; it is small and the contracts are not touched.**

- **Code a build keeps:** one file per screen version (`screen.ts` is 354 lines at `screen-0` and 456 at `screen-1`), one per aggregation version (`aggregate.ts`, 202 lines), a few dozen lines per template pair, and the earlier sampler where a screen version changed it [measured, `wc -l`]. PR 386 is the first change of the screen's version since the screen was written on 2026-10-30 [measured, `git log -S` on `screen.ts`].
- **Review:** a version is reviewed once, when it is new, by its change's own recipe. Freezing it is a copy that a reviewer checks as a move with an unchanged digest.
- **Start-up:** two screens double the patterns a Worker loads. The build measures it against the one-second limit with the existing start-up test [guessed to be small].
- **Deploys:** one more deploy each time a version changes (section 4).
- **The phase-one contracts are not touched.** The contract rebuilds each acceptance's and decision's signed digest from the terms' own `policyHash` and `registryHash` (`HoldbackTypes.sol:296-311`, `:361-384`), on `main` and on the contract lane's branch `contracts-audit-ready` at `6230b46` [measured]. It never sees a policy's body. No signed type, schema or API route changes.

## Litmus tests

1. **Neutrality.** Passes, and closes a gap. A maintainer's release or an operator's deploy no longer removes the judges of a deal that is open. The maintainers' row in `docs/neutrality.md` becomes true for the judging code, with a fixture. A withdrawal remains an adjudicator's refusal, which the fallback and the default outcome already cover.
2. **The hold.** Unchanged. No rule moves funds or changes a deadline.
3. **Defended judgment.** Passes. Models stay pinned by the bound registry. The panel is drawn from the same seed, so nothing is re-rolled. A decision's `policyHash` is the policy that ran.

## Until the build lands

A deploy that changes a version or a registry goes out only when no open deal binds the outgoing policy. T-367's Handoff gives the three reads. PR 386's deploy is the first such deploy. The build should land before the pilot's deal opens; if it does not, no version-changing deploy goes out while that deal is open.

## The build's task

One task, change kind 5 (judgment code), in the judgment lane after T-372 merges, with the deploy guard as its last commits. In `packages/judgment/src/`: a kept table of screen versions, template pairs and aggregation versions, `screen-0` and its sampler restored from the commit before PR 386, and `runPipeline` selecting by the four values it is given. In `apps/adjudicator/src/`: `policy.ts` (`checkPolicyBinding` checks "carried", and a kept-policies data file with retired and withdrawn marks), `service.ts` (`#boundPolicy`, the registry by hash, `declines`), `scripts/mutants.mjs`. In `packages/testkit/src/`: a scenario step that restarts the adjudicators on another default policy, and recordings that tell the role from any kept template hash. In `apps/demo-cloud/`: the notice for every role and open state in `src/world.ts`, and the guard in `scripts/deploy.mjs` with its pre-flight in `scripts/deploy-lib.mjs` and tests in `src/deploy-preflight.test.ts`. Fixtures: `neutrality.deploy-changes-policy` and `neutrality.deploy-changes-registry` with their snapshots and frozen recordings. Tests: section 6. Docs it updates: the policy-binding paragraph of `docs/judgment-and-defenses.md`, the maintainers' row and the residuals of `docs/neutrality.md`, the deploy steps in `docs/operations.md`, and a row in `docs/team.md`'s Rules and checks. Review: one red-team pass, blocking findings only, aimed at four things: a party steering a deal onto a weaker kept version, a kept version whose behaviour drifts under its label, a deploy or rollback the guard lets through, and a notice that misstates what follows. The deploy that first carries `screen-0` and `screen-1` together is Rafa's gate.

## Not decided here

- **A fifth policy field for code that fits no label.** `screenVersion` carries the reading path by this record's rule. A `pipelineVersion` field would say it outright; it is a schema change. Trigger: the first change that fits none of the four fields.
- **A public read of a policy by its hash.** The store keeps replaced policies and serves them to adjudicators only [inferred: `docs/api.md` names no such route]. A party cannot read the policy its open deal binds once the primary has registered another. Additive; a kind 6 change.
- **Judging twice after a restart.** The adjudicator keeps its judged records in memory (`service.ts:153`). A restart between a panel's return and the decision's submission would call the judges again for the same attempt [inferred, not run]. It is a separate finding for the triage file.

## Red team

Pending when this section was first written; see the entry below it.
