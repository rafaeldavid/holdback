# T-398: the docs after the cutover

- **Lane:** docs, on `main`
- **Phase:** 2
- **Kind:** 2 (docs; `docs/team.md`, Change recipes): one reviewer per pull request, no red team
- **Depends on:** the phase-one cutover of 2026-11-13 (T-383; PRs 475, 477, 478 and 479 merged into `main`; the tag `contracts-phase-one-1` on `27ab44e`)
- **Paths this task may touch:** the docs listed below, `tools/design-map/template.html`, the contract stack's inputs (`tools/contract-stack/`, `scripts/contract-stack.mjs` where an input is read), `scripts/record-copies.mjs`'s list of history docs, a new redeploy runbook under `docs/`, this file. Off limits: `contracts/src`, the guides under `site/` (another session owns the site), tier-3 files (`.github/`, `agent-ops/`, `AGENTS.md`, `.gitleaksignore`, `CLAUDE.md`, `.claude/`), behaviour, and the meaning of any test.
- **Human gate:** no deploy, nothing outward-facing except republishing two existing private artifacts at their own URLs.
- **Status:** done
- **Agent/session:** the T-398 session, started by the coordinator on 2026-11-13

## Intent

On 2026-11-13 the phase-one contracts went live on Sepolia: no party appeals and no bonds on chain, one token, the buyer's payment address and the seller's payout address, EIP-712 domain 0.8, schema 0.11, and an operator fee of 0 for the first pilots. `main` holds the build, the record `contracts/deployments/sepolia.json` and the tag. Many docs still describe the deployment of 2026-11-04 (domain 0.7, with a bond vault and appeals) as live, or speak of the freeze as a future step.

This task makes the public docs, and the inputs of two generated pages, say what `main` does today. Each edit is the smallest one that makes the doc true. A standing doc points to the source of an address, version, count or size (the record's field, a constant, a script) instead of copying the value; dated records keep their values (Rafa, 2026-11-12 and 2026-11-13). Where a doc and the code disagree and the right one is unclear, the item stops and is reported with both readings.

The work ships as four pull requests, one per series:

1. **Fresh drafts:** the four docs the inventories mark for a fresh draft.
2. **Edits:** every doc the inventories mark "needs edits", outside the site guides.
3. **The generated pages:** the design map's template and the contract stack's inputs, then both pages regenerated and republished at their existing URLs.
4. **The runbook split:** `docs/cutover-phase-one.md` becomes the dated record of the 2026-11-13 cutover, and a reusable redeploy runbook for `contracts-phase-one-2` is drawn from it and from the day sheet (`docs/tasks/T-383-deploy-script-cu1.md`, Part 2, with PR 478's fixes).

The sources are the two inventories of 2026-11-13: `reports/docs-inventory-2026-11-13.md` (the first read) and `reports/docs-inventory-2026-11-13-second-read.md` (the second read, with the generated pages' inputs). This task works the union of both lists. Both were read at `origin/cutover-phase-one` `3cb9428`; PR 477 has since rewritten parts of `docs/operations.md` and `docs/audit/scope.md`, so each row is checked on `main` before it is edited.

## Files

**Fresh drafts (PR 1):** `README.md` (the Status section and the lines that name the 0.7 contracts as current), `docs/architecture.md`, `docs/audit/scope.md` (what PR 477 left stale), `docs/operations.md` (the standing runbook first, the dated deploy records in one section after it).

**Edits (PR 2):**
- From the second read: `contracts/README.md`, `docs/api.md`, `docs/audit/events.md`, `docs/audit/invariants.md`, `docs/audit/known-issues.md`, `docs/audit/test-quality.md`, `docs/audit/threat-model.md`, `docs/demo.md`, `docs/neutrality.md`, `docs/plan.md`, `docs/writing.md`, `formal/README.md`, `tools/duet/README.md`.
- From the first read only: `SECURITY.md`, `docs/PRD.md`, `docs/judgment-and-defenses.md`, `docs/quickstart.md`, `docs/team.md`, `docs/audit/state-model.md`, `fixtures/README.md`, `tools/sim/README.md`. Each is checked first; a row already true on `main` is closed with that reason.
- Reported, not edited (the site's owner fixes them): `site/ref/http-seller.txt` and `site/ref/http.txt` (values to replace with pointers), `site/ref/http-buyer.txt` (the agree-and-fund example sends `operatorFeeNonce` at fee 0).

**Generated pages (PR 3):** `tools/design-map/template.html`; the contract stack's inputs (`tools/contract-stack/plain.json`, the findings' status, the smoke deal's gas). Pages: the design map and the contract stack, each republished at its existing private artifact (the URLs are in `.claude/commands/map.md` and the private log).

**Runbook split (PR 4):** `docs/cutover-phase-one.md`, a new redeploy runbook, and the pointers to it.

**Listed, not changed (tier 3, Rafa's word per PR):** `CLAUDE.md:54`, "Arbitration can be private too", to read "Judging can be private too".

## Acceptance criteria

- [x] Every "fresh draft" and "needs edits" row of both inventories is closed by an edit, or reported here with a reason.
- [x] No standing doc in this task's list names the 2026-11-04 deployment, domain 0.7 or schema 0.10 as live, or the freeze as a future step.
- [x] Each standing doc points to the record's field or the source file for an address, version, count or size, where it can; dated records keep their values.
- [x] The design map's template says which of appeals and bonds is on chain in phase one (neither) and which SimChain keeps (both).
- [x] The contract stack's findings agree with `docs/audit/known-issues.md`, its gas figure is the phase-one smoke deal's or is read from a source, and `plain.json` says the operator fee is 0 for the first pilots.
- [x] Both pages regenerated, each live artifact's source read in full, both republished at their existing URLs and read back.
- [x] `docs/cutover-phase-one.md` is a dated record; one redeploy runbook covers `contracts-phase-one-2`, with Sourcify's API v2 route and the wait between creates (as a manual nonce check before a rerun; the script's own wait is a follow-up, below).
- [x] Each pull request passes `pnpm typecheck`, `pnpm lint`, `node site/build.mjs && node site/check.mjs`, the doc-reading tests and `tests/cut-feature-alignment.test.ts`; `pnpm validate:spec` if an example changes.
- [x] One reviewer per pull request; findings fixed; merged by hand once `check` and `gitleaks` pass.

## Evidence

**Four pull requests, merged by hand into `main`** after `check` and `gitleaks` passed and each reviewer's findings were fixed [measured on GitHub]:

| Part | Pull request | Merge commit | Reviewer verdict, then |
| --- | --- | --- | --- |
| 1. Fresh drafts: `README.md`, `docs/architecture.md`, `docs/audit/scope.md`, `docs/operations.md`, this file | 482 | `3b35a25` | ISSUES (7 Low, 4 Info), fixed in `48bcb8c` |
| 4. `docs/cutover-phase-one.md` as the dated record; the runbook `docs/redeploy-contracts.md` | 483 | `3bdb4e8` | ISSUES (1 Medium, 10 Low), fixed in `1bad040` |
| 2. The edits: 20 files | 484 | `ebbfd18` | ISSUES (1 High: the T-314 test in `apps/demo-cloud/src/world.test.ts` pins "1,000,000 tUSDC" in `docs/api.md`; CI's `test (2/4)` failed), fixed in `23886c0` |
| 3. The generated pages' sources | 487 (replaces 486) | `945181b` | ISSUES (2 Medium, 5 Low), fixed in `2f48f23` |

PR 486 was closed unmerged: its branch needed the rebase onto PR 483, and a force push is Rafa's gate, so the same commits went up as a new branch and PR 487.

**Inventory rows** (both files of 2026-11-13, read at `3cb9428`; each checked again on `main`):
- **Fresh draft, closed by edit:** `README.md` (Status as of 2026-11-13), `docs/architecture.md` ("What runs where"; the full protocol's appeals and bonds in one section), `docs/audit/scope.md` (what PR 477 left), `docs/operations.md` (the standing runbook first, the dated "Deploy record" last). The deploy log stays inside `operations.md`: the deploy scripts print "The record line for docs/operations.md", and Crow Control parses its `**Live since` lines and its funding-lane line [measured: `grep` of the scripts and of crow-private `control/console.mjs` and `inputs.mjs`].
- **Retire or merge, closed:** `docs/cutover-phase-one.md` is the dated record of 2026-11-13; `docs/redeploy-contracts.md` is the standing runbook.
- **Needs edits, closed by edit:** `contracts/README.md`, `docs/api.md`, `docs/audit/events.md`, `docs/audit/invariants.md`, `docs/audit/known-issues.md`, `docs/audit/test-quality.md`, `docs/audit/threat-model.md`, `docs/audit/state-model.md`, `docs/demo.md`, `docs/neutrality.md`, `docs/plan.md`, `docs/writing.md`, `formal/README.md` (partly: see Handoff), `tools/duet/README.md`, `docs/PRD.md`, `docs/judgment-and-defenses.md`, `docs/quickstart.md`, `docs/team.md`, `fixtures/README.md`, `tools/sim/README.md`.
- **Closed with no edit:** `SECURITY.md` names the escrow.stream hostnames as old ones that still forward (`docs/operations.md`, What is live). `docs/plan.md:58`: the phase-one rows stay under Phase 2, each saying where its work landed. `docs/audit/scope.md` keeps chain ID 11155111 in its summary: it is the chain `--check` asserts, in an audit page pinned to the tag.
- **Reported, not edited (the site's owner):** `site/ref/http-seller.txt` copies the `DEFAULT_TIMING` offsets and the window floors; `site/ref/http.txt:62` copies "1,000 tUSDC" and the base-unit cap (its "1,000,000 tUSDC" beside `maxGrant` is pinned by the T-314 test and stays); `site/ref/http-buyer.txt` copies a block time and its agree-and-fund example sends `operatorFeeNonce` at fee 0.

**The generated pages** [measured]:
- **Design map** `https://claude.ai/artifact/4nAPcSGQz6nL5mb8AuDhd2`: version 34 read in full, compared line by line with the new build (only the template's intended lines differ; the data differs by the merges 479 to 487 and this task's row), republished as **version 35** (id `1794560527-0fb4`) from `main` at `945181b`, read back. Built without the private log, as version 34 was: the log's "Live" section predates the switch-over.
- **Contract stack** `https://claude.ai/artifact/74UsLdCNQERZYrDiE5F9tj`: version 8 read in full (477 lines), republished as **version 9** (id `1794560490-e5d1`) from `945181b`, read back. Findings: H-2 limit open (Medium); M-1, M-3, L-2, L-3, L-5, L-7 and I-8 not in phase one; every other finding fixed. Sepolia gas: fund 581,420, deliver 174,012, decide 524,804, total 1,280,236 gas, read from `docs/operations.md`.

**Checks** at each pull request's head [measured]: `pnpm typecheck` and `pnpm lint` pass; `node site/build.mjs && node site/check.mjs` PASS; `pnpm exec vitest run tests/` passes (464 to 465 tests across the PRs), and with `apps/demo-cloud/src/world.test.ts` 512 to 514. `pnpm validate:spec` was not needed: no example changed.

## Handoff

T-398 is done. Left, each for its owner:

1. **Tier 3, Rafa's word:** `CLAUDE.md:54`, "Arbitration can be private too", to read "Judging can be private too". Not changed.
2. **The site guides** (the site's owner): the three items under "Reported, not edited" above.
3. **Redeploy tooling** (from the runbook's follow-ups; kind 7 for the script): `deploy-sepolia.sh --verify` still calls forge's Sourcify API v1 route, which Sourcify removed; the script does not wait for the deployer's nonce between `forge create` calls; the Sourcify v2 tool and a whole-rehearsal command are not committed; no CI job runs `site/walkthrough.mjs`, and `live-fork.test.ts` does not print its output.
4. **`formal/README.md`:** its model-to-code citations stay pinned at `74fa299`, and the page now says so; `HoldbackRules.sol`, `state.ts` and `simchain.ts` differ between `74fa299` and the tag [measured by part 2's session]. Repinning about 60 citations to the tag is its own task.
5. **`reports/differential-local.md`** was recorded on 2026-11-04, on the 0.7 contracts [measured: its commit and date]; the contract stack now says so. Regenerate it once on the phase-one contracts (`pnpm snap --settlement local`).
6. **Task statuses:** on the coordinator's request (Crow Control now reads a task's state from a merged PR's `Closes T-nnn` line, Rafa, 2026-11-13), this PR sets T-212, T-239, T-334, T-346, T-349, T-354, T-356, T-357, T-375 and T-383 to done, each checked against its merged PRs and the cutover record, and `docs/team.md` says how a task closes. T-059 stays in progress: its task file lists two criteria still open, a second founder's confirmation (criterion 1) and a red-team pass on the live console (criterion 6) [measured: its Handoff]. T-378 waits on its part 6; T-384 to T-398 have no row in `docs/plan.md` [measured by part 2's session and its reviewer].
7. **For triage:** `docs/testing.md` lists `pnpm snap --judges=live`, which the runner refuses (`LIVE_REFUSAL` in `packages/testkit/src/runner.ts`) [measured]; `fixtures/README.md` says the checks and the panel are stubs "until T-008" and "T-009" [measured], which no one checked against the runner; `scripts/metrics/crow-accounts.json` cites `docs/operations.md` for the deal lanes, which the page no longer lists (discovery's `demo.relayer` does) [measured]; `contracts/test/differential/PinnedSource.t.sol:17` still calls `64be1f1` the source the Sepolia world runs (a test comment) [measured]; the contract stack's `docs/operations.md` input moves the page's version with each deploy entry [inferred from `stackVersion()`].
8. **CodeQL:** three test-only alerts from PR 475 wait for Rafa's dismissal (`docs/cutover-phase-one.md`, step 3.6).
