# T-017: Demo adjudicator profiles and selection before the offer

- **Lane:** demo
- **Phase:** 1
- **Depends on:** T-012 (agents), T-013 (CLI and viewer)
- **Paths this task may touch:** `apps/demo/`, `docs/backlog.md` (if a registration field is the right home for display-only data), this task file
- **Human gate:** no
- **Status:** review
- **Agent/session:** implementer; branch `t-017-demo-adjudicator-selection`

## Intent

Restated in my own words:

- **Goal.** Beat 1 says "the two agents chose the adjudicators", but today the slate is hard-wired in `beatHold`. Make the choice real and visible: before Tide-7 offers, Ledger reads the published adjudicator registrations, filters them by the club rulebook, and proposes a primary, fallback and appeal adjudicator; Tide-7 checks that proposal against its own policy and agrees (or refuses); the offer then names exactly the agreed slate.
- **Inputs.** The registrations the benches publish (Clearfield, Northgate, Atrium from T-009's service, plus a new Swiftline Verdicts listing), the bond pools SimChain holds, the Data Services Club rulebook (`panelPolicyMin`, `windowCoverageRatioBps`, `allowedSettlementModes`), the terms file's price, and `config/judges.yaml` through the demo registry.
- **Rules applied, from what the rulebook and registrations actually express.** Ledger: the registration's declared panel meets `panelPolicyMin` (panel size, appeal panel size, model families), and free bond (`junior + senior - reserved`) covers the price (100% for `guaranteed_on_decision`, the club's only mode, else `windowCoverageRatioBps`), and the registration validates against `adjudicator.schema.json`. Tide-7: the registration validates, its registry hash is the registry Tide-7 trusts and every active model ID in it is pinned (dated, never an alias), its `policyHash` is the hash of its policy, and its free bond is at least the price (a policy knob, so a test can make it refuse).
- **Swiftline** (one judge, one family, 1.0% fee, 40,000 tUSD bond) is excluded because its declared policy fails the rulebook, never by name. Its bond is real (SimChain genesis) and covers the price, so the bond rule passes and only the panel rules exclude it.
- **Profiles.** Each bench gets a cast-level profile: tagline, judges (registry judge IDs resolved to pinned model IDs and families through the demo registry, with a declared per-judge effort setting), harness, terms (fee, panel size and threshold, judgeBy, appeal window, bond, read from the registration, SimChain and the terms file), and an invented history marked as role-play. Effort, harness, roles offered and history are display data the v0.6 registration cannot carry; no schema change.
- **Outputs.** Beat 1's transcript gains two narrated steps before the offer (proposal with the exclusion and its reason; agreement with the seller's checks), and the viewer shows a collapsed profile per bench, including Swiftline as declined. Bench and profile text goes through the existing untrusted-text helpers.
- **Non-goals.** No protocol message and nothing on chain for the negotiation (agent-to-agent, unsigned in this prototype). No schema or registration change. No counter-proposal search (refusal is the one non-agree path). Effort settings are declared, not applied: recorded mode uses fake judges. Nothing in `packages/testkit` (T-016).

## Context

- `docs/demo.md` §Cast and §Beats (beat 1: "chosen by the two agents").
- `CLAUDE.md` Objective property 1 (the parties choose their adjudicators), Design principle: user choice (ADR-0015).
- `docs/architecture.md` bond coverage invariant (`windowCoverageRatioBps`, 100% for `guaranteed_on_decision`).
- `spec/schemas/adjudicator.schema.json` (v0.6), `fixtures/clubs/data-services-v1.yaml`, `config/judges.yaml`.
- T-012 (`apps/demo/agents/`), T-013 (`apps/demo/src/`).

## Acceptance criteria

- [ ] Profiles for Clearfield, Northgate and Atrium in `apps/demo/agents/cast.ts` with judges resolved from the demo registry (no invented model IDs), effort, harness, terms from registration/terms/SimChain, history labelled role-play; Swiftline Verdicts profile and registration.
- [ ] Ledger proposes from the published registrations filtered by the rulebook; Swiftline excluded with a rule-based reason.
- [ ] Tide-7 checks the proposal against its policy and agrees; a policy that rejects a bench produces a refusal and no offer.
- [ ] The offer names exactly the agreed slate.
- [ ] Beat 1 transcript: proposal (with exclusion) and agreement as two narrated steps before the offer.
- [ ] Viewer: a collapsed profile per bench; all bench text escaped.
- [ ] `pnpm verify` green on a clean tree.

## Out of scope

- A registration schema field for effort, harness, roles or history (backlog item instead).
- Counter-proposals, multi-round negotiation, signed negotiation messages.
- Live judges.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- **Test first (measured):** `1f66814` adds the tests and the beat-1 fixture alone; `apps/demo/agents/agents.test.ts` then failed to load (`./adjudicators.js` missing, 0 tests run), and `tsc -b` failed on the new event kinds and `BeatTranscript.adjudicators`. After `b7a3eee` and `0deef11`: 19 of 19 agents tests and 83 of 83 `apps/demo` tests pass.
- **Selection on SimChain, seed 7 (measured, `agents.test.ts` and `pnpm demo --beat 1`):** Ledger reads 4 registrations. Clearfield, Northgate and Atrium are eligible; Swiftline Verdicts is excluded with: panel of 1 judge (rulebook `panelPolicyMin.panelSize` 3), 1 model family (`minFamilies` 2), appeal panel of 1 (`appealPanelSize` 5), and its registration does not validate against `adjudicator.schema.json` v0.6. Its bond (40,000 tUSD, in genesis) covers the 2,000 tUSD price, so no bond reason appears. Tide-7 passes 4 checks per bench and agrees (5 after the review fixes below); the offer's `adjudicator`, `fallbackAdjudicator` and `appealAdjudicator` equal the agreed slate (registrations write addresses in lower case, the commitment in checksum case).
- **By rule, not name (measured):** Clearfield's own listing with `policy.minFamilies` set to 1 gets the same `panelPolicyMin.minFamilies` reason; a 30,000 tUSD price excludes it on the bond rule.
- **Refusal (measured):** with Tide-7's policy at `minFreeBondBps: 150000` (30,000 tUSD), the review refuses all three benches with `free bond 25,000 tUSD is below the 30,000 tUSD Tide-7 requires`, `beatHold` throws, and SimChain has no `commitment.offered` event.
- **Profiles (measured):** each of Clearfield, Northgate and Atrium resolves to the 5 active `config/judges.yaml` entries (`placeholder-claude-a/b`, `placeholder-gpt-a/b`, `placeholder-qwen-a`, all `-20260601`); Swiftline to `placeholder-gpt-a-20260601` only. A profile naming `gpt-latest` or the candidate `qwen-b` throws. Terms: fee 50 tUSD (registration `fee.min`; Swiftline 20 tUSD, 100 bps declared), panel 3 from 2 families at 2/3, appeal panel 5 from 3, deadlines 120 s / 120 s / 300 s from the terms file, appeal window 300 s, bond 25,000 tUSD (Swiftline 40,000) read before the job's reservation.
- **Beat-1 transcript (measured, `pnpm demo --beat 1`):** event order `adjudicator-proposal` (+19 ms), `adjudicator-agreement` (+20 ms), `offer` (+42 ms), `signed`, `acceptance` (+50 ms), `hold` (+59 ms). Times are wall-clock on this machine and vary run to run.
- **Viewer (measured):** `index.html` has 4 `<details class="profile">` blocks, none open; each lists judges with pinned model IDs and declared effort, harness, terms and history under a "role-play" badge. `beat-1.md` has an "Adjudicators considered" section.
- **Untrusted text (measured):** the hostile-text tests now put the hostile string in the declined listing's name; terminal, Markdown, HTML and JSON surfaces pass unchanged assertions.
- **Commitment unchanged (measured by the PR 48 reviewer):** diffing `pnpm demo` output on `main` against this branch, beats 2 to 10 JSON are identical, and beat 1 is identical apart from the two new events and the `adjudicators` array; the commitment is `0x87437a1c…` on both.
- **PR 48 review fixes (measured):**
  - Narration: the proposal line is 352 characters and the agreement line 351 in the terminal (were 910 and 763). The proposal names each excluded listing with its first reason and "(N more in the viewer)"; the agreement prints the shared checks once. The rules applied and each bench's seller checks moved to "Adjudicators considered" in `index.html` and `beat-1.md`; the Markdown section now also lists harness, judges as a table, terms and history.
  - A stricter rulebook (`panelSize` 5) excludes Clearfield's schema-valid listing with exactly one reason, `panel of 3 judges (rulebook minimum 5, panelPolicyMin.panelSize)`.
  - Tide-7 now checks that the three addresses are distinct and that each bench's profile offers its proposed role: a repeated bench is refused for both roles, and swapping primary and fallback is refused as "does not offer the primary role" and "does not offer the fallback role". 5 checks pass per bench in beat 1.
  - The registry check reads "the registry Tide-7 trusts (0x8aa41fa9…), every model pinned": the bench's registry hash equals the trusted registry's, so those are the models its panels draw from.
  - 21 of 21 agents tests and 86 of 86 `apps/demo` tests pass.
- **`pnpm verify` (measured, clean tree):**

  | Step | Command | Status | Time |
  | --- | --- | --- | --- |
  | typecheck | `pnpm typecheck` | pass | 233 ms |
  | lint | `pnpm lint` | pass | 2293 ms |
  | test | `pnpm test` | pass | 24408 ms |
  | spec | `pnpm validate:spec` | pass | 309 ms |
  | snap | `pnpm snap` | pass | 2068 ms |
  | demo | `pnpm demo` | pass | 2579 ms |

  62 test files, 1,855 tests, all passing; no snapshot diffs against HEAD. First run at `7a0e83e`; re-run after rebasing onto `df6486d` at `07c9fad`: all six steps pass, 1,855 tests (measured). Only this status line changed after that run.

## Decisions

- **No schema change.** Effort, harness, roles offered, a fee rate and history are cast-level display data in `PROFILES` (`apps/demo/agents/cast.ts`). Backlog rows: registration fields for roles, per-judge effort and fee rate; signed negotiation messages and counter-proposals.
- **Judges are registry IDs, not model strings.** A profile lists `claude-a`, `gpt-b` and so on; `resolveJudges` maps them through `demoRegistry()` and throws on anything not active. The three benches list all five active entries because T-009's service draws every panel from that population.
- **Swiftline's registration declares what it runs** (panel 1, one family) and therefore fails the v0.6 schema floors. The directory is a bulletin board: anyone posts, readers validate. Ledger reports the rulebook reasons first and the schema failure last. Swiftline has a real 40,000 tUSD bond in genesis so the bond rule passes and only the panel rules exclude it; the narrator leaves its bond out of the balance rows (no commitment names it).
- **Bond rule from the rulebook:** free bond ≥ `ceil(price × windowCoverageRatioBps / 10000)`, at 100% for `guaranteed_on_decision` (`docs/architecture.md` coverage invariant). The club allows only that mode, so the bar is the price.
- **Role assignment:** for each role, the cheapest eligible listing whose profile offers it, ties in posting order. The terms template's `policyId` is replaced by the agreed primary's policy ID before the offer.
- **Seller policy:** three distinct addresses, each bench's profile offers its proposed role, registration validates, registry hash equals the registry Tide-7 trusts and every active model is dated (no alias), `policyHash` equals the hash of the policy, free bond ≥ `minFreeBondBps` of the price (default 10,000). Refusal is the one non-agree path.
- **Profiles are read as the agents read them,** before the primary reserves bond for the job (`Negotiation.listings`).
- **Clearfield is posted even when a test swaps its seam:** the listing is public data and selection happens before any seam acts.
- **Untrusted text:** registration names and reasons go through `plain` at ingestion (`source/simchain.ts`) and `esc`/`mdText` per surface.

## Handoff

**Done:** `apps/demo/agents/adjudicators.ts` (rules, proposal, seller review, profile views), profiles and `SWIFTLINE` in `cast.ts`, `BenchDirectory.publish`/`listings` and `publishSwiftline` in `bench.ts`, Swiftline keys and bond in `world.ts`, `AtlasAgent.proposeAdjudicators`, `TidewaterAgent.reviewAdjudicators` (with a policy option), `chooseAdjudicators` and the slate-driven `beatHold` in `beats.ts`; in `apps/demo/src/`, two new event kinds, `BeatTranscript.adjudicators`, narration, the viewer's collapsed profiles and a Markdown section. `docs/backlog.md` has two new rows.

**Not done:** counter-proposals; signed negotiation messages; effort applied to live judges (no live mode yet).

**How to resume:** `chooseAdjudicators(world, players(world, { seller }), terms)` runs the negotiation alone; `adjudicatorProfiles(holdResult)` gives the profile views.

**Open questions:** whether roles offered and per-judge effort belong in the registration (and so in `policyHash`) at the next schema bump.
