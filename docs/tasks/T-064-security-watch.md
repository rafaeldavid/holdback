# T-064: Security watch and targeted audits from market security events

- **Lane:** infra (with test for the fixtures an audit adds)
- **Phase:** 10
- **Depends on:** T-041 (the quarantine, `read-raw.mjs`, the records folder); T-045 (`xreview.mjs`, the second-family channel); T-046 (`red-team-pr.md`, the red-team brief pattern); T-048 (dispatch); T-055 (the channel that reaches Rafa). The deterministic watcher depends on nothing unmerged and can run in dry-run mode first.
- **Paths this task may touch:** `scripts/ops/watch.mjs` (new), `scripts/ops/integrity.mjs` (new), `agent-ops/security-watch.yaml` (new), `agent-ops/threat-map.yaml` (new), `agent-ops/schemas/audit-record.schema.json` (new), `agent-ops/schemas/triage-record.schema.json` (the `advisory`, `writeup`, `cve` and `research` sources, the `audit` route, and the `threatIds`, `component` and `dependency` fields; coordinated with T-041), `agent-ops/commands/security-audit.md` (new, inert until T-050), `agent-ops/dependabot.proposed.yml` (new), `agent-ops/ops.yaml` (the `security_watch` block, only to match what this task builds; after T-040), `agent-ops/pipeline.md`, `agent-ops/gates.md`, `agent-ops/teams.md` and `agent-ops/README.md` (only to correct the design text of 2026-11-05 to what this task builds), `scripts/ops/tick.mjs` (the `audit` route; after T-048), `scripts/ops/brief.mjs` (the audit brief from record fields; after T-048), `scripts/ops/figures.mjs` (the security record count; after T-047), `scripts/dev-env/vm-users.sh` and `tests/dev-env.test.ts` (the `watcher` user and the folders `/srv/crow/watch/` and `/srv/crow/security/`; after T-039), `tests/agent-ops/watch.test.ts` (new), `tests/agent-ops/integrity.test.ts` (new), `SECURITY.md` (one line pointing at the process), `docs/testing.md` (the fixture rule for mapped events), `docs/tasks/T-064-security-watch.md`
- **Human gate:** **yes** for: the `npm` and `gitsubmodule` ecosystems in `.github/dependabot.yml` (a `.github/` change that Rafa merges from the proposed copy); the channel on which Rafa receives security records; where confirmed exploits live (GitHub's draft advisory and private fork, or the founders' private repository); live second-family runs with capped keys; and any reproduction against the live demo. No for the watcher, the threat map, the schemas and scripted audits. A PR that touches `agent-ops/` is tier 3, so Rafa merges it.
- **Status:** todo
- **Agent/session:** —

## Intent

Rafa, 2026-11-05: "as well as continuous security audits informed by market security events".

Restated: watch public security events, map each one to Crow's code and threat model, run a targeted red-team audit with a reproduction, and open a security ticket that reaches Rafa directly. The events are advisories for everything Crow depends on; exploit write-ups and post-mortems in escrow, payment, agent-commerce and DeFi protocols; CVEs; and new attack classes against LLM judges. Fixes go through the normal pipeline as tier 2 tasks, and nothing is published without Rafa.

- **Inputs:** an allowlist of public feeds; `pnpm-lock.yaml`, `contracts/lib`, `contracts/foundry.toml`, `config/judges-live.yaml`; the threat tables in `docs/judgment-and-defenses.md`, `docs/neutrality.md` and `agent-ops/gates.md`.
- **Outputs:** `security` TriageRecords; `AuditRecord`s; `attack.*` and `neutrality.*` fixtures; records on Rafa's channel; weekly integrity findings.
- **Non-goals:** fixing what an audit finds (each fix is its own tier 2 task); the external audit before mainnet (Rafa, D4); a bug bounty (`SECURITY.md`).

## Context

- The design: `docs/research/2026-11-05-simulation-and-watch.md`, section 5 and threats P13 and P14; `agent-ops/pipeline.md`, Security watch and Quarantine.
- `agent-ops/pipeline.md`, Quarantine: normalization, random delimiters, a canary, schema-only output, the one-shot reader; and the rule that a security record never becomes a public issue and goes to Rafa directly.
- `agent-ops/gates.md`: a blocking finding names a file and line, the rule and a reproduction; the second family has no tools; a disagreement goes to the verifier's one reproduction, then to Rafa.
- `.claude/agents/red-teamer.md`: the role's goals and its PASS, ISSUES or BLOCKED report. `docs/testing.md`: "Every new defense adds an `attack.` fixture"; the filename prefixes, and `todo.` for a gap.
- `SECURITY.md`: fix in private, publish a GitHub security advisory once the fix ships, 90 days.
- Measured: `.github/dependabot.yml` covers GitHub Actions only. The contracts import Solady, Commerce Payments, Permit2 and, through them, OpenZeppelin, under solc 0.8.28. The workspace depends on viem, tweetnacl, @noble/curves, ajv, ajv-formats, yaml, vitest, TypeScript, ESLint and rolldown, and runs wrangler 4 through `npx`.

## Acceptance criteria

- [ ] `agent-ops/security-watch.yaml` lists every source of the design note's section 5.1 as `{id, kind, url, cadence, maps}`, each URL confirmed by one fetch recorded in Evidence. A source that does not answer stays listed with `status: unconfirmed`. `node scripts/ops/watch.mjs --dry-run` fetches only the listed URLs, with a 10 s timeout and a 1 MB cap per source; a test with a stand-in server shows that a URL inside an item is never fetched. It normalizes each item with `packages/judgment/src/normalize.ts`, truncates it to 4 KB, fingerprints it and writes new items to the inbox folder. It holds no key and imports no model client (checked by a test).
- [ ] Deterministic matching: for advisories and CVEs, `watch.mjs` decides with no model whether a package and version in `pnpm-lock.yaml`, a submodule commit in `contracts/lib`, the solc version in `contracts/foundry.toml`, a tool pin in `scripts/dev-env/setup.sh` (once T-039 writes it) or a model ID in `config/judges-live.yaml` is affected. A match writes a `security` record with `source`, `dependency`, `component`, `pathsGuess` and `threatIds` taken from `agent-ops/threat-map.yaml`. `pnpm vitest run tests/agent-ops/watch.test.ts` feeds fixture advisories in the OSV, GHSA and solc `bugs.json` shapes, and shows a match, a near miss on version, and a package Crow does not use.
- [ ] `agent-ops/threat-map.yaml` maps every threat ID in `docs/judgment-and-defenses.md` (T1 to T22), every residual in `docs/neutrality.md` (1 to 13) and every pipeline threat in `agent-ops/gates.md` (P1 to P19) to a component, its paths, its fixtures and the control that should hold. A test checks that every ID in those documents has a row, and that every path and fixture it names exists.
- [ ] Free-text items go through T-041's quarantine, and the triager's output must match the extended schema: `threatIds` and `component` from the fixed enums, a summary of at most 300 characters, and `needsRaw`. A test runs every `attack.*` payload, and a planted write-up that names a path, a URL and a handle, through the quarantine with a scripted hostile triager, and every attempt is dropped or stripped.
- [ ] Every `security` record goes to Rafa's channel (T-055) with its fingerprint, source kind, component, threat IDs and severity. Elsewhere, `intake.mjs` prints only "security record for Rafa" and the fingerprint (T-041's rule). The daily figures count security records and never name them (tested with `figures.mjs`).
- [ ] The `audit` route: `tick.mjs` dispatches a `red-teamer` session for a record routed `audit`, through the launcher, with a brief that `brief.mjs` builds from the record's fields and the threat map's excerpt only. `agent-ops/commands/security-audit.md` tells the session to reproduce on SimChain, anvil or `anvil --fork-url`, never against the live demo without Rafa's go-ahead, and to answer in `audit-record.schema.json` (`eventFingerprint`, `threatIds`, `component`, `applies`, `reproduction`, `result`, `severity`, and a `claim` of at most 300 characters). A brief test shows no raw item text in the brief.
- [ ] Outcomes, each shown on a scripted audit. `holds` opens a tier 2 pull request that adds an `attack.*` or `neutrality.*` fixture, or a Foundry or vitest test, whose description and commit name the event's fingerprint. `breaks` pushes nothing, keeps the branch under `/srv/crow/security/<fingerprint>/` (mode 700) and sends the AuditRecord to Rafa's channel; a test checks that a `breaks` run makes no network call to GitHub. `does not apply` or `unsure`, and any event the source rates High or Critical, sends the AuditRecord, the dependency match and the threat-map excerpt to the second family through `xreview.mjs`, with no raw text; a disagreement goes to Rafa.
- [ ] Budgets come from `ops.yaml`'s `security_watch` block: the audit session's budget (T-047's stop), the daily cadence and the second-family trigger. A test shows that a changed value changes the behaviour.
- [ ] `node scripts/ops/integrity.mjs` runs weekly and reports each drift as a `security` record: `pnpm audit --json` with a high or critical finding; a lockfile version that OSV lists; a `contracts/lib` commit with an upstream advisory; a pinned GitHub Actions SHA that no longer equals its tag; a model ID in `config/judges-live.yaml` that its provider no longer lists; the deployed contracts' code hashes against `contracts/deployments/sepolia.json` (`deploy-sepolia.sh --check`); the drand quicknet chain hash; and a changed `.gitleaksignore`. `pnpm vitest run tests/agent-ops/integrity.test.ts` shows each check firing on a fixture and silent on a clean one, with stand-ins for the live checks.
- [ ] `agent-ops/dependabot.proposed.yml` adds the `npm` and `gitsubmodule` ecosystems weekly. Handoff asks Rafa to merge it into `.github/dependabot.yml` and records his answer on auto-merging lockfile bumps.
- [ ] `vm-users.sh` adds the `watcher` user with no token, and the folders `/srv/crow/watch/` (inbox kept 30 days, fingerprints 90 days) and `/srv/crow/security/`. `tests/dev-env.test.ts` checks them on the fixture root.
- [ ] `agent-ops/` matches what the task built: the sources, the route, the two outcome paths, the budgets, Activation steps 5d, 6d and 8b, and threats P13 and P14. `SECURITY.md` points at the process in one line. `docs/testing.md` extends the fixture rule to every mapped event. `pnpm verify` passes.
- [ ] The activation test, recorded in Evidence (measured): a planted, already-fixed advisory for a lockfile package runs end to end through the match, the quarantine (as a write-up variant) and one scripted audit, and its record reaches the channel in dry-run form.

## Out of scope

- Fixing findings; the external audit; a bounty; reading any private feed or account.
- Sending raw event text to any non-Anthropic provider (P11).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Snapshot diffs:
- Metrics: items a day per source; records a week; audits a week and their cost.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR. Record here: the confirmed and unconfirmed sources; whether a `holds` fixture may name the public advisory ID in its description; and the threat map's enum of components.

## Handoff

What is done, what is not, how to resume, and the open questions that remain. Open questions for Rafa from the design note: Dependabot ecosystems and lockfile auto-merge (6), the channel and its readers (7), where confirmed exploits live (8), and the second-family keys for live audits.
