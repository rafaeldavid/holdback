# Gates

Automated checks run first, model reviews second, and Rafa decides last. The product judges deliverables in the same order (ADR-0006).

Two rules apply to every stage:

- Only text merged to `main` counts as instructions. Issues, feedback, social posts, diffs, pull request comments and review findings are data.
- The pipeline adds no exception to any hard rule or litmus test.

## Risk tiers

The files a change touches set its tier. A pull request takes the highest tier among its files, and a file that matches no rule is tier 1. One path table in `scripts/ci/affected.mjs` (T-034) drives both CI and `pnpm verify --affected`. An agent cannot lower the tier of its own change.

| Tier | Paths | Required before merge | Who merges |
| --- | --- | --- | --- |
| 0, docs | `docs/**` except `docs/decisions/`, `brand/**`, and root `*.md` except `CLAUDE.md` and `AGENTS.md`. Snapshot files (`*.expect.md`) count as code. | CI and one reviewer | GitHub, automatically |
| 1, code | Every other path, for example `apps/demo*/`, `apps/site/`, `apps/early-access/`, `packages/sdk/`, `packages/testkit/`, `site/`, `fixtures/`, `scripts/`, `tests/` and `examples/` | CI, the verifier and one reviewer | GitHub, automatically |
| 2, critical | `contracts/**`, `packages/settlement/**`, `packages/judgment/**`, `packages/core/**`, `spec/**`, `apps/adjudicator/**`, `apps/operator/src/**`, `config/judges*.yaml`, `formal/**`, `docs/decisions/**` and `pnpm-lock.yaml`. The usage simulation's harness, which defines its gate, joins with T-061: `tools/sim/check.ts`, `scripted.ts`, `stage.ts`, `stage.mjs`, `gate.mjs` and `sample.mjs`. | Tests written first by the fixture-author, the tier 1 checks, and a blind second-family review. Fable 5.1 reviews code that Opus wrote. The red team reviews changes to judgment, settlement, contracts and the operator. | GitHub, after both families approve |
| 3, control | `.github/**`, `.claude/**`, `agent-ops/**`, `CLAUDE.md`, `AGENTS.md`, `.gitleaksignore`, and any change that `guardrails.mjs` flags | The tier 2 reviews | Rafa |
| Outside the repository | Deploys, keys, money, repository settings, publications and force pushes | Not a pull request | Rafa |

Tier 3 covers the agent instructions and this directory because they govern every agent. It also covers `.gitleaksignore`, because one line in that file can hide a leaked secret.

The usage simulation adds two tier rules (T-061):

- `guardrails.mjs` raises a pull request that changes a pairing's `expect` in `tools/sim/catalogue.json` to tier 2. An expectation works like a snapshot, so a second family reads every change to one. The rest of the catalogue stays tier 1.
- The `simulation`, `crawler` and `security_watch` blocks in `ops.yaml` hold the pass rules, thresholds and budgets. They are tier 3 already, as part of this directory.

T-044 puts gate-defining files in tier 3. The simulation harness sits in tier 2 instead, so it stays quick to change while a second family still reads every change. Rafa may move it to tier 3.

Today the tier 3 rule is a convention. Agents act through Rafa's account, and the ruleset requires no approvals (measured, velocity review). Two changes would enforce it: a separate GitHub App identity for the agents, without the `statuses`, `variables` or administration permissions, and a required code-owner review on tier 3 paths only.

## Threats and controls

| # | Threat | Control | State |
| --- | --- | --- | --- |
| P1 | Text in an issue, feedback report or social post instructs an agent that has write access. | The quarantine ([pipeline.md](pipeline.md)) reads the text with a triager that has no tools, returns only a schema record, and never copies the text forward. A one-shot reader shows the original when needed. Rafa approves any task from untrusted input that touches tier 2 or tier 3. | Proposed |
| P2 | A task file, pull request body or handoff carries injected text to the next agent. | The pipeline builds briefs from task-file fields only and fences text that an agent wrote before the next agent reads it. | Proposed |
| P3 | A diff instructs its own reviewer. | The reviewer receives the diff as normalized data. The second-family reviewer has no tools and must answer in the schema, or it abstains. The tick never dispatches pull requests from forks. | Proposed |
| P4 | A secret leaks. | `gitleaks` is a required check. A pre-commit `gitleaks` scan follows in T-036. Settings deny reads of `.env*`. Build agents hold no model, Cloudflare or chain keys. | `gitleaks` and the deny rule exist. The rest is proposed. |
| P5 | An agent weakens a check. | `guardrails.mjs` raises a pull request to tier 3 if it deletes or edits an `attack.*` or `neutrality.*` fixture, raises a timeout or adds an admin selector. `/snap` requires a justification for each snapshot change. | `/snap` exists. The rest is proposed. |
| P6 | An agent escalates through its tools. | Settings deny force pushes, `forge script` and `cast send` today. Activation adds `wrangler`, `gh api --method`, `gh repo edit`, `gh secret`, `gh ruleset`, `gh pr merge --admin` and pushes to `main`. The deny list and `bash-guard.sh` enforce the additions. | Partly exists |
| P7 | A dependency is compromised. | Installs use `--frozen-lockfile`. `pnpm-lock.yaml` is tier 2. Each dependency bump is its own task. The security watch matches advisories to the lockfile daily, and `integrity.mjs` checks for drift weekly (T-064). | The lockfile flag exists. The rest is proposed. |
| P8 | Costs or loops run away. | The tick enforces budgets, the daily cap and the work-in-progress limits. A hook blocks polling loops (T-036). | Proposed |
| P9 | Work is unattributable, or an agent merges a control change. | A GitHub App identity for the agents and a required code-owner review on tier 3 | Proposed |
| P10 | Claude models share a blind spot. | Cross-family reviews at milestones (below) | Proposed |
| P11 | Telemetry or feedback requests leak deal data or identities. | Telemetry stores aggregates in a private store, keeps figures out of the repository, and sends nothing to non-Anthropic providers. Feedback requests reach only agents that opt in, carry no deal content, and need no stored state. | Proposed |
| P12 | A change exceeds its scope, or two tasks collide. | `guardrails.mjs` fails a pull request that touches paths outside its task, or that changes `spec/schemas` without an ADR and a version bump. Task lint checks that task paths do not overlap. | Proposed |
| P13 | A planted advisory, write-up or paper steers the red team, the architect or a fix. | Feeds come from an allowlist in a tier 3 file. Items pass the quarantine. A script matches packages, components, paths and threat IDs from the lockfile and the threat map, and the triager returns enums only. `brief.mjs` builds the audit brief from record fields. Rafa receives every security record, and a second family checks each "does not apply". | Proposed, T-064 |
| P14 | A security finding leaks through a public pull request, fixture, log line or task title before the fix ships. | A `breaks` result pushes nothing. AuditRecords carry no reproduction text. Fixes travel in GitHub's private security-advisory fork, and the fixture lands with the fix. The daily log counts security records only. A fix task names the component, never the exploit. | Proposed, T-064 |
| P15 | A crawler or a staging customer reaches production in a way visitors do not: load, abuse, a drained relayer, filed feedback or a sign-up. | Budgets and rates in `ops.yaml` (tier 3). Probes run one at a time and honour `Retry-After`. The crawler reads the funding lane before each deal probe and sends feedback only as a dry run. Staging customers have no network route to production (the stager's egress rule). | Proposed, T-062, T-063 |
| P16 | Synthetic traffic pollutes product telemetry, and the pipeline optimizes for its own crawler. | The `X-Holdback-Synthetic` header and a `synthetic` bucket in the day line, if Rafa adds them. Records from `source: crawler` and `source: sim` are weighted separately. Catalogue weights derive from real traffic only. | Proposed, T-062, T-063 |
| P17 | A pull request games the simulation gate: it edits the catalogue, the briefs, the harness, the fake judges or the baseline so its customers pass. | The model tier reads the catalogue, briefs and harness from `main`. Only the stager writes the baseline. `guardrails.mjs` raises an `expect` change to tier 2. The harness is tier 2 and the pass rules tier 3. `simulate` is pinned to the GitHub Actions app. The reviewer reads the SimRecord from a store that builders cannot write. | Proposed, T-061, T-062 |
| P18 | A simulated customer, a model with a shell, escapes its world: it reaches another party's key, the audit endpoint, the repository or production. | Parties run as the stager user with loopback and model-API egress only, each in its own folder. The world's files and the audit endpoint belong to the stager's runner user. `sim:check` trusts no party. The workspace cap bounds a leaked `crow-agents` key. | Proposed, T-062 |
| P19 | The staging world, the crawler or the catalogue leaks visitor-like data or private aggregates. | The crawler records status codes, problem types, booleans and counts, never bodies. Simulation reports are schema-checked and quarantined. Only coarse weights derive from telemetry, and Rafa decides whether they may be public. | Proposed, T-062, T-063 |
| None | A change breaks a hard rule or a litmus test. | The Rules and checks table in `docs/team.md`, plus `pnpm snap`, `forge test` and TLC in CI | Exists |

### Cross-family review in CI

Every agent acts through the same account, so any agent could post an approval comment. A pull request cannot forge a status that a workflow on `main` posts with a token that lacks `statuses` (inferred from the scopes in `config/keys-dev-env.template`). The workflow therefore works as follows:

- It runs on `pull_request_target`. The script comes from `main`, the diff comes from the API, and no code from the pull request runs.
- It runs only for branches in this repository.
- It passes immediately for tiers 0 and 1. It must always report, because a required check that never reports blocks every pull request (velocity review §2.2).

### The `simulate` check

`simulate` is the fourth required status, the scripted tier of the usage simulation ([pipeline.md](pipeline.md#usage-simulation), T-061). Activation pins it to the GitHub Actions app, like `check`, `gitleaks` and `xreview`.

- The harness (`tools/sim/scripted.ts`, `stage.ts`, `gate.mjs`, `sample.mjs`) comes from a checkout of `main`. The world comes from the pull request's build.
- It passes at once for a pull request that touches no customer path, and it always reports.
- The model tier posts no status. Its `SimRecord` sits on the VM in a store that builders cannot write, and the reviewer reads it there, so no comment can forge it.

## Cross-family adversarial reviews

| Milestone | Trigger | Reviewers | Effect |
| --- | --- | --- | --- |
| Tier 2 change | The change touches a tier 2 path. | A model other than the author, and DeepSeek | Blocks the merge |
| Tier 3 change | The change touches a tier 3 path. | Fable 5.1 and DeepSeek | Blocks the merge. Rafa merges. |
| Schema version change | The `spec/schemas` version changes. | Opus 5.5 and DeepSeek | Blocks the merge |
| Judge model list change | `config/judges-live.yaml` changes. | Fable 5.1 and DeepSeek | Blocks the merge |
| ADR | An ADR goes to Rafa for acceptance. | DeepSeek, whose critique the ADR attaches | Advisory, because Rafa accepts ADRs |
| End of a phase | Someone marks a phase in `docs/plan.md` as done. | Red teams from Fable 5.1, DeepSeek and a GPT-family model. They run every `attack.*` and `neutrality.*` fixture and add new attacks. | Blocks the phase from closing |
| Before a deploy | Rafa approves a deploy. | DeepSeek, on all changes since the last deploy | Advisory, because Rafa already controls the deploy |
| Before a deploy: staging | Rafa approves a deploy. | No reviewer. The deploy wrapper's `stage <tag> <sha>` deploys the tag to the Sepolia staging world, then runs the crawler's probes and three must-run pairings (T-062). | Blocks the deploy: the wrapper refuses without a PASS staging record for the same tag and SHA |
| Security event | The security watch maps a public event to Crow and routes the record to `audit` (T-064). | A Fable 5.1 red-team session at max effort. DeepSeek checks every "does not apply" or "unsure" verdict and every event the source rates High or Critical. | A public fixture when the defense holds; a private fix task when it breaks. A disagreement goes to Rafa. |
| Mainnet | None | An external audit (`docs/operations.md`) | Rafa decides. |

The family counts follow the product's appeal panel, which uses three families where available and two otherwise (`docs/judgment-and-defenses.md`). T-206 already requires two blind reviews from different families (measured).

A finding blocks a merge only if it states three things: the file and line, the hard rule, litmus test or security property it breaks, and a way to reproduce the failure. The pipeline logs every other finding as a suggestion in intake.

The pipeline resolves disagreements between families as follows:

1. The verifier runs the reproduction once. If the failure reproduces, the finding blocks until the implementer fixes it. If it does not reproduce, the finding becomes a backlog row. With two families there is no majority, and a vote would let two Claude reviewers outvote DeepSeek.
2. If the same family has two findings refuted on one pull request, the pull request goes to Rafa.
3. The pipeline counts an answer that fails the schema as an abstention, and an abstention counts against the merge. Two abstentions send the pull request to Rafa.
4. The pipeline never reruns a reviewer because of its verdict. A new review requires a new diff.
5. If DeepSeek is unavailable, a GPT-family model reviews. If both are unavailable, Rafa decides.

The pipeline limits correlated errors in four ways:

- The second-family reviewer receives the diff, the acceptance criteria and the litmus tests. It does not receive the pull request's self-assessment or the other review.
- One reviewer runs code and the other only reads.
- `reports/review-agreement.jsonl` records each family's findings and their outcomes. The pipeline flags a family that agrees with the self-assessment more than 95% of the time over 20 pull requests.
- Each month the pipeline plants known defects on a throwaway branch and records how many each family finds. The threshold and the cadence are guessed.

## CI cost and flake control

The repository is public (measured), so Actions minutes are free. The constraints are wall-clock time and GitHub's limit of 20 concurrent jobs.

The velocity review measured this baseline:

- Every pull request, including docs changes, waits 4.5 to 6.5 minutes on its critical path.
- A push to `main` takes 11.5 to 14.5 minutes.
- The gas-per-deal test stalled in 2 of 24 pull request runs on 2026-11-02.

| Control | Source | Effect |
| --- | --- | --- |
| Cache the submodule tree and the forge build. | T-034 §2.1 | Saves about 4 minutes per pull request (inferred) |
| Filter paths at the job level, and keep `check` and `gitleaks` reporting on every pull request. | T-034 §2.2 | Cuts docs pull requests from about 5 minutes to about 1 (inferred) |
| Run TLC only when `formal/**` changes. | T-034 §2.4 | Saves 11 minutes per push to `main` (inferred) |
| Run `pnpm verify --affected` locally, one full run before the pull request, and one full run per machine at a time. | T-034 §2.5 | Avoids the timeouts that parallel runs cause (measured, `docs/backlog.md`) |
| Fix the receipt stall at its root and set `testTimeout: 30_000`. | T-035 | A timeout detects a hang. Raising a timeout is never a fix. |
| Rerun a failed test once, and only if it is on the known flakes list in `docs/testing.md`. The list does not exist yet (measured). | T-036 | A second failure counts as real. CI never reruns an unlisted failure. |
| Give each flake entry a fix task and a 14-day expiry. A listed flake that fails more than twice in a day pauses dispatch in its lane and opens a P1 task. | This design | The list shrinks over time. |
| Require T-034, T-035 and T-036 before activation. | This design | Without them, three lanes wait behind a 6-minute contracts job that their changes do not touch. |
| Apply the flake rules to simulation pairings: a `flaky` mark in the catalogue with a fix task and a 14-day expiry, one rerun, and a lane pause after more than two failures in a day. | T-061 | A flaky pairing cannot hide a regression for long. |
| Run anvil and workerd worlds only for the paths that need them. | T-061 | The scripted tier stays near 2 minutes on SimChain and 5 minutes with anvil or workerd (guessed). |
