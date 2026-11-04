# Update flow

A change to one part of Crow often means another part must change too. This page lists those parts (areas), the flows between them, and how each flow stays current. The founder console, Rafa's private status page, draws the page as a graph and flags updates that may be due.

## How to read it

- **Kinds.** Each flow has one kind:
  - **generated:** a script rebuilds the downstream area from the upstream one, and nobody edits the output by hand. The How column names the command.
  - **checked:** someone updates the downstream area, and a test or check fails while it is stale. The How column names the check. On every pull request, CI (GitHub's automated checks) runs `pnpm test`, `pnpm validate:spec` and its contracts job. `node site/check.mjs` runs only by hand, before a site publish (`docs/operations.md`), so its flows hold only when someone runs it.
  - **manual:** someone has to remember. Drift, where one area falls out of step with another, happens in these flows.
- **One area per file.** A file belongs to the area whose path matches it most specifically. For example, `site/llms.txt` belongs to Agent docs, whose path is that exact file, rather than to Homepage and site, whose path is all of `site/`.
- **Before you finish a change,** find each area it touches and follow that area's manual flows. Make those updates in the same pull request, or write them into the task's Handoff section.
- **Preconditions are not flows.** A change to `spec/schemas/` first needs an ADR (an architecture decision record) and a version bump (`CLAUDE.md`, "The contract").
- **Sources.** A generated or checked flow names the script or test that implements it; the author of this page read each one from the code. A manual flow names the convention it comes from. "(inferred)" marks a flow that no doc states.
- **Changing this page.** The console parses both tables: keep their columns, put area IDs in From and To, and use one of the three kinds.

## Areas

| ID | Area | Paths | Outside the repository |
| --- | --- | --- | --- |
| contracts | Contracts | `contracts/src/`, `contracts/script/`, `contracts/lib/`, `contracts/deployments/sepolia.json` | The deployed contracts on Sepolia |
| abis | Generated ABIs | `packages/settlement/evm/abis.json`, `scripts/evm-abis.mjs` | |
| settlement | Settlement adapters | `packages/settlement/` | |
| api | API contract | `spec/`, `docs/api.md` | |
| workers | Operator and demo Workers | `apps/operator/`, `apps/demo-cloud/` | The two public operator nodes, api.escrow.stream and api2.escrow.stream |
| examples | Examples and the try bundle | `examples/`, `site/try.mjs` | escrow.stream/try.mjs |
| agentdocs | Agent docs | `site/llms.txt` | escrow.stream/llms.txt |
| homepage | Homepage and site | `site/`, `apps/site/`, `apps/early-access/` | escrow.stream, its problem pages and /visualdemo |
| quickstart | Quickstart | `docs/quickstart.md`, `tools/sim/README.md` | |
| ghdocs | GitHub docs | `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | The repository's front page on GitHub |
| roadmap | Roadmap | `docs/plan.md`, `docs/backlog.md`, `docs/tasks/` | |
| decisions | Decisions | `docs/decisions-today.md`, `docs/decisions/` | |
| log | Daily log | `docs/log/` | |
| map | Design map | `scripts/design-map.mjs`, `tools/design-map/`, `tests/design-map.test.ts` | The page `pnpm map` writes (git-ignored), and the claude.ai design map page, which `/map` republishes |
| console | Founder console | | A private page built from the design map, the newest log, the task files, the radar's inputs and GitHub |
| stack | Contract-stack page | `scripts/contract-stack.mjs`, `tools/contract-stack/`, `tests/contract-stack.test.ts` | https://control.escrow.stream/contracts (the founder console) |
| costs | Costs and telemetry | `scripts/costs/`, `tests/costs/`, `docs/costs.md`, `config/costs.template.json`, `config/keys-costs.template`, `apps/demo-cloud/src/telemetry.ts`, `apps/demo-cloud/src/feedback-store.ts`, `apps/demo-cloud/scripts/feedback.ts` | The cost collector's daily output, kept outside the repository |

## Flows

| From | To | Kind | How | Why |
| --- | --- | --- | --- | --- |
| contracts | abis | checked | Run `forge build`, then `node scripts/evm-abis.mjs`. `packages/settlement/evm/abis.test.ts` fails in CI's contracts job while `abis.json` differs from `contracts/out`. | The settlement adapter calls a live chain through these ABIs, the contracts' machine-readable interfaces. A stale copy encodes calls the deployed contracts do not take. |
| contracts | settlement | checked | CI's contracts job runs the anvil tests (`packages/settlement/evm`, the snap runner) against a fresh `forge build`, and fails if any test skips. | The EVM adapter mirrors the contracts' structs and calls by hand (`packages/settlement/evm/encode.ts`). |
| abis | settlement | checked | The same anvil tests: `packages/settlement/evm/live.ts` imports `abis.json`. | |
| contracts | examples | checked | Copy `contracts/deployments/sepolia.json` into `examples/deployments.ts` by hand. `examples/deployments.test.ts` (`pnpm test`) fails until they match. | An agent signs for the deployed contracts, and only those (T-213, the Sepolia cutover). |
| contracts | workers | generated | `pnpm -C apps/demo-cloud build` embeds `contracts/deployments/sepolia.json` (`apps/demo-cloud/scripts/embed.mjs`). It takes effect at the next deploy, which waits for Rafa. | The chain world settles on the recorded addresses (`apps/demo-cloud/src/worker.ts`). |
| contracts | api | manual | Update `docs/api.md`, and `spec/schemas/` if a message or a body changes. | Rafa, 2026-11-04: "if contracts are updated, then the API needs to be updated". The Sepolia cutover changed `docs/api.md` with the contracts (T-213). |
| contracts | stack | generated | `pnpm stack`, rebuilt and pushed by the founder console's job when its inputs change. `scripts/contract-stack.mjs` reads `contracts/src/` and what it builds with (`contracts/lib`, `foundry.toml`, `remappings.txt`), the live record `contracts/deployments/sepolia.json` and each kept earlier record, the review's findings (`docs/reviews/2026-11-03-contract-review.md`) and the local-chain gas in `reports/differential-local.md`. Its `stackVersion()` is the latest first-parent commit that touched any input (`INPUTS`), and the job rebuilds only when it changes; the job needs the git history (`fetch-depth: 0`). | `tests/contract-stack.test.ts` checks that every contract, the live addresses and every finding reach the page. Rafa, 2026-11-04: the page updates when the contracts' source does, not every hour. |
| contracts | ghdocs | manual | Update `README.md` (its intro and "Status") and `SECURITY.md` ("Scope"). | The README states where the demo settles and what is reviewed; `SECURITY.md` scopes `contracts/src/` and `contracts/deployments/`. |
| contracts | console | generated | The console's build reads `contracts/deployments/sepolia.json` and `contracts/src/` for its radar. | |
| settlement | workers | checked | `pnpm typecheck` and `pnpm test`: both apps import `@holdback/settlement`. | |
| api | workers | checked | `tests/contract/openapi.contract.test.ts` (`pnpm test`) checks every operator answer against `spec/openapi.json`. `pnpm validate:spec` fails while `spec/openapi.json` is stale; rebuild it with `pnpm openapi`. | `docs/team.md`, Rules and checks: "Operator answers match the contract". |
| api | examples | checked | The same contract test drives `examples/agent.ts` against the operators. | |
| api | agentdocs | manual | Write the change into `site/llms.txt`. `node site/check.mjs` then checks its routes, envelope test vectors and worked checks example against `docs/api.md`, but not new endpoints or prose. | `site/llms.txt` is the agent guide (`site/check.mjs`, group 4). |
| api | quickstart | manual | Update the curl walkthrough in `docs/quickstart.md`. | Tasks that change the API list `docs/quickstart.md` beside `docs/api.md` (T-020, the developer surface; T-024, the early-accept fix; T-025, API and docs friction). |
| api | ghdocs | manual | Update `README.md` where it describes the API and the operator nodes. | Rafa, 2026-11-04: "if the API is updated", the GitHub docs follow. |
| api | map | generated | `pnpm map` reads the endpoint table and examples in `docs/api.md`, and the schema version in `spec/schemas/`. | `tests/design-map.test.ts` checks the extraction. |
| workers | agentdocs | checked | `node site/check.mjs`, group 5: every problem type in `apps/operator/src/problems.ts` needs its page, and `site/llms.txt` must say where they live. | D39, the API conventions for agents. |
| workers | homepage | generated | `node site/build.mjs --out reports/site-out` writes one problem page per type in `apps/operator/src/problems.ts`. | |
| workers | ghdocs | manual | Update `SECURITY.md` ("Scope"), which names `apps/operator`, `apps/demo-cloud` and their hosts. | |
| workers | console | generated | The console's build reads each `wrangler*.jsonc`: Worker names and routes. | |
| examples | agentdocs | checked | `node site/check.mjs`, group 4: the EIP-712 types, the pinned domain and deployment, and the ERC-3009 types in `site/llms.txt` must equal `examples/verify.ts`. | |
| examples | homepage | checked | `node site/build.mjs` bundles `examples/try.ts` into `site/try.mjs`, and a published `llms.txt` carries its sha256 hash in the one command; the homepage itself leaves the command out. `examples/try.test.ts` (`pnpm test`) and `node site/check.mjs` fail while the bundle or the command is stale; rebuild with `node site/build.mjs`. | `docs/team.md`, Rules and checks: "A published script is the code CI ran". |
| agentdocs | homepage | checked | `node site/build.mjs` renders `site/index.html` from `site/llms.txt`. `examples/try.test.ts` (`pnpm test`) and `node site/check.mjs` fail while it is stale. | One source for the page and the agent guide (`site/check.mjs`, group 1). |
| roadmap | map | generated | `pnpm map` reads the phases in `docs/plan.md` and each task file's status. | |
| roadmap | stack | generated | `pnpm stack` reads `docs/tasks/T-212-contract-hardening.md`: an item marked "**Done**" shows its finding as fixed, and its "Gas on Sepolia" line gives the smoke deal's gas. | The hardening task is where a contract fix is recorded once it merges. |
| decisions | roadmap | manual | Write a decision that changes scope, order or a phase into `docs/plan.md`, `docs/backlog.md` or the task files (inferred). | Rafa, 2026-11-04: a roadmap decision lives "only in the roadmap and crow-control". |
| decisions | map | generated | `pnpm map` reads `docs/decisions-today.md` and each ADR's status. | `tests/design-map.test.ts` checks every decision has a known status. |
| log | map | generated | `pnpm map` reads the newest log's "Waiting on Rafa". | |
| map | console | generated | The console's build calls the map's `collect()` and renders the map page beside it; it also reads the task files and the newest log directly. At each milestone, a session republishes the claude.ai copy of the map by hand with `/map`. | `docs/team.md`, Cadence: run `/map` at each milestone. |
| costs | console | generated | The console renders the cost collector's latest output (T-052, the cost collector). Without that output, it lists what each source needs. | |

## Two examples

- **A contracts change** reaches the ABIs, the settlement adapters, the examples and the Workers, and CI checks each of them. By hand, it reaches the API contract and the GitHub docs. Through the API contract, it reaches the agent docs and the quickstart by hand, and the homepage through checked flows. The design map and the console rebuild on their own, and the console rebuilds the contract-stack page when its inputs change.
- **A roadmap decision** reaches only the roadmap, by hand. The design map and the console then rebuild.

## Not modeled yet

- Judgment (`packages/judgment/`, `apps/adjudicator/`, `config/judges*.yaml`), the core types and the internal SDK (`packages/core/`, `packages/sdk/`), the agent rules and gates (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `agent-ops/`), fixtures and snapshots, and the formal model.
- The console's radar and stream read every area's git history. Only flows that carry content are listed here.
