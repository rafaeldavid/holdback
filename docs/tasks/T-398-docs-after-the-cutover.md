# T-398: the docs after the cutover

- **Lane:** docs, on `main`
- **Phase:** 2
- **Kind:** 2 (docs; `docs/team.md`, Change recipes): one reviewer per pull request, no red team
- **Depends on:** the phase-one cutover of 2026-11-13 (T-383; PRs 475, 477, 478 and 479 merged into `main`; the tag `contracts-phase-one-1` on `27ab44e`)
- **Paths this task may touch:** the docs listed below, `tools/design-map/template.html`, the contract stack's inputs (`tools/contract-stack/`, `scripts/contract-stack.mjs` where an input is read), `scripts/record-copies.mjs`'s list of history docs, a new redeploy runbook under `docs/`, this file. Off limits: `contracts/src`, the guides under `site/` (another session owns the site), tier-3 files (`.github/`, `agent-ops/`, `AGENTS.md`, `.gitleaksignore`, `CLAUDE.md`, `.claude/`), behaviour, and the meaning of any test.
- **Human gate:** no deploy, nothing outward-facing except republishing two existing private artifacts at their own URLs.
- **Status:** in progress
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

- [ ] Every "fresh draft" and "needs edits" row of both inventories is closed by an edit, or reported here with a reason.
- [ ] No standing doc in this task's list names the 2026-11-04 deployment, domain 0.7 or schema 0.10 as live, or the freeze as a future step.
- [ ] Each standing doc points to the record's field or the source file for an address, version, count or size, where it can; dated records keep their values.
- [ ] The design map's template says which of appeals and bonds is on chain in phase one (neither) and which SimChain keeps (both).
- [ ] The contract stack's findings agree with `docs/audit/known-issues.md`, its gas figure is the phase-one smoke deal's or is read from a source, and `plain.json` says the operator fee is 0 for the first pilots.
- [ ] Both pages regenerated, each live artifact's source read in full, both republished at their existing URLs and read back.
- [ ] `docs/cutover-phase-one.md` is a dated record; one redeploy runbook covers `contracts-phase-one-2`, with Sourcify's API v2 route and the wait between creates.
- [ ] Each pull request passes `pnpm typecheck`, `pnpm lint`, `node site/build.mjs && node site/check.mjs`, the doc-reading tests and `tests/cut-feature-alignment.test.ts`; `pnpm validate:spec` if an example changes.
- [ ] One reviewer per pull request; findings fixed; merged by hand once `check` and `gitleaks` pass.

## Evidence

(Filled in as each pull request merges.)

## Handoff

(Filled in at the end.)
