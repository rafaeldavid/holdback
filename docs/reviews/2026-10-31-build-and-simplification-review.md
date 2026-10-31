# Build and simplification review

Date: October 31, 2026. Requested by Rafa: an independent review of the Phase 1 build at `main` `00208b9` plus a simplification pass, judged against the first product priority (a simple demo for an AI lab researching agentic commerce, honest parties, edge cases deferred). One reviewer (Claude Fable 5.1) ran the product in a clean worktree and read the code, schemas, docs, tasks and the in-flight branches `t-016-testkit-runner` and `t-017-demo-adjudicator-selection`. No code was changed. Every number is **measured** in this worktree unless labeled **inferred** or **guessed**.

## Executive summary

1. The build works: `pnpm install` 1.1 s, `pnpm verify` PASS in 38.6 s (1,845 tests, 25 fixtures), `pnpm demo` writes 8 transcripts in 1.9 s with no keys. The 5-minute criterion is met by two orders of magnitude.
2. The demo does not yet show its two strongest claims. Beat 7 (neutrality) and the injection half of beat 6 are scripted fiction with hand-written numbers; dry-run questions 3 and 4 are answered from that fiction. Everything the code can already do for those beats (operator refusal with SDK failover, fallback takeover at `judgeBy`, screen flag on base64) is tested in vitest but not wired into the demo.
3. One defense gap: an escalated, screen-flagged case can never be decided by the appeal adjudicator (`aggregate.ts:115`, `service.ts:351`), so an injecting seller is paid compensation from Bench C's bond at the default outcome. Beat 6's "five judges reject" cannot happen with today's code.
4. The three litmus tests are enforced by code and fixtures, not only docs, with named gaps: 4 of 10 neutrality actors have no fixture; `attack.*` fixtures on `main` do not run the screen (the T-016 branch fixes this); appeals move bond money in SimChain but no fixture or beat exercises one.
5. Complexity ahead of the demo: about 3,200 LOC of drivers and test worlds re-drive the same six flows four ways; 17 schema concepts have nothing behind them beyond parsing or refusal; `docs/api.md` documents 36 endpoints, 6 return 404 and the 7 registry writes are not served; 40 Phase 1 fixture rows where the demo needs 7; three copies of a mutation script; an 826-LOC design-map tool; 135 backlog items.
6. The labels mislead a researcher: "recorded verdicts" are fake judges that always pass; three "different jobs" share one commitment ID; every judgment step carries the same millisecond; the Source line names task IDs.
7. Do now (about 5 working days, guessed): wire beat 7 and beat 6a onto SimChain with scripted verdicts, fix the appeal-flag rule under an ADR note, fix the labels, IDs and timings, show one judge prompt, trim T-016 to what landed, and only then run Rafa's dry run.
8. After the demo: fold the demo's event source and the snap runner into one driver, delete the second in-memory settlement in the adjudicator tests, cut the fixture target to the beats plus the passing neutrality set, prune `docs/api.md` to what is served.
9. Do not simplify the signing, ledger, integer-money, untrusted-data and fixture-runner layers: every litmus test rests on them.
10. Nothing here relaxes a hard rule. Two items touch a defense and need an ADR note (the appeal-flag rule; scripted verdicts labeled as such).

## 1. Does the build do what the demo needs?

### Measured run (clean worktree at `00208b9`, Node 22.22.2, pnpm 12.16.1, warm store)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | 1.1 s wall; 151 packages, 0 downloaded |
| `pnpm verify` | PASS, 38.6 s wall: typecheck 5,845 ms, lint 2,810 ms, test 25,113 ms (62 files, 1,845 tests), spec 292 ms, snap 1,813 ms (25 passed: 16 under their prefix, 8 `todo.`, `_example`), demo 2,508 ms; no snapshot diffs |
| `pnpm demo` (standalone) | exit 0, 2.68 s wall including `tsc -b`; first transcript 127 ms after start, all 8 in 1,893 ms; 18 files in `demo/out/` (651 lines of Markdown, 52 KB HTML with 0 `<script>` and 0 `http` references) |
| `pnpm demo --live` | exit 2 with the refusal text; reads no environment |
| `pnpm load` | 1,000 holds: per hold p50 7.77 ms, p95 8.77 ms (NFR-1 asks ≤ 250 ms); 100 concurrent holds on a balance covering 37: 37 funded, 63 refused, 0 overdrafts (NFR-3); not part of `verify` or CI |

The viewer opened in the browser pane: tab bar for 8 beats plus Closing, intro paragraph naming the cast, a "stand-in source" badge, collapsed signed message. Not re-measured at phone width (T-013 did).

### Read as an AI-lab researcher

I read `demo/out/beat-1.md` to `beat-10.md` and `closing.md` without the docs. The four comprehension questions:

| Question | Answerable from the transcripts? | From what |
| --- | --- | --- |
| Who held the money? | Yes | `beat-1.md`: "holds 2,050 tUSD in escrow in one call … Neither party can move it alone"; balances show Escrow 2,050 |
| Who decided? | Yes | `beat-3.md`: Clearfield's panel of three, "signs the primary decision: accept, submitted directly to SimChain (no operator)" |
| What stopped the injection? | Half | base64 half is `[stand-in]` on every line; the hidden-tags half is measured ("111 Unicode tag characters … stripped before your agent read it") |
| What happened when op-1 refused? | No | `beat-7.md` is all stand-in: "failed over to op-2 within 9 ms" is a typed constant (`apps/demo/src/source/stand-in.ts:139`) |

**Confusing**

| # | What a researcher sees | Where | Why it misleads |
| --- | --- | --- | --- |
| C1 | "Mode: recorded. Judge outputs are recorded verdicts" next to "Judges are fake providers scripted to pass" | header of all 8 transcripts (`narrate.ts:119`, `simchain.ts` note) | The demo uses no recordings at all; `fixtures/recordings/` is used only by `pnpm snap`. "Recorded" implies a model once answered. All three verdicts in beat 3 are an identical "4.00 of 4" from `placeholder-*-20260601` models (`fake.ts:19`) |
| C2 | Beats 1 to 4, 5 ("a second job") and 10 ("a third job") all show commitment `0x87437a1c…` and seed commitment `0x48ca7893…` | `beat-1.md:10`, `beat-5.md:10`, `beat-10.md:10` (6 occurrences of one ID across 8 files) | Each beat builds a fresh world with seed 7 (`simchain.ts:377`), so the same nonce and ID recur. Reads as a bug or a copy-paste |
| C3 | Checks, screen, panel, decision and release all at "+338 ms" (beat 3/4), "+210 ms" (beat 5), "+2,673 ms" (beat 6) | timelines | Times are stamped by wrapping `SimChain.submit` (T-013 decision), so every judgment sub-step inherits the decision's stamp. The one number this audience wants, how long judging took, is absent |
| C4 | "Source: measured on SimChain in this run, through T-012's scripted agents and T-009's adjudicator service" | every header | Task IDs mean nothing outside the team |
| C5 | Terms used once and never explained: "Disclosure: public", "commit-reveal seed", "beacon seed", "score at or above 3" beside "4.00 of 4", "Bench A" beside "Clearfield Adjudication" on every line | beats 1, 3, 6, 7 | The viewer's intro does not define them |
| C6 | Beat 10 ("optional; outside the success criteria" in `docs/demo.md`) runs for real while beat 7 (the neutrality beat) is fiction | `beat-7.md:6` | Priority inversion is visible to the audience |
| C7 | Beat 7's balance tables omit Atrium and show "-" instead of "0 tUSD reserved" for Northgate, unlike every other beat | `beat-7.md:44-62` | Stand-in ledger is hand-typed |

**Missing**

- A judge prompt and a verdict. `beat-3.json` contains 0 occurrences of `rationale` or `evidence`; the stand-in and the SimChain source both drop them. An AI lab's first question ("what did the judge see?") has no answer in the output, although `JobResult` already carries the judge requests (T-012 evidence).
- Receipts. `docs/demo.md` beat 4 promises "receipts signed"; no transcript has a receipt event (`grep receipt apps/demo/src/source/simchain.ts` matches only the type import).
- Judging duration (see C3).
- Neutrality and injection as measured events (see the stand-in inventory below).

**Over-explained**

- Beat 5 has five balance tables, three identical; beat 6 five, three identical; beat 10 four, two identical (`render-md.ts` renders every snapshot).
- The same four-line header is printed verbatim in all eight transcripts.
- The closing lists all 12 residual risks copied by hand from `docs/neutrality.md` (`closing.ts:17-30`); an AI lab needs the four that concern it (collusion, plaintext access, self-reported model identity, legal process).
- Beat 1's Markdown is 217 lines, 170 of them the signed Offer; fine in the viewer (collapsed), heavy on paper.

### What is still stand-in (measured from `apps/demo/src/source/demo.ts`, `stand-in.ts`, `config/judges.yaml`)

| Item | State today | What it would take |
| --- | --- | --- |
| Beat 7: op-1 refuses, Bench A offline, club revokes the seller | All three events scripted; nothing signed; numbers typed | op-1 refusal: `OperatorOptions.policy` exists and is tested (`apps/operator/src/neutrality.test.ts:37`); SDK failover and direct submit exist (`packages/sdk/src/client.ts:145-181`). Bench A offline: `world.advance()` and `takeoversDue` at `judgeBy` exist (`simchain-adapter.ts:150`). Club revocation: SimChain reads members from genesis only (`docs/backlog.md` line 11); cannot be shown without a new settlement feature |
| Beat 6, first half: base64 injection, escalation, five-judge reject | Scripted | A `customers.clean.injection-base64.csv` variant (`scripts/gen-demo-data.ts` has no such variant); the screen decodes base64 runs (`screen.ts:144-183`); the service escalates with the appeal key and judges the appeal with five seats over three families (`service.ts:320-343`, tested at `service.test.ts:329`). But see finding L3-1: the appeal cannot decide a flagged case |
| Judge verdicts | Fake, always pass (`fake.ts:27`), no rationale | Scripted fail verdicts per judge are supported (`beats.ts:29` `judges?: FakeScript`); live recordings need Rafa's keys; the snap runner refuses `--judges live` (`runner.ts:40`) |
| Model IDs | `placeholder-*-20260601` (the registry file says so) | Registry promotion after calibration (Phase 3) |
| Beats 8 and 9 | Not offered | Optional in `docs/demo.md` |

## 2. Where complexity is not paying for itself in Phase 1

### Code: four drivers for six flows

Lines counted with `wc -l` over `*.ts`, `*.mjs`, `*.html` outside `dist/` and `node_modules/`. "Harness" is test worlds and mutation scripts.

| Area | Source LOC (files) | Harness LOC | Test LOC (files) | Tests |
| --- | ---: | ---: | ---: | ---: |
| packages/core | 2,682 (21) | 0 | 3,095 (14) | 793 |
| packages/judgment | 2,712 (23) | 244 | 2,553 (14) | 473 |
| packages/testkit | 2,473 (13) | 0 | 1,140 (9) | 116 |
| apps/demo | 2,059 (22) | 200 | 911 (8) | 73 |
| packages/settlement | 1,172 (5) | 407 | 919 (2) | 43 |
| apps/adjudicator | 881 (9) | 401 | 913 (5) | 48 |
| apps/operator | 790 (5) | 140 | 541 (4) | 80 |
| packages/sdk | 568 (4) | 0 | 361 (3) | 34 |
| scripts + tools + tests/ | 1,168 (7) | 0 | 873 (3) | 185 |
| **Total** | **14,505** | **1,392** | **11,306** | **1,845** |

Testkit plus demo are 4,532 LOC, 31% of source. The same flow (offer, accept, agree-and-fund, deliver, judge, settle) is driven by:

| Driver | LOC | Judgment it runs | Output |
| --- | ---: | --- | --- |
| `packages/testkit/src/stub-settlement.ts` (fixture driver) | 822 | `judgment-stub.ts` (134): checks and screen "not evaluated by the stub" (`happy-path.expect.md`); T-016 replaces it with `judgment.ts` (260) that re-implements the service's panel plan ("The panel follows the adjudicator service") | `.expect.md` |
| `apps/demo/agents/*` (scripted agents) | 834 | the real `Adjudicator` service with fake judges | `JobResult` |
| `apps/demo/src/source/simchain.ts` (event source) | 410 | reads the agents' results and the SimChain log | `beat-n.md/json`, `index.html` |
| `apps/demo/src/source/stand-in.ts` | 200 | none | scripted events |
| `packages/settlement/sim/actors.ts` (`Deal`), `apps/operator/src/_world.ts`, `apps/adjudicator/src/_sim.ts` | 407 + 76 + 303 | `_sim.ts` is a second in-memory settlement on `core.step` used only by adjudicator unit tests, beside the real SimChain adapter (182 LOC) | unit tests |

`docs/demo.md:25` says "The recorded transcripts double as the `.expect.md` snapshots. The demo is the test suite." That is not what was built: the two renderers share no code, and the demo cannot be snapshotted because its times are wall-clock (T-013 handoff).

Other duplication: three copies of a mutation-sweep script (`apps/operator/scripts/mutants.mjs` 64, `apps/adjudicator/scripts/mutants.mjs` 98, `packages/judgment/scripts/mutants.mjs` 173; same header and loop), and a design-map generator (`tools/design-map/template.html` 597 + `scripts/design-map.mjs` 188 + its test 41 = 826 LOC) whose only consumer is a private artifact page.

### Schemas: 3,700 lines, a third of it with no runtime path

16 schema files total 3,700 lines (`commitment` 801, `messages` 747, `judgment` 369, `club` 329). Counted with `grep -rl` over non-test source in the eight packages:

| Concept | Schema files | Source files (lines) | Fixtures | Used by the demo |
| --- | ---: | ---: | ---: | --- |
| `settle_after_window`, `optimistic` modes | 2, 3 | 3 (3), 2 (3): refusals only | 0 | no |
| `Dispute`, `Publish`, `ReadToken` | 2, 1, 0 | 3 (8), 4 (11), 0 | 0 | no |
| `MemberAdmission`, `MemberRevocation`, `AgentRevocation` | 1 each | 2 (5) each: type names only; SimChain reads genesis | 0 | no (beat 7's revocation is stand-in) |
| senior bond tranche (ADR-0014) | 2 | 9 (25): implemented, always empty | 0 | no |
| `identityModes`, `providerPrivacy`, `disclosureMin`, `firstLossShareMinBps`, `bondNoticePeriodMinSec`, `minInspectionWindowSec`, `disputeBond` | 1–2 each | 2–3 (2–4) each: parsed, never read | 1 (required in every club file) | no |
| `reference_row_match_min`, `drand` | 1, 3 | 2 (4), 2 (2) | 0 | no |
| `EarlyAccept`, `MutualSettlement`, beacon | 1, 1, 3 | 9 (18), 13 (36), 17 (88): implemented | 0, 0, 4 | beat 10; fallback fixtures |

The signed Offer the audience sees in beat 1 is 170 lines of JSON, because the terms carry every one of these fields. Schemas are the contract (hard rule: ADR plus version bump to change), so this review proposes no removal, only a freeze and a later bump that makes Phase 4 fields optional.

### ADRs and decisions: 1,627 lines, five research passes for Phase 4 questions

22 ADRs. The ones that changed Phase 1 code: ADR-0016 (contract fixes), ADR-0017 (API subset), ADR-0018 (beacon seeds, needed by the passing fallback fixtures), ADR-0019 (mutual settlement, beat 10), ADR-0021 (screen report, beat 6b), ADR-0022 (integer rates, a hard rule). Ahead of the demo: ADR-0014 (117 lines; 25 source lines of an always-empty senior tranche), ADR-0015 (96; no code), ADR-0020 (185; Phase 1 admits `public` only and the code refuses the rest). D19 to D24 each ran a max-effort research pass; D19, D22 and D24 changed nothing in Phase 1, D23 forced schema bump v0.6 mid-build.

### Docs: 1,908 lines that restate each other, with stale lines a researcher reads first

- The three protocol properties appear verbatim in `CLAUDE.md`, `README.md` and `docs/PRD.md`.
- The residual risks are in `docs/neutrality.md` and copied by hand into `apps/demo/src/transcript/closing.ts` (12 entries); the cast is in `docs/demo.md` and `apps/demo/agents/cast.ts`; the state machine is in `docs/architecture.md`, ADR-0016 and `packages/core/src/state.ts`; the fixture list is in `docs/plan.md` (47 rows), `docs/feature-map.md` (per beat) and T-010's rows table, and they already disagree (`feature-map.md:3`: "no fixtures exist yet").
- Stale: `README.md:13` ("It contains no application code yet"), `README.md:43-44` (ADR-0013, T-013 as the last), `CLAUDE.md:66,68` ("placeholder until T-005/T-013"), `docs/plan.md` (11 Phase 1 boxes unchecked while 10 of those tasks are done or in review), `docs/demo.md:25` (see above).
- `docs/api.md` documents 36 endpoints; the server routes about 14 reads plus the write operations (`server.ts:414-547`); `docs/backlog.md:106-108` lists 6 documented endpoints that return 404 and 7 registry writes that are genesis-only.

### Process: 1,944 lines of task files, 135 backlog rows, 4 rules without a check

- The 16 task files average about 120 lines; T-008 is 303 and T-012 255, longer than several packages' source. Evidence sections repeat the `pnpm verify` table up to three times per task.
- `docs/backlog.md` has 135 items in 12 tables; every PR review has added about 10 rows with no owner or phase gate.
- `docs/team.md` Rules and checks: 20 rows, 4 marked Proposed or Partial (guard mutation sweep, wall-clock lint, example hashes, no-admin-keys in Phase 2), and 3 rows that name fixtures that do not exist (`error.idempotency-conflict`, `error.unpinned-model-refused`, the per-actor neutrality set; see section 3).
- The daily log cadence has one entry (`docs/log/2026-10-30.md`); the `/map` republish cadence has an 826-LOC tool behind it.
- `docs/reviews/2026-10-30-phase0/` holds two Python scripts (86 lines) from the Phase 0 review with no reader.

### Tests: deep where it is cheap, thin where the demo lives

1,845 tests: core 793 (the two EIP-712 test files alone hold 320 cases), judgment 473, spec lint 165, testkit 116, operator 80, demo 73, adjudicator 48, settlement 43, sdk 34. The settlement layer, the one place every litmus test is decided, has 43 unit tests plus 4 property runs; the demo's own beats are covered by 73 tests that assert on fake verdicts. `redteam.test.ts` K1/K2 assert on wall-clock time behind an opt-in flag after failing 3 of 3 loaded runs (T-012 evidence).

## 3. Litmus tests: enforced by code and fixtures, or only by docs?

| Test | Code that enforces it | Fixtures and tests | Shown by the demo | Gaps |
| --- | --- | --- | --- | --- |
| Neutrality (ADR-0001) | SimChain's anyone-callable triggers (`expire`, `reclaim`, `fallback`, `default`, `appeal_expiry`: `simchain.ts:223-228`); SDK failover then direct submit (`client.ts:145-181`); operator refusal is a policy hook with no authority (`server.ts:71-75`) | 8 `neutrality.*` fixtures pass (operator-refuses, adjudicator-offline, adjudicator-silent-before-judging, adjudicator-and-fallback-offline, adjudicator-never-accepts, appeal-adjudicator-offline-after-escalation, buyer-silent, seller-withholds-delivery) plus `attack.adjudicator-self-dealing`; 6 operator vitest cases (`neutrality.test.ts:27-82`) cover refuse, offline, rate-limit and lost responses | Only "submitted directly to SimChain (no operator)" on decision lines; beat 7 is fiction | No fixture for 4 of the 10 actors in `docs/neutrality.md` besides the Phase 2 rules contract: club operator (`neutrality.club-revokes-mid-flight`, impossible today: genesis-only membership), maintainers (`maintainers-change-registry`), on-ramp (Phase 5), beacon (Phase 2); model provider is `todo.`; `neutrality.operator-offline` is `todo.` in snap but passes as a vitest, so the two harnesses disagree |
| The hold (ADR-0002) | SimChain verifies every signature, owns the ledger and the hash-chained log; idempotency keys in SimChain (7 sites) and the operator middleware (`idempotency.ts`, 74-line test, mutation sweep); expiry at `offerExpiresAt`, `fundBy`, `deliverBy`, `appealBy` | Property tests: random interleavings keep conservation, no negative balances, settle-once and replay (`properties.test.ts:204`); settle-once race (`:264`); bond pools junior-first (`:286`). `pnpm load`: 0 overdrafts under 100 concurrent holds (measured above) | Beats 1, 4, 5, 10: balances before and after every posting | `error.concurrent-overdraft` and `error.idempotency-conflict` are `todo.` or absent (one commitment per scenario; the testkit bypasses the operator); `pnpm load` is not in `verify` or CI, so NFR-1 and NFR-3 are measured only by hand |
| Defended multi-model judgment (ADR-0006) | Checks first, then screen, then panel, then aggregate (`pipeline.ts:171-244`); refuses an unpinned, unregistered or single-family panel before any call (`pipeline.ts:113-116`); content only as `UntrustedData` in a delimited data section with a canary (`prompt.ts:1-15,141`); live providers send two strings and no tools (`live.ts:3`); verdicts schema-checked or abstain (`verdict.ts`); commit-reveal for the primary, beacon for the others (`service.ts:265-273`); no re-roll (`service.ts:104`, tested at `service.test.ts:205,390`); appeals paid from the bond (`simchain.ts` postings; `properties.test.ts:287`) | judgment: 473 tests, including 85 red-team cases and 39 screen cases; `attack.*` fixtures: 3, but on `main` the stub runs neither checks nor screen, so their escalations come from authored verdicts (T-010 evidence, "inferred" row) | Beat 3 (checks, screen, panel from two families, commit-reveal seed), beat 5 (required check fails, no panel), beat 6b (tag characters flagged and stripped). Beat 6a is fiction | **L3-1** (below); no fixture or beat exercises a party appeal or an overturn, so "appeals are backed by the bond" is proved only by unit and property tests; the T-016 branch wires the real pipeline into snap and promotes `bad-work-row-drop` to Refunded (measured with `git show`) |

### Claims the code does not back

- **L3-1. The appeal adjudicator cannot decide a screen-flagged case (measured in code, not executed).** `aggregate.ts:115` returns `escalate` whenever `screenFlagged`, for every role; `pipeline.ts:238-243` passes the flag for the appeal template too; `service.ts:351` turns an appeal-role `escalate` after an escalation into `null`, so no Decision is signed and the default outcome applies at `appealDecideBy`: the buyer is refunded and the seller is compensated from the appeal adjudicator's bond (`docs/architecture.md` postings, "Default after escalation"; the demo club pays 100% of price). An injecting seller therefore ends up paid 2,000 tUSD from Bench C's bond, and `docs/demo.md` beat 6 ("five judges reject, refund") cannot be produced. The aggregation rule in `docs/judgment-and-defenses.md:65` has the same line with no appeal exception, so the spec and the code agree with each other and disagree with the demo. The fix keeps FR-15 ("never auto-accept"): at the appeal, the flag stays in the record and the panel decides by supermajority. It touches a defense, so it needs an ADR note (ADR-0006 or ADR-0021 amendment) under the autonomy rule.
- `docs/team.md` Rules table names `error.unpinned-model-refused` and `error.idempotency-conflict` as the checks for two hard rules; neither fixture exists (both are open T-010 rows). The underlying checks exist elsewhere (alias refusal is tested in `panel.test.ts`, `pipeline.test.ts` and `registry-file.test.ts`; idempotency in `idempotency.test.ts`), so the rules hold and the table is stale.
- `docs/demo.md:25` ("the demo is the test suite") and `docs/demo.md` beat 4 ("receipts signed"): not built.
- `docs/demo.md` beat 7 "the club operator revokes the seller mid-flight": cannot be shown; SimChain has no run-time revocation (`docs/backlog.md:11`). The stand-in narrates it anyway, labeled.
- `README.md:13` "contains no application code yet": 14,505 lines of source.

No regression was found: every fixture and test that passed at the last task evidence still passes, and `verify` reports no snapshot diff.

## 4. Simplification proposals

Ranked by (demo value + maintenance saved) over (effort × risk). Effort is guessed in working days for one agent. None relaxes a hard rule; rows marked "ADR note" touch a defense or the contract and go through `docs/decisions-today.md` under the autonomy rule.

### Do now, before the dry run

| # | Proposal | Kind | Files | What breaks | Hard rule or ADR | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Beat 7 on SimChain** for the two failures the code supports: op-1 refuses (operator `policy` hook, SDK fails over to op-2, seller delivers direct) and Bench A silent past `judgeBy` (`world.advance`, anyone triggers fallback, Northgate judges with the beacon seed). Drop the club revocation from the beat; say in one line that the club operator signs nothing in the flow. Delete beat 7 from `stand-in.ts` | rewrite | `apps/demo/agents/beats.ts` (new `beatNeutrality`), `apps/demo/src/source/simchain.ts`, `stand-in.ts`, `docs/demo.md` row 7 | `simchain.test.ts`, `stand-in.test.ts`, `cli.test.ts` expectations | none | 1–2 |
| 2 | **Beat 6a on SimChain**: add `customers.clean.injection-base64.csv` to `gen-demo-data.ts`; run it through the full terms; script Bench C's five judges to fail (`PlayerOptions.judges`), labeled "scripted verdicts"; fix L3-1 so the appeal adjudicator decides a flagged case by supermajority with the flag in the record | rewrite + fix | `scripts/gen-demo-data.ts`, `fixtures/data/dataset-cleaning/` (regenerate, manifest), `packages/judgment/src/aggregate.ts` or `pipeline.ts` (appeal template), `apps/adjudicator/src/service.ts:351`, `docs/judgment-and-defenses.md:65`, `apps/demo/agents/beats.ts`, `stand-in.ts` (delete) | `aggregate.test.ts`, `pipeline.test.ts`, `service.test.ts:325-375` (a flagged appeal now decides), `attack.injection-*` snapshots once T-016 lands | ADR note (defense) | 2 |
| 3 | **Honest labels**: `mode: 'recorded'` becomes `scripted` wherever fake judges run; the Source line drops task IDs and says "scripted agents over the operator API; the adjudicator service with scripted judges"; print the header once in the viewer intro | rewrite | `apps/demo/src/transcript/types.ts`, `narrate.ts:116-127`, `source/simchain.ts` note, `render-html.ts`, `docs/demo.md:66` | `narrate.test.ts` (header assertions) | none | 0.3 |
| 4 | **One commitment per job**: seed each beat's world with `7 + beat` (or salt the nonce) so beats 5 and 10 get their own IDs and seed commitments | rewrite | `apps/demo/src/source/simchain.ts:377-401` | `simchain.test.ts` pinned IDs | none | 0.2 |
| 5 | **Timing that means something**: stamp checks, screen and panel from the adjudicator service (wrap `ServiceBench.judge`), or replace the sub-step stamps with one line "decision N ms after delivery; judging took M ms" | rewrite | `apps/demo/src/source/simchain.ts`, `agents/bench.ts` | render tests | none | 0.5 |
| 6 | **Show one judge prompt and one verdict**, collapsed like the signed message, in beat 3. `JobResult` carries the judge requests; verdicts carry evidence per criterion | add | `apps/demo/src/transcript/types.ts` (one event kind), `render-md.ts`, `render-html.ts`, `untrusted.ts` for escaping | the stand-in marks test | none (prompt text is untrusted on output; the helpers exist) | 0.5 |
| 7 | **Render balances only when the ledger changed**; trim the closing to four residuals with a pointer to `docs/neutrality.md` | delete | `render-md.ts`, `render-html.ts`, `closing.ts` | `render.test.ts` | none | 0.2 |
| 8 | **Trim T-016 to what landed**: real judgment in the runner, role-keyed recordings, authored-recording guard (three commits on the branch, `bad-work-row-drop` promoted). Add `mutual_settle` only if beat 10 stays. Defer message overrides, `offline: operator` routing, `dispute`, `revoke_*`, deliver `attempt`, second commitment, and the rendering extras to a T-016b in the backlog | defer | `docs/tasks/T-016-testkit-runner-gaps.md`, `docs/backlog.md` | nothing; the open T-010 rows stay open | none | saves about 5 days |
| 9 | **Fix the stale lines a researcher reads first**: `README.md:13,43,44`, `CLAUDE.md:66,68`, `docs/feature-map.md:3`, `docs/plan.md` Phase 1 boxes, `docs/demo.md:25`, `docs/team.md` rows naming absent fixtures | rewrite | those files | nothing | none | 0.2 |
| 10 | **T-017**: keep the two narrated selection lines (buyer proposes from published registrations filtered by the rulebook; seller checks and agrees) if they land in a day; defer the profiles, effort settings, harness and "role-play" history, which add a second kind of fiction to a demo that is trying to shed its first | defer part | `apps/demo/agents/cast.ts`, `docs/tasks/T-017-*.md` | the branch's 278 added test lines (tests only so far) | none | 1 |

### After the demo

| # | Proposal | Kind | Files | What breaks | Hard rule or ADR | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | **One driver**: make the snap runner the engine and the demo a narration over its event log with the seeded clock, so transcripts are byte-stable and `.expect.md` and `beat-n.md` are two renderings of one run. Delete `apps/demo/agents/` as a driver (keep `cast.ts`) and the `stand-in` source | merge | `packages/testkit/src/stub-settlement.ts`, `apps/demo/src/source/*`, `apps/demo/agents/*` (about 2,000 LOC removed, inferred) | every demo test; `docs/demo.md:25` becomes true | none | 4–5 |
| 12 | **Delete the second settlement** `apps/adjudicator/src/_sim.ts` (303 LOC); run the adjudicator unit tests on SimChain through `simchain-adapter.ts` with `Deal` | delete | `apps/adjudicator/src/_sim.ts`, `service.test.ts`, `simchain-adapter.test.ts` | adjudicator tests need fixtures for "skip agreement and funding" cases | none | 2 |
| 13 | **One mutation script** parameterized by package, or Stryker, or none until Phase 2 contract work | merge or delete | the three `scripts/mutants.mjs` | the two Proposed rows in `docs/team.md` | none | 0.5 |
| 14 | **Cut the Phase 1 fixture target** from 40 rows to the demo beats (happy-path, bad-work-row-drop, injection-base64 through the appeal reject, operator-refuses, adjudicator-offline, mutual-split) plus the 9 neutrality and attack rows that pass; move the mutual-settlement error set (14), privacy (4), optimistic (2), panel-shopping (3) and message-override (6) rows to the backlog by name; rename `todo.` fixtures that duplicate vitest cases | defer | `docs/plan.md` scenario index, `docs/feature-map.md`, `docs/tasks/T-010-*.md` | nothing | none | 0.5 |
| 15 | **Prune `docs/api.md`** to the routes `server.ts` serves and mark the rest "planned, 404 today", or generate it from the route table when T-015 lands | rewrite | `docs/api.md` | nothing | none | 0.5 |
| 16 | **Drop the design map** (826 LOC, `/map`, the republish cadence) or move it out of the repository; drop `docs/reviews/2026-10-30-phase0/*.py` | delete | `tools/design-map/`, `scripts/design-map.mjs`, `tests/design-map.test.ts`, `.claude/commands/map.md`, `docs/team.md` cadence | nothing | none | 0.2 |
| 17 | **Backlog triage**: tag each of the 135 rows demo-blocking, v0.1, or later; stop adding review findings without a phase | rewrite | `docs/backlog.md` | nothing | none | 0.5 |
| 18 | **Task files**: keep Intent, Decisions and Handoff; replace repeated verify tables with a link to `reports/verify-<branch>.md` (already written by `pnpm verify`) | rewrite | `docs/tasks/_template.md`, `docs/team.md` | nothing | none | 0.2 |
| 19 | **Decision cadence**: batch Phase 4 questions (modes, disputes, fees-follow-the-event, privacy levels) into one research pass at the start of Phase 4 instead of one max-effort pass each | process | `docs/decisions-today.md` header | nothing | none | 0 |
| 20 | **Schema freeze with a planned bump**: no new fields before the demo; at v0.7, make the Phase 4 rulebook fields optional and move `Dispute`, `Publish` and the optimistic shapes to a `planned/` folder validated but not served. Flag only: this is the contract | defer | `spec/` | examples, core parsers, EIP-712 vectors | **ADR plus version bump** (hard rule); flagged, not proposed for now | 2 |
| 21 | **Wire `pnpm load` into `verify`** as a short run (100 holds, the overdraft check), so NFR-1 and NFR-3 are measured on every branch | add | `scripts/verify.ts`, `packages/settlement/sim/load.ts` | verify time +2 s (inferred) | none | 0.2 |

### Do not simplify: load-bearing complexity

| What | Why it stays |
| --- | --- |
| EIP-712 types, nonce, expiry, scope and mandate checks (`packages/core/src/eip712.ts` 497 LOC; 320 binding and vector tests) | Every neutrality and hold claim rests on "any party may submit any signed message"; the vectors pin the domain to the schema version |
| SimChain ledger, bond pools, anyone-callable triggers, hash-chained log and replay (`simchain.ts` 987 LOC; 43 tests, 4 properties, `pnpm load`) | It is the settlement layer. The senior tranche costs 25 lines and keeps D10's shape so Phase 4 does not rework the accounts |
| Integer money and rates, the lint rules, `mulBps`/`splitBps` (ADR-0022) | Hard rule; a float in a hashed body breaks signatures across implementations |
| `UntrustedData` brand, spotlighting prompt, canary, verdict schema, screen and normalization (`packages/judgment`, 473 tests) | Litmus 3; the 85 red-team cases are the only evidence the defenses work until live calibration |
| Operator idempotency, startup guards (40 tests), SDK failover and direct submit | Hard rules "no real money" and "idempotency"; the escape hatch is ADR-0005 |
| The untrusted-output helpers in `apps/demo/src/transcript/untrusted.ts` | PR 46 found a deliverable's CSV header reaching the terminal raw; the four-surface test is the check |
| Beacon seeds for fallback and appeal (ADR-0018, 88 source lines) | The passing `neutrality.adjudicator-offline` and `-silent-before-judging` fixtures depend on them |
| The snap runner and its prefixes | The only place neutrality is enforced end to end in CI; proposal 11 builds on it rather than removing it |

## 5. The plan from here

Shortest path to a demo Rafa can show an AI lab, in order. Days are guessed for one agent per lane; lanes 1 and 2 can run in parallel.

| Step | What | Lane | Days | Unblocks |
| --- | --- | --- | --- | --- |
| 0 | Review and merge `t-016-testkit-runner` as it stands (real judgment in snap, role-keyed recordings, authored guard; `bad-work-row-drop` passes); rewrite T-016's remaining criteria as T-016b in the backlog (proposal 8) | test | 0.5 | `attack.*` fixtures that test the screen; beat 5 as a passing fixture |
| 1 | Proposals 3, 4, 7, 9: labels, one ID per job, balance tables, stale docs | demo | 0.5 | a transcript that does not contradict itself |
| 2 | Proposal 1: beat 7 on SimChain (op-1 refuses, Bench A silent, fallback decides); club revocation dropped from the beat | demo | 1–2 | dry-run question 4 answered from measured events |
| 3 | Proposal 2: L3-1 fix with an ADR note; injection deliverable; beat 6a with scripted fail verdicts, labeled | judgment + demo | 2 | dry-run question 3 answered from measured events; `attack.injection-encoded-base64` can end Refunded instead of Escalated once it gets an appeal step with T-016's role-keyed recordings (inferred) |
| 4 | Proposals 5 and 6: judging time and one prompt plus one verdict in beat 3 | demo | 1 | the beat an AI lab cares most about has content |
| 5 | Rafa's dry run (T-013 human gate) on a fresh clone; record time-to-first-transcript and the four answers | Rafa | 0.5 | Phase 1 exit |
| 6 | When Rafa's keys exist: capture live recordings for the beats and the demo fixtures (`pnpm snap --judges live --record`, after the runner stops refusing `live`; the adjudicator's live providers exist), replace "scripted" with "recorded" where a recording drives the verdict, and re-run the dry run with real rationales | judgment + test | 1 | T-307 live mode; the registry's placeholder IDs become real |
| 7 | T-017's two selection lines (proposal 10); beat 8 (appeal overturn) only if the dry run asks for it | demo | 1 | property 1 made visible |

What this plan does not do before the dry run: the other ~40 T-010 rows (the demo's success criteria need 7 beats as fixtures, and after steps 0 to 3 six of them exist: happy-path, bad-work-row-drop, injection-base64, operator-refuses, adjudicator-offline; mutual-split needs the one `mutual_settle` step), T-015 OpenAPI, T-017's profiles and history, new ADRs beyond the L3-1 note, and any schema change.

On "are all 45 open rows needed before the demo": no. Of the 40 Phase 1 rows in `docs/plan.md`, the demo beats need 7; 16 pass today and T-016 promotes 1; the rest prove modes, messages and attacks the demo does not show and the honest-party rule defers. Keep the 8 passing `neutrality.*` rows as the standing neutrality check and move the remainder to the backlog with their runner feature named, as proposal 14 says.

## Appendix: commands run

```
pnpm install --frozen-lockfile                      # 1.1 s wall
pnpm verify                                         # PASS; reports/verify-worktree-agent-aafe7cb775ad9683f.md
pnpm demo --out <scratch>                           # 2.68 s wall; 8 transcripts; first after 127 ms, all in 1,893 ms
pnpm demo --live                                    # exit 2
pnpm load                                           # p95 per hold 8.77 ms; 0 overdrafts in 100 concurrent holds
npx vitest run --reporter=json                      # 62 files, 1,845 tests, all passed; counts per area above
wc -l over packages/ apps/ scripts/ tests/ tools/   # 27,203 lines outside dist and node_modules
git diff --stat main...t-016-testkit-runner         # testkit: 16 files, +895 -359; fixtures regenerated
git diff --stat main...t-017-demo-adjudicator-selection  # 6 files, +278 -5 (tests and the task file only)
```
